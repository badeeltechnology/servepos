"""Bulk outlet visibility for the ServePOS web admin (/pos > Menu, Item Visibility).

Item visibility lives in the "ServePOS Item Availability" child table on Item
(branch, pos_profile, show_on_pos, show_on_website). Items without rows fall back
to the legacy comma field ``servepos_visible_profiles`` (empty = every outlet).
See ``servepos.api.registry`` for how tills read it.

Every change here:
  * keeps what an item already shows (legacy lists and catch-all rows are turned
    into explicit rows before a profile is added or removed),
  * writes child rows directly (fast for thousands of items) in one transaction,
  * bumps Item.modified / modified_by so tills pick the change up on their next
    incremental sync, and leaves an Info comment on each changed item.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, now

from servepos.api import registry

MANAGER_ROLES = {"System Manager", "ServePOS Manager"}
AVAIL_DT = "ServePOS Item Availability"
MODIFIER_DT = "ServePOS Modifier Group"
MAX_ITEMS = 5000
CHUNK = 500


# ---- guards / parsing -----------------------------------------------------


def _assert_manager():
	"""Same rule as the other ServePOS admin endpoints (servepos.api.mobile.admin)."""
	user = frappe.session.user
	if user == "Administrator":
		return
	if not MANAGER_ROLES & set(frappe.get_roles(user)):
		frappe.throw(_("Only a ServePOS Manager can change outlet menus"), frappe.PermissionError)


def _as_list(value, what):
	if value is None or value == "":
		return []
	if isinstance(value, str):
		value = value.strip()
		if value.startswith("["):
			value = json.loads(value)
		else:
			value = [v for v in value.split(",")]
	if not isinstance(value, (list, tuple)):
		frappe.throw(_("{0} must be a list").format(what))
	out, seen = [], set()
	for v in value:
		v = str(v or "").strip()
		if v and v not in seen:
			seen.add(v)
			out.append(v)
	return out


def _flag(value, default=None):
	"""None / '' -> default (leave unchanged); anything else -> 0 or 1."""
	if value is None or value == "" or value == "null":
		return default
	if isinstance(value, str) and value.lower() in ("false", "no"):
		return 0
	if isinstance(value, str) and value.lower() in ("true", "yes"):
		return 1
	return 1 if cint(value) else 0


def _profiles():
	"""{name: branch} for every enabled POS Profile."""
	rows = frappe.get_all("POS Profile", filters={"disabled": 0}, fields=["name", "branch"], limit=0)
	return {r.name: (r.branch or "") for r in rows}


def _all_profiles():
	rows = frappe.get_all("POS Profile", fields=["name", "branch"], limit=0)
	return {r.name: (r.branch or "") for r in rows}


def _check_profiles(names):
	known = _all_profiles()
	missing = [n for n in names if n not in known]
	if missing:
		frappe.throw(_("POS Profile not found: {0}").format(", ".join(missing)))
	return {n: known[n] for n in names}


def _chunks(seq, size=CHUNK):
	seq = list(seq)
	for i in range(0, len(seq), size):
		yield seq[i : i + size]


# ---- core: change availability rows --------------------------------------


def _load_items(item_codes):
	fields = ["name", "disabled"]
	for f in ("servepos_visible_profiles", "servepos_show_on_website"):
		if registry._has_field("Item", f):
			fields.append(f)
	out = {}
	for chunk in _chunks(item_codes):
		for r in frappe.get_all("Item", filters={"name": ["in", chunk]}, fields=fields, limit=0):
			out[r.name] = r
	return out


def _load_rows(item_codes):
	out = {}
	for chunk in _chunks(item_codes):
		rows = frappe.get_all(
			AVAIL_DT,
			filters={"parenttype": "Item", "parentfield": "servepos_availability", "parent": ["in", chunk]},
			fields=["name", "parent", "idx", "branch", "pos_profile", "show_on_pos", "show_on_website"],
			order_by="idx asc",
			limit=0,
		)
		for r in rows:
			out.setdefault(r.parent, []).append(
				{
					"name": r.name,
					"idx": cint(r.idx),
					"branch": r.branch or "",
					"pos_profile": r.pos_profile or "",
					"show_on_pos": cint(r.show_on_pos),
					"show_on_website": cint(r.show_on_website),
				}
			)
	return out


def _new_row(branch, profile, pos, web):
	return {
		"name": None,
		"idx": 0,
		"branch": branch or "",
		"pos_profile": profile or "",
		"show_on_pos": 1 if pos else 0,
		"show_on_website": 1 if web else 0,
	}


def _legacy_rows(item, enabled_profiles, all_profiles):
	"""Rows that reproduce what the legacy field shows today."""
	web = cint(item.get("servepos_show_on_website"))
	raw = (item.get("servepos_visible_profiles") or "").strip()
	names = [p.strip() for p in raw.split(",") if p.strip()]
	if not names:
		# empty legacy list = visible on every outlet: one catch-all row
		return [_new_row("", "", 1, web)]
	return [_new_row(all_profiles[p], p, 1, web) for p in names if p in all_profiles]


def _covers(row, profile, branch):
	"""Does a wildcard row (blank pos_profile) apply to this profile?"""
	if row["pos_profile"]:
		return False
	return not row["branch"] or not branch or row["branch"] == branch


def _explicit(rows, profile):
	for r in rows:
		if r["pos_profile"] == profile:
			return r
	return None


def _expand_wildcards(rows, profile, branch, channels, enabled_profiles):
	"""A catch-all/branch-wide row that grants `profile` a channel being removed is replaced
	by explicit rows for every enabled outlet it covered, so the other outlets keep the item."""
	out = list(rows)
	for w in [r for r in rows if _covers(r, profile, branch)]:
		if not any(w[c] for c in channels):
			continue
		out.remove(w)
		for p, b in enabled_profiles.items():
			if w["branch"] and b and w["branch"] != b:
				continue
			ex = _explicit(out, p)
			if ex:
				ex["show_on_pos"] = ex["show_on_pos"] or w["show_on_pos"]
				ex["show_on_website"] = ex["show_on_website"] or w["show_on_website"]
			else:
				out.append(_new_row(b, p, w["show_on_pos"], w["show_on_website"]))
	return out


def apply_item_outlets(item_codes, targets, show_on_pos=1, show_on_website=None, mode="add", note=None):
	"""Core of set_item_outlets (no permission check, no commit).

	targets: {pos_profile: branch}
	add:    show_on_pos / show_on_website = 1 or 0 sets that flag on the outlet, None leaves it.
	remove: a flag of 1 takes that channel away from the outlet; None/0 leaves it.
	"""
	if mode not in ("add", "remove"):
		frappe.throw(_("mode must be add or remove"))
	pos_f = _flag(show_on_pos, None)
	web_f = _flag(show_on_website, None)
	remove_channels = [c for c, f in (("show_on_pos", pos_f), ("show_on_website", web_f)) if f]
	if mode == "remove" and not remove_channels:
		frappe.throw(_("Pick Show on POS and/or Show on website to remove"))
	if mode == "add" and pos_f is None and web_f is None:
		frappe.throw(_("Pick Show on POS and/or Show on website"))

	stats = {"updated": 0, "unchanged": 0, "converted_legacy": 0, "skipped_disabled": 0, "skipped_missing": 0}
	if not item_codes or not targets:
		return stats

	enabled_profiles = _profiles()
	all_profiles = _all_profiles()
	items = _load_items(item_codes)
	existing = _load_rows(item_codes)

	inserts, updates, deletes, changed = [], [], [], []
	for code in item_codes:
		item = items.get(code)
		if not item:
			stats["skipped_missing"] += 1
			continue
		if cint(item.disabled):
			stats["skipped_disabled"] += 1
			continue
		before = existing.get(code) or []
		rows = [dict(r) for r in before]
		converted = False
		if not rows:
			rows = _legacy_rows(item, enabled_profiles, all_profiles)
			converted = True

		for profile, branch in targets.items():
			if mode == "add":
				row = _explicit(rows, profile)
				if row is None:
					row = _new_row(branch, profile, 0, 0)
					rows.append(row)
				row["branch"] = branch or row["branch"]
				if pos_f is not None:
					row["show_on_pos"] = pos_f
				if web_f is not None:
					row["show_on_website"] = web_f
			else:
				rows = _expand_wildcards(rows, profile, branch, remove_channels, enabled_profiles)
				row = _explicit(rows, profile)
				if row:
					for c in remove_channels:
						row[c] = 0

		live = [r for r in rows if r["show_on_pos"] or r["show_on_website"]]
		if not live:
			# An item with no rows falls back to the legacy field (empty = every outlet),
			# so keep one switched-off row to say "shown nowhere".
			live = [next((r for r in rows if r["name"] and not r["pos_profile"]), None) or _new_row("", "", 0, 0)]
			live[0].update({"branch": "", "pos_profile": "", "show_on_pos": 0, "show_on_website": 0})
		rows = live

		# diff against what is stored
		by_name = {r["name"]: r for r in before}
		kept = {r["name"] for r in rows if r["name"]}
		item_changed = False
		for r in before:
			if r["name"] not in kept:
				deletes.append(r["name"])
				item_changed = True
		next_idx = max([r["idx"] for r in before] or [0])
		for r in rows:
			if r["name"]:
				old = by_name[r["name"]]
				if any(old[k] != r[k] for k in ("branch", "pos_profile", "show_on_pos", "show_on_website")):
					updates.append(r)
					item_changed = True
			else:
				next_idx += 1
				r["idx"] = next_idx
				inserts.append((code, r))
				item_changed = True

		if item_changed:
			stats["updated"] += 1
			if converted:
				stats["converted_legacy"] += 1
			changed.append(code)
		else:
			stats["unchanged"] += 1

	_write(inserts, updates, deletes, changed, note)
	return stats


def _write(inserts, updates, deletes, changed, note):
	ts, user = now(), frappe.session.user
	for chunk in _chunks(deletes):
		frappe.db.delete(AVAIL_DT, {"name": ["in", chunk]})
	for r in updates:
		frappe.db.sql(
			f"""update `tab{AVAIL_DT}` set branch=%s, pos_profile=%s, show_on_pos=%s,
			show_on_website=%s, modified=%s, modified_by=%s where name=%s""",
			(r["branch"] or None, r["pos_profile"] or None, r["show_on_pos"], r["show_on_website"], ts, user, r["name"]),
		)
	if inserts:
		fields = [
			"name", "parent", "parenttype", "parentfield", "idx", "docstatus", "owner", "modified_by",
			"creation", "modified", "branch", "pos_profile", "show_on_pos", "show_on_website",
		]
		values = [
			(
				frappe.generate_hash(length=10), code, "Item", "servepos_availability", r["idx"], 0, user, user,
				ts, ts, r["branch"] or None, r["pos_profile"] or None, r["show_on_pos"], r["show_on_website"],
			)
			for code, r in inserts
		]
		frappe.db.bulk_insert(AVAIL_DT, fields, values)
	if not changed:
		return
	for chunk in _chunks(changed):
		frappe.db.sql(
			"update `tabItem` set modified=%s, modified_by=%s where name in %s",
			(ts, user, tuple(chunk)),
		)
	content = note or _("Outlet visibility changed from the ServePOS admin")
	comment_fields = [
		"name", "comment_type", "reference_doctype", "reference_name", "content", "comment_email",
		"owner", "modified_by", "creation", "modified", "docstatus",
	]
	frappe.db.bulk_insert(
		"Comment",
		comment_fields,
		[(frappe.generate_hash(length=10), "Info", "Item", c, content, user, user, user, ts, ts, 0) for c in changed],
	)
	for c in changed:
		frappe.clear_document_cache("Item", c)


# ---- whitelisted endpoints ------------------------------------------------


@frappe.whitelist(methods=["POST"])
def set_item_outlets(items, pos_profiles, show_on_pos=1, show_on_website=None, mode="add"):
	"""Add or remove outlets (POS Profiles) for many items in one call.

	mode=add:    show the items on each outlet (show_on_pos / show_on_website 1 = on, 0 = off, None = leave).
	mode=remove: take the ticked channel(s) away from each outlet.
	Returns {updated, unchanged, converted_legacy, skipped_disabled, skipped_missing}.
	"""
	_assert_manager()
	item_codes = _as_list(items, "items")
	profiles = _as_list(pos_profiles, "pos_profiles")
	if not item_codes:
		frappe.throw(_("Select at least one item"))
	if len(item_codes) > MAX_ITEMS:
		frappe.throw(_("At most {0} items per call").format(MAX_ITEMS))
	if not profiles:
		frappe.throw(_("Select at least one outlet"))
	targets = _check_profiles(profiles)
	verb = _("added to") if mode == "add" else _("removed from")
	note = _("Outlet visibility: {0} {1} (ServePOS admin)").format(verb, ", ".join(profiles))
	return apply_item_outlets(item_codes, targets, show_on_pos, show_on_website, mode, note)


def _visible_items(pos_profile, channel="pos"):
	"""Enabled items shown on the outlet for the channel (ignores the temporary
	'available' / 86 switch, so an item that is out of stock today still counts)."""
	branch = frappe.db.get_value("POS Profile", pos_profile, "branch")
	filters = [["disabled", "=", 0]]
	if registry._has_field("Item", "servepos_is_disabled"):
		filters.append(["servepos_is_disabled", "=", 0])
	fields = ["name"]
	for f in ("servepos_visible_profiles", "servepos_show_on_website"):
		if registry._has_field("Item", f):
			fields.append(f)
	avail = registry._get_availability_map(channel)
	out = set()
	for r in frappe.get_all("Item", filters=filters, fields=fields, limit=0):
		rows = avail.get(r.name)
		if rows is not None:
			ok = registry._item_visible_via_availability(rows, pos_profile, branch, channel)
		else:
			ok = registry._visible_to_profile(r.get("servepos_visible_profiles"), pos_profile)
			if ok and channel == "website":
				ok = bool(cint(r.get("servepos_show_on_website")))
		if ok:
			out.add(r.name)
	return out


def _modifier_plan(source, target, mode, all_profile_names):
	if not frappe.db.exists("DocType", MODIFIER_DT) or not registry._has_field(MODIFIER_DT, "servepos_visible_profiles"):
		return []
	plan = []
	for g in frappe.get_all(MODIFIER_DT, fields=["name", "servepos_visible_profiles"], limit=0):
		raw = g.servepos_visible_profiles or ""
		on_src = registry._visible_to_profile(raw, source)
		on_tgt = registry._visible_to_profile(raw, target)
		names = [p.strip() for p in raw.split(",") if p.strip()]
		if on_src and not on_tgt:
			plan.append((g.name, ",".join(names + [target])))
		elif mode == "replace" and on_tgt and not on_src:
			base = names or list(all_profile_names)
			plan.append((g.name, ",".join(p for p in base if p != target)))
	return plan


def _merged_order(source, target, mode):
	src = registry._get_menu_item_order(source)
	if mode == "replace":
		return src
	tgt = registry._get_menu_item_order(target)
	out = {k: list(v) if isinstance(v, list) else v for k, v in src.items()}
	for key, val in tgt.items():
		if not isinstance(val, list):
			out.setdefault(key, val)
			continue
		cur = out.setdefault(key, [])
		if isinstance(cur, list):
			cur.extend(v for v in val if v not in cur)
	return out


@frappe.whitelist(methods=["POST"])
def copy_outlet_menu(source_profile, target_profile, mode="add", copy_order=1, copy_modifier_groups=1, preview=1):
	"""Make the target outlet show the same items as the source outlet (POS channel).

	mode=add:     items on the source are added to the target; nothing is removed.
	mode=replace: also takes off the target every item the source does not show.
	copy_order:   copy the source's category/item order (merged in add mode).
	copy_modifier_groups: modifier groups shown on the source are shown on the target too
	              (replace also hides groups the source does not show).
	preview=1 returns the counts only and writes nothing.
	"""
	_assert_manager()
	if not source_profile or not target_profile:
		frappe.throw(_("Pick a source and a target outlet"))
	if source_profile == target_profile:
		frappe.throw(_("Source and target must be different outlets"))
	if mode not in ("add", "replace"):
		frappe.throw(_("mode must be add or replace"))
	targets = _check_profiles([source_profile, target_profile])
	copy_order, copy_mods, preview = cint(copy_order), cint(copy_modifier_groups), cint(preview)

	src = _visible_items(source_profile)
	tgt = _visible_items(target_profile)
	to_add = sorted(src - tgt)
	to_remove = sorted(tgt - src) if mode == "replace" else []
	mod_plan = _modifier_plan(source_profile, target_profile, mode, _all_profiles().keys()) if copy_mods else []
	has_order = bool(registry._get_menu_item_order(source_profile))

	result = {
		"source_items": len(src),
		"target_items_before": len(tgt),
		"already_on_both": len(src & tgt),
		"to_add": len(to_add),
		"to_remove": len(to_remove),
		"target_items_after": len(tgt) + len(to_add) - len(to_remove),
		"modifier_groups_to_change": len(mod_plan),
		"copy_order": bool(copy_order and has_order),
		"preview": bool(preview),
	}
	if preview:
		return result

	tgt_map = {target_profile: targets[target_profile]}
	note = _("Outlet visibility: menu copied from {0} to {1} (ServePOS admin)").format(source_profile, target_profile)
	added = apply_item_outlets(to_add, tgt_map, 1, None, "add", note) if to_add else {}
	removed = apply_item_outlets(to_remove, tgt_map, 1, None, "remove", note) if to_remove else {}
	result["items_added"] = added.get("updated", 0)
	result["items_removed"] = removed.get("updated", 0)
	result["converted_legacy"] = added.get("converted_legacy", 0) + removed.get("converted_legacy", 0)

	for name, value in mod_plan:
		frappe.db.set_value(MODIFIER_DT, name, "servepos_visible_profiles", value)
	result["modifier_groups_changed"] = len(mod_plan)

	if copy_order and has_order:
		frappe.db.set_value(
			"POS Profile", target_profile, "servepos_menu_item_order",
			json.dumps(_merged_order(source_profile, target_profile, mode)),
		)
		frappe.clear_document_cache("POS Profile", target_profile)
	return result


@frappe.whitelist()
def get_visibility_matrix(items):
	"""{item: {pos_profile: {"pos": bool, "web": bool}}} computed the way tills and the
	online store read it (availability rows first, legacy field as fallback)."""
	_assert_manager()
	item_codes = _as_list(items, "items")[:MAX_ITEMS]
	profiles = _all_profiles()
	data = _load_items(item_codes)
	rows = _load_rows(item_codes)
	out = {}
	for code in item_codes:
		it = data.get(code)
		if not it:
			continue
		r = rows.get(code)
		cell = {}
		for p, b in profiles.items():
			if r:
				pos = registry._item_visible_via_availability(r, p, b or None, "pos")
				web = registry._item_visible_via_availability(r, p, b or None, "website")
			else:
				pos = registry._visible_to_profile(it.get("servepos_visible_profiles"), p)
				web = pos and bool(cint(it.get("servepos_show_on_website")))
			cell[p] = {"pos": bool(pos), "web": bool(web)}
		out[code] = cell
	return out


@frappe.whitelist()
def list_item_codes(item_groups=None, item_group=None, search=None):
	"""Every enabled item matching the Menu page filters (for "select all N matching")."""
	_assert_manager()
	filters = [["disabled", "=", 0]]
	groups = _as_list(item_groups, "item_groups")
	if item_group:
		filters.append(["item_group", "=", item_group])
	elif groups:
		filters.append(["item_group", "in", groups])
	if search:
		filters.append(["item_name", "like", f"%{search}%"])
	return [r.name for r in frappe.get_all("Item", filters=filters, fields=["name"], order_by="item_name asc", limit=0)]


# ---- pinned favourites (the till's Popular tab) -----------------------------

PINNED_FIELD = "servepos_pinned_items"


def _pinned_rows(codes, on_outlet=None):
	if not codes:
		return []
	data = {
		r.name: r
		for r in frappe.get_all(
			"Item", filters={"name": ["in", codes]}, fields=["name", "item_name", "item_group", "standard_rate"], limit=0
		)
	}
	out = []
	for c in codes:
		r = data.get(c)
		if not r:
			continue
		row = {"item_code": c, "item_name": r.item_name, "item_group": r.item_group, "rate": r.standard_rate or 0}
		if on_outlet is not None:
			row["on_outlet"] = c in on_outlet
		out.append(row)
	return out


def _save_pinned(pos_profile, codes):
	if len(codes) > registry.MAX_PINNED_ITEMS:
		frappe.throw(_("At most {0} pinned items per outlet").format(registry.MAX_PINNED_ITEMS))
	# set_value bumps POS Profile.modified so tills re-read the pins on their next sync
	frappe.db.set_value("POS Profile", pos_profile, PINNED_FIELD, json.dumps(codes))
	frappe.clear_document_cache("POS Profile", pos_profile)
	return _pinned_rows(codes, _visible_items(pos_profile))


def _check_pinnable(pos_profile, codes):
	visible = _visible_items(pos_profile)
	bad = [c for c in codes if c not in visible]
	if bad:
		frappe.throw(
			_("Not on the {0} menu, add them to the outlet first: {1}").format(pos_profile, ", ".join(bad[:10]))
		)


def _pin_profile(pos_profile):
	_assert_manager()
	if not pos_profile:
		frappe.throw(_("Pick an outlet"))
	_check_profiles([pos_profile])
	if not registry._has_field("POS Profile", PINNED_FIELD):
		frappe.throw(_("Pinned items field is missing, run bench migrate"))


@frappe.whitelist()
def get_pinned(pos_profile):
	"""Pinned favourites of an outlet in order: [{item_code, item_name, item_group, rate, on_outlet}].
	on_outlet=False marks a pin the till hides because the item left the outlet menu."""
	_pin_profile(pos_profile)
	return _pinned_rows(registry._get_pinned_codes(pos_profile), _visible_items(pos_profile))


@frappe.whitelist(methods=["POST"])
def set_pinned(pos_profile, items):
	"""Replace the outlet's pinned list (ordered item codes, deduped, max 24, all on the outlet menu)."""
	_pin_profile(pos_profile)
	codes = _as_list(items, "items")
	if len(codes) > registry.MAX_PINNED_ITEMS:
		frappe.throw(_("At most {0} pinned items per outlet").format(registry.MAX_PINNED_ITEMS))
	_check_pinnable(pos_profile, codes)
	return _save_pinned(pos_profile, codes)


@frappe.whitelist(methods=["POST"])
def pin_items(pos_profile, items, mode="add"):
	"""mode=add appends items not yet pinned (keeps the current order); mode=remove unpins them."""
	_pin_profile(pos_profile)
	if mode not in ("add", "remove"):
		frappe.throw(_("mode must be add or remove"))
	codes = _as_list(items, "items")
	if not codes:
		frappe.throw(_("Select at least one item"))
	current = registry._get_pinned_codes(pos_profile)
	if mode == "add":
		new = [c for c in codes if c not in current]
		_check_pinnable(pos_profile, new)
		result = current + new
	else:
		drop = set(codes)
		result = [c for c in current if c not in drop]
	return _save_pinned(pos_profile, result)
