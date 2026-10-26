"""Checks of pinned favourites (menu_admin get/set/pin_items, registry.get_pinned_items). Always rolled back.

Run: bench --site <site> execute servepos.api.test_pinned.run
"""

import json
import secrets
import traceback

import frappe

from servepos.api import menu_admin as ma
from servepos.api import registry
from servepos.api.mobile.test_mobile import Log, expect_error
from servepos.api.test_menu_admin import _make_item, _make_user, _pick_profiles


@frappe.whitelist(methods=["POST"])
def run():
	frappe.only_for("System Manager")
	me = frappe.session.user
	log = Log()
	tag = secrets.token_hex(2).upper()
	try:
		(p1, p2, _p3, _p4), prof = _pick_profiles()
		log.check(registry._has_field("POS Profile", ma.PINNED_FIELD), "POS Profile has servepos_pinned_items")
		group = frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", limit=1)[0]
		uom = "Nos" if frappe.db.exists("UOM", "Nos") else frappe.get_all("UOM", pluck="name", limit=1)[0]

		def on(profile):
			return [{"branch": prof[profile], "pos_profile": profile, "show_on_pos": 1, "show_on_website": 0}]

		a = _make_item(f"ZZPIN-A-{tag}", group, uom, rows=on(p1))
		b = _make_item(f"ZZPIN-B-{tag}", group, uom, rows=on(p1))
		c = _make_item(f"ZZPIN-C-{tag}", group, uom, rows=on(p1))
		other = _make_item(f"ZZPIN-O-{tag}", group, uom, rows=on(p2))  # not on p1
		many = [_make_item(f"ZZPIN-M{i:02d}-{tag}", group, uom, rows=on(p1)) for i in range(25)]

		manager = _make_user("mgr", ["ServePOS Manager"])
		plain = _make_user("plain", [])
		frappe.set_user(manager)

		before = frappe.db.get_value("POS Profile", p1, "modified")
		r = ma.set_pinned(p1, json.dumps([c, a, c, b]))
		log.check([x["item_code"] for x in r] == [c, a, b], "set_pinned keeps order and dedupes", r)
		log.check(str(frappe.db.get_value("POS Profile", p1, "modified")) >= str(before), "POS Profile modified bumped")
		g = ma.get_pinned(p1)
		log.check([x["item_code"] for x in g] == [c, a, b] and all(
			{"item_code", "item_name", "item_group", "rate"} <= set(x) for x in g), "get_pinned returns ordered rows", g[:1])
		log.check(registry.get_pinned_items(p1) == [c, a, b], "registry.get_pinned_items order")
		log.check(registry.get_pinned_items(p2) == [] or c not in registry.get_pinned_items(p2), "Pins are per outlet")

		r = ma.pin_items(p1, [b, a], mode="remove")
		log.check([x["item_code"] for x in r] == [c], "pin_items remove keeps the rest", r)
		r = ma.pin_items(p1, [b, c, a], mode="add")
		log.check([x["item_code"] for x in r] == [c, b, a], "pin_items add appends new in order, skips pinned", r)

		expect_error(log, "Item not on the outlet is refused (set)", frappe.ValidationError, ma.set_pinned, p1, [a, other])
		expect_error(log, "Item not on the outlet is refused (add)", frappe.ValidationError, ma.pin_items, p1, [other])
		log.check([x["item_code"] for x in ma.get_pinned(p1)] == [c, b, a], "Refused calls change nothing")
		expect_error(log, "Unknown outlet refused", frappe.ValidationError, ma.get_pinned, "No Such Outlet X")
		expect_error(log, "Bad mode refused", frappe.ValidationError, ma.pin_items, p1, [a], "toggle")

		# item removed from the outlet later: stays stored, filtered for the till
		ma.set_item_outlets([b], [p1], show_on_pos=1, mode="remove")
		log.check(registry.get_pinned_items(p1) == [c, a], "get_pinned_items drops item removed from outlet",
			registry.get_pinned_items(p1))
		g = {x["item_code"]: x for x in ma.get_pinned(p1)}
		log.check(g.get(b) and g[b]["on_outlet"] is False and g[a]["on_outlet"], "Admin sees the stale pin flagged")
		frappe.db.set_value("Item", a, "disabled", 1)
		log.check(registry.get_pinned_items(p1) == [c], "Disabled item dropped from get_pinned_items")
		frappe.db.set_value("Item", a, "disabled", 0)

		# max 24
		expect_error(log, "set_pinned over 24 refused", frappe.ValidationError, ma.set_pinned, p1, many)
		ma.set_pinned(p1, many[:24])
		log.check(len(registry.get_pinned_items(p1)) == 24, "24 pins allowed")
		expect_error(log, "pin_items over 24 refused", frappe.ValidationError, ma.pin_items, p1, [many[24]])
		frappe.db.set_value("POS Profile", p1, ma.PINNED_FIELD, json.dumps(many))
		log.check(registry.get_pinned_items(p1) == many[:24], "get_pinned_items caps at 24")
		r = ma.set_pinned(p1, [])
		log.check(r == [] and registry.get_pinned_items(p1) == [], "Clearing pins")

		# permissions
		frappe.set_user(plain)
		expect_error(log, "Non-manager refused (get)", frappe.PermissionError, ma.get_pinned, p1)
		expect_error(log, "Non-manager refused (set)", frappe.PermissionError, ma.set_pinned, p1, [c])
		expect_error(log, "Non-manager refused (pin)", frappe.PermissionError, ma.pin_items, p1, [c])
		frappe.set_user(me)
		log.check(ma.pin_items(p1, [c])[0]["item_code"] == c, "System Manager can pin")
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
