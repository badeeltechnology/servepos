"""Checks of bulk outlet visibility (servepos.api.menu_admin). Always rolled back.

Run: bench --site <site> execute servepos.api.test_menu_admin.run
"""

import json
import secrets
import traceback

import frappe
from frappe.utils import cint

from servepos.api import menu_admin as ma
from servepos.api import registry
from servepos.api.mobile.test_mobile import Log, expect_error

PREFIX = "zz-menu-admin-test"


def _make_user(tag, roles):
	doc = frappe.get_doc(
		{
			"doctype": "User",
			"email": f"{PREFIX}-{tag}-{secrets.token_hex(2)}@example.com",
			"first_name": f"Menu Test {tag}",
			"send_welcome_email": 0,
			"roles": [{"role": r} for r in roles],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _make_item(code, group, uom, legacy="", rows=None, disabled=0, web=0):
	doc = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": code,
			"item_name": code,
			"item_group": group,
			"stock_uom": uom,
			"is_stock_item": 0,
			"standard_rate": 5,
			"disabled": disabled,
			"servepos_is_available": 1,
			"servepos_visible_profiles": legacy,
			"servepos_show_on_website": web,
			"servepos_availability": rows or [],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _codes(profile):
	return {r["name"] for r in registry.get_items(profile)}


def _pick_profiles():
	prof = ma._profiles()
	pref = ["Olive Green", "Olive Green Mix", "Nami Cocktail", "Nami Greek"]
	chosen = [p for p in pref if p in prof]
	chosen += [p for p in sorted(prof) if p not in chosen]
	return chosen[:4], prof


@frappe.whitelist(methods=["POST"])
def run():
	frappe.only_for("System Manager")
	me = frappe.session.user
	log = Log()
	tag = secrets.token_hex(2).upper()
	try:
		(p1, p2, p3, p4), prof = _pick_profiles()
		log.check(True, "Profiles", f"{p1} / {p2} / {p3} / {p4}")
		group = frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", limit=1)[0]
		uom = "Nos" if frappe.db.exists("UOM", "Nos") else frappe.get_all("UOM", pluck="name", limit=1)[0]

		a = _make_item(f"ZZOV-A-{tag}", group, uom, legacy=p1, web=1)  # legacy: only p1, on web
		b = _make_item(f"ZZOV-B-{tag}", group, uom)  # legacy empty: everywhere
		c = _make_item(f"ZZOV-C-{tag}", group, uom, rows=[
			{"branch": prof[p3], "pos_profile": p3, "show_on_pos": 1, "show_on_website": 0}])
		d = _make_item(f"ZZOV-D-{tag}", group, uom, legacy=p1, disabled=1)

		# ---- permissions ----------------------------------------------------
		cashier = _make_user("cashier", ["ServePOS Cashier"])
		manager = _make_user("mgr", ["ServePOS Manager"])
		frappe.set_user(cashier)
		expect_error(log, "A non-manager is refused (set_item_outlets)", frappe.PermissionError,
			ma.set_item_outlets, [a], [p2])
		expect_error(log, "A non-manager is refused (copy_outlet_menu)", frappe.PermissionError,
			ma.copy_outlet_menu, p1, p2)
		frappe.set_user(manager)

		# ---- add -----------------------------------------------------------
		before_mod = frappe.db.get_value("Item", a, "modified")
		r = ma.set_item_outlets([a, c, d], [p2], show_on_pos=1, mode="add")
		log.check(r["updated"] == 2 and r["converted_legacy"] == 1 and r["skipped_disabled"] == 1,
			"Add: counts (2 updated, 1 legacy converted, 1 disabled skipped)", r)
		on_p1, on_p2, on_p3 = _codes(p1), _codes(p2), _codes(p3)
		log.check(a in on_p1 and a in on_p2, "Add: legacy item keeps its old outlet and gains the new one")
		log.check(a not in on_p3, "Add: legacy item still hidden on other outlets")
		log.check(c in on_p2 and c in on_p3 and c not in on_p1, "Add: row item keeps its outlet and gains the new one")
		log.check(d not in on_p2, "Add: disabled item untouched")
		m = frappe.db.get_value("Item", a, ["modified", "modified_by"], as_dict=True)
		log.check(m.modified > before_mod and m.modified_by == manager, "Add: Item.modified bumped, modified_by = user", m)
		log.check(frappe.db.exists("Comment", {"reference_doctype": "Item", "reference_name": a, "comment_type": "Info"}),
			"Add: an Info comment is left on the item")
		log.check(a in set(registry.get_items(p2, modified_after=str(before_mod)) and
			[x["name"] for x in registry.get_items(p2, modified_after=str(before_mod))]),
			"Add: incremental sync (modified_after) returns the item")
		web_a = ma._visible_items(p1, "website")
		log.check(a in web_a, "Legacy conversion keeps the website flag")
		r2 = ma.set_item_outlets([a, c], [p2], show_on_pos=1, mode="add")
		log.check(r2["updated"] == 0 and r2["unchanged"] == 2, "Add again: nothing changes", r2)

		# ---- remove --------------------------------------------------------
		r = ma.set_item_outlets([a], [p2], show_on_pos=1, mode="remove")
		log.check(r["updated"] == 1, "Remove: one item updated", r)
		log.check(a not in _codes(p2) and a in _codes(p1), "Remove: off the outlet, still on its other outlet")

		# legacy item taken off its only outlet must not fall back to "every outlet"
		frappe.set_user(me)
		solo = _make_item(f"ZZOV-S-{tag}", group, uom, legacy=p1)
		frappe.set_user(manager)
		ma.set_item_outlets([solo], [p1], show_on_pos=1, mode="remove")
		log.check(all(solo not in _codes(p) for p in prof), "Remove the only outlet: shown nowhere (no legacy fallback)")
		ma.set_item_outlets([solo], [p2], show_on_pos=1, mode="add")
		log.check(solo in _codes(p2) and solo not in _codes(p1), "Re-add after hidden-everywhere works")

		# everywhere item: remove one outlet keeps all the others
		r = ma.set_item_outlets([b], [p1], show_on_pos=1, mode="remove")
		cb = [_codes(p) for p in (p1, p2, p3, p4)]
		log.check(b not in cb[0] and all(b in s for s in cb[1:]),
			"Remove from an all-outlets item keeps every other outlet", r)
		active_all = [p for p in prof if p != p1 and b not in _codes(p)]
		log.check(not active_all, "No other enabled outlet lost the item", active_all)

		# ---- website flag ----------------------------------------------------
		r = ma.set_item_outlets([c], [p4], show_on_pos=0, show_on_website=1, mode="add")
		row = frappe.db.get_value(ma.AVAIL_DT, {"parent": c, "pos_profile": p4},
			["show_on_pos", "show_on_website", "branch"], as_dict=True)
		log.check(row and row.show_on_pos == 0 and row.show_on_website == 1 and (row.branch or "") == prof[p4],
			"Website only: row with web on, POS off, branch from profile", row)
		log.check(c in ma._visible_items(p4, "website") and c not in _codes(p4), "Website only: on the store, not on tills")
		ma.set_item_outlets([c], [p2], show_on_pos=None, show_on_website=1, mode="add")
		ma.set_item_outlets([c], [p2], show_on_pos=None, show_on_website=1, mode="remove")
		row = frappe.db.get_value(ma.AVAIL_DT, {"parent": c, "pos_profile": p2}, ["show_on_pos", "show_on_website"], as_dict=True)
		log.check(row and row.show_on_pos == 1 and row.show_on_website == 0, "Remove website keeps POS", row)
		ma.set_item_outlets([c], [p4], show_on_pos=None, show_on_website=1, mode="remove")
		log.check(not frappe.db.exists(ma.AVAIL_DT, {"parent": c, "pos_profile": p4}), "Row with both flags off is removed")

		expect_error(log, "Unknown outlet is refused", frappe.ValidationError, ma.set_item_outlets, [a], ["No Such Outlet X"])
		expect_error(log, "Remove with no channel is refused", frappe.ValidationError,
			ma.set_item_outlets, [a], [p2], 0, 0, "remove")

		# ---- copy: preview -------------------------------------------------
		src, tgt = p3, p4
		src_set, tgt_set = ma._visible_items(src), ma._visible_items(tgt)
		n_rows = frappe.db.count(ma.AVAIL_DT)
		pv = ma.copy_outlet_menu(src, tgt, mode="add", preview=1)
		log.check(pv["to_add"] == len(src_set - tgt_set) and pv["to_remove"] == 0 and pv["preview"],
			"Copy preview (add): counts", pv)
		pr = ma.copy_outlet_menu(src, tgt, mode="replace", preview=1)
		log.check(pr["to_remove"] == len(tgt_set - src_set) and pr["target_items_after"] == len(src_set),
			"Copy preview (replace): counts", pr)
		log.check(frappe.db.count(ma.AVAIL_DT) == n_rows, "Preview writes nothing")

		# modifier group shown only on the source, order JSON on the source
		mg = frappe.get_all(ma.MODIFIER_DT, pluck="name", limit=1)
		if mg:
			frappe.db.set_value(ma.MODIFIER_DT, mg[0], "servepos_visible_profiles", src)
		order = {"_category_order": [group], group: [c]}
		frappe.db.set_value("POS Profile", src, "servepos_menu_item_order", json.dumps(order))

		# ---- copy: add -------------------------------------------------------
		res = ma.copy_outlet_menu(src, tgt, mode="add", copy_order=1, copy_modifier_groups=1, preview=0)
		after = ma._visible_items(tgt)
		log.check(src_set <= after, "Copy add: every source item now on the target", res)
		log.check(tgt_set <= after, "Copy add: target keeps its own items")
		log.check(_codes(src) <= _codes(tgt), "Copy add: registry.get_items(target) has the source menu")
		if mg:
			v = frappe.db.get_value(ma.MODIFIER_DT, mg[0], "servepos_visible_profiles") or ""
			log.check(tgt in v.split(",") and src in v.split(","), "Copy add: modifier group shown on target", v)
		got = registry._get_menu_item_order(tgt)
		log.check(got.get(group, [])[:1] == [c] and got.get("_category_order", [])[:1] == [group],
			"Copy add: menu order copied", got.get("_category_order", [])[:3])

		# ---- copy: replace -------------------------------------------------
		frappe.set_user(me)
		extra = _make_item(f"ZZOV-E-{tag}", group, uom, rows=[
			{"branch": prof[tgt], "pos_profile": tgt, "show_on_pos": 1, "show_on_website": 0}])
		frappe.set_user(manager)
		res = ma.copy_outlet_menu(src, tgt, mode="replace", copy_order=1, copy_modifier_groups=1, preview=0)
		log.check(ma._visible_items(tgt) == ma._visible_items(src), "Copy replace: target shows exactly the source items", res)
		log.check(extra not in _codes(tgt), "Copy replace: target-only item removed")
		log.check(registry.get_active_item_codes(tgt) and set(registry.get_active_item_codes(tgt)) == set(registry.get_active_item_codes(src)),
			"Copy replace: get_active_item_codes(target) == source")
		log.check(registry._get_menu_item_order(tgt) == order, "Copy replace: order JSON equal to source")
		expect_error(log, "Copy to itself is refused", frappe.ValidationError, ma.copy_outlet_menu, src, src)

		# ---- matrix ----------------------------------------------------------
		mx = ma.get_visibility_matrix([a, b])
		log.check(mx[a][p1]["pos"] and not mx[a][p2]["pos"] and mx[b][p2]["pos"] and not mx[b][p1]["pos"],
			"Visibility matrix matches the tills")

		frappe.set_user(me)
		log.check(ma.set_item_outlets([a], [p2])["updated"] == 1, "System Manager can use the endpoints")
	except Exception:
		log.check(False, "Unexpected error", traceback.format_exc()[-290:])
	finally:
		frappe.set_user(me)
		frappe.db.rollback()
	return {
		"passed": sum(1 for s in log.steps if s["ok"]),
		"failed": sum(1 for s in log.steps if not s["ok"]),
		"failures": [s for s in log.steps if not s["ok"]],
	}
