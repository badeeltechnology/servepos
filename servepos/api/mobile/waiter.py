"""ServePOS Mobile API v2: menu, floor and orders for the waiter app.

Every call is made as the waiter's own User (device token, see security.py).
Prices always come from the server: Item.standard_rate (the same rate the
desktop POS and the guest menu use) plus ServePOS Modifier prices. Orders are
stored in the existing **ServePOS Waiter Order** doctype so the desktop POS
keeps polling/accepting them unchanged.
"""

import hashlib
import json
import re
from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, flt, now_datetime

from servepos.api import registry
from servepos.api.mobile import security

WO = "ServePOS Waiter Order"
WO_ITEM = "ServePOS Waiter Order Item"
OPEN_STATUSES = ["Pending", "Accepted", "In Kitchen", "Ready", "Served"]
ORDER_TYPES = ("Dine In", "Takeaway")

MAX_ITEMS = 100
MAX_MODIFIERS = 30
MAX_QTY = 999
MAX_GUESTS = 200
MAX_NOTE = 500
MAX_LIST = 100
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def _json_arg(value, label):
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			frappe.throw(_("Invalid {0}").format(label))
	return value


def _text(value, max_len=MAX_NOTE):
	if value is None:
		return ""
	if not isinstance(value, str | int | float):
		frappe.throw(_("Invalid text value"))
	return str(value).strip()[:max_len]


def _request_id(value):
	if not isinstance(value, str) or not REQUEST_ID_RE.match(value.strip()):
		frappe.throw(_("client_request_id is required (UUID)"))
	return value.strip()


def _precision():
	return cint(frappe.db.get_single_value("System Settings", "currency_precision")) or 2


def _profile_currency(pos_profile):
	return frappe.db.get_value("POS Profile", pos_profile, "currency") or frappe.db.get_default("currency")


def _has(doctype, field):
	return frappe.get_meta(doctype).has_field(field)


def _time(value):
	if not value:
		return None
	if isinstance(value, timedelta):
		return (datetime.min + value).time()
	if isinstance(value, str):
		h, m, *s = [*value.split(".")[0].split(":"), "0"][:3]
		return datetime.min.replace(hour=int(h), minute=int(m), second=int(s[0] or 0)).time()
	return value


def _check_order_hours(settings):
	start, end = _time(settings.order_start_time), _time(settings.order_end_time)
	if not (start and end):
		return
	now = now_datetime().time()
	inside = (start <= now <= end) if start <= end else not (end < now < start)
	if not inside:
		frappe.throw(
			_("Waiter orders are open from {0} to {1}").format(start.strftime("%H:%M"), end.strftime("%H:%M"))
		)


def _str_time(value):
	return str(value) if value else None


# --------------------------------------------------------------------------- #
# Menu (shared by bootstrap and server-side pricing)
# --------------------------------------------------------------------------- #


def _item_modifier_links():
	"""{(parenttype, parent): [ {modifier_group, is_required, display_order} ]}"""
	links = frappe.get_all(
		"ServePOS Item Modifier Group",
		filters={"parenttype": ["in", ["Item", "Item Group"]]},
		fields=["parent", "parenttype", "modifier_group", "is_required", "display_order"],
		order_by="display_order asc, idx asc",
		limit=0,
	)
	out = {}
	for link in links:
		out.setdefault((link.parenttype, link.parent), []).append(link)
	return out


def _visible_modifier_groups(pos_profile):
	"""{group_name: {name, selection_type, is_required, max_selections, modifiers:[...]}}"""
	fields = ["name", "selection_type", "is_required", "max_selections"]
	if _has("ServePOS Modifier Group", "servepos_visible_profiles"):
		fields.append("servepos_visible_profiles")
	rows = registry._filter_by_visible_profiles(
		frappe.get_all("ServePOS Modifier Group", fields=fields, limit=0), pos_profile
	)
	mods_by_group = {}
	for m in frappe.get_all(
		"ServePOS Modifier",
		filters={"parenttype": "ServePOS Modifier Group", "parent": ["in", [g.name for g in rows] or [""]]},
		fields=["parent", "modifier_name", "price", "is_default"],
		order_by="parent asc, idx asc",
		limit=0,
	):
		lst = mods_by_group.setdefault(m.parent, [])
		if m.modifier_name and m.modifier_name not in [x["name"] for x in lst]:
			lst.append(
				{"name": m.modifier_name, "price": flt(m.price), "is_default": bool(cint(m.is_default))}
			)
	groups = {}
	for g in rows:
		groups[g.name] = {
			"name": g.name,
			"selection_type": g.selection_type or "Single",
			"is_required": bool(cint(g.is_required)),
			"max_selections": cint(g.max_selections),
			"modifiers": mods_by_group.get(g.name, []),
		}
	return groups


def _groups_for_item(item_code, item_group, links, visible_groups):
	rows = links.get(("Item", item_code)) or links.get(("Item Group", item_group)) or []
	out = []
	for r in rows:
		if r.modifier_group in visible_groups and r.modifier_group not in [o["group"] for o in out]:
			out.append({"group": r.modifier_group, "is_required": bool(cint(r.is_required))})
	return out


def _profile_items(profile_doc, item_codes=None):
	"""Items on this profile (enabled, visible). Includes sold-out items with is_available=0."""
	pos_profile = profile_doc.name
	filters = [["disabled", "=", 0]]
	if _has("Item", "servepos_is_disabled"):
		filters.append(["servepos_is_disabled", "=", 0])
	if item_codes is not None:
		filters.append(["name", "in", list(item_codes) or [""]])
	fields = ["name", "item_name", "item_group", "standard_rate", "description", "image", "modified"]
	for f in ("servepos_item_name_ar", "servepos_visible_profiles", "servepos_is_available"):
		if _has("Item", f):
			fields.append(f)
	rows = frappe.get_all("Item", filters=filters, fields=fields, order_by="item_name asc", limit=0)
	avail_map = registry._get_availability_map("pos")
	branch = getattr(profile_doc, "branch", None)
	out = []
	for row in rows:
		avail_rows = avail_map.get(row.name)
		if avail_rows is not None:
			ok = registry._item_visible_via_availability(avail_rows, pos_profile, branch, "pos")
		else:
			ok = registry._visible_to_profile(row.get("servepos_visible_profiles"), pos_profile)
		if ok:
			row["is_available"] = bool(cint(row.get("servepos_is_available", 1)))
			out.append(row)
	return out


def build_menu(pos_profile):
	profile_doc = frappe.get_cached_doc("POS Profile", pos_profile)
	visible_groups = _visible_modifier_groups(pos_profile)
	links = _item_modifier_links()
	rows = registry._apply_profile_sort_order(_profile_items(profile_doc), pos_profile)

	items, used_groups, item_groups = [], set(), []
	for idx, r in enumerate(rows):
		mgs = _groups_for_item(r.name, r.item_group, links, visible_groups)
		used_groups.update(m["group"] for m in mgs)
		if r.item_group not in item_groups:
			item_groups.append(r.item_group)
		items.append(
			{
				"item_code": r.name,
				"item_name": r.item_name,
				"item_name_ar": r.get("servepos_item_name_ar") or None,
				"item_group": r.item_group,
				"rate": flt(r.standard_rate),
				"image": r.image or None,
				"description": r.description or "",
				"is_available": r.is_available,
				"modifier_groups": [m["group"] for m in mgs],
				"sort": idx + 1,
			}
		)

	group_rows = registry._apply_category_sort_order([{"name": g} for g in item_groups], pos_profile)
	ar_field = "servepos_item_group_name_ar" if _has("Item Group", "servepos_item_group_name_ar") else None
	groups_out = []
	for idx, g in enumerate(group_rows):
		groups_out.append(
			{
				"name": g["name"],
				"name_ar": (frappe.db.get_value("Item Group", g["name"], ar_field) if ar_field else None)
				or None,
				"sort": idx + 1,
				"color": None,
			}
		)

	mod_groups = [visible_groups[g] for g in sorted(used_groups)]

	rooms = [
		{"name": r["name"], "room_name": r.get("room_name") or r["name"]}
		for r in registry.get_rooms(pos_profile)
		if cint(r.get("is_active", 1))
	]
	tables = [
		{
			"name": t["name"],
			"table_name": t.get("table_name") or t["name"],
			"room": t.get("room"),
			"capacity": cint(t.get("capacity")),
		}
		for t in registry.get_tables(pos_profile)
		if cint(t.get("is_active", 1))
	]
	return {
		"item_groups": groups_out,
		"items": items,
		"modifier_groups": mod_groups,
		"rooms": rooms,
		"tables": tables,
	}


# --------------------------------------------------------------------------- #
# Server-side pricing
# --------------------------------------------------------------------------- #


def price_lines(pos_profile, lines, added_by, round_no):
	"""Validate client lines and return Waiter Order Item rows priced from master data.

	Client-sent rate / price / modifier_total / item_name are ignored.
	"""
	lines = _json_arg(lines, "items")
	if not isinstance(lines, list) or not lines:
		frappe.throw(_("At least one item is required"))
	if len(lines) > MAX_ITEMS:
		frappe.throw(_("Too many items in one order (max {0})").format(MAX_ITEMS))

	codes = set()
	for ln in lines:
		if not isinstance(ln, dict) or not isinstance(ln.get("item_code"), str) or not ln["item_code"]:
			frappe.throw(_("Each item needs an item_code"))
		codes.add(ln["item_code"])

	profile_doc = frappe.get_cached_doc("POS Profile", pos_profile)
	items = {r.name: r for r in _profile_items(profile_doc, codes)}
	visible_groups = _visible_modifier_groups(pos_profile)
	links = _item_modifier_links()
	prec = _precision()

	rows = []
	for ln in lines:
		code = ln["item_code"]
		item = items.get(code)
		if not item:
			frappe.throw(_("Item {0} is not on this menu").format(code))
		if not item.is_available:
			frappe.throw(_("{0} is not available right now").format(item.item_name))
		qty = flt(ln.get("qty", 1))
		if qty <= 0 or qty > MAX_QTY:
			frappe.throw(_("Invalid quantity for {0}").format(item.item_name))

		allowed = {m["group"]: m for m in _groups_for_item(code, item.item_group, links, visible_groups)}
		chosen = _json_arg(ln.get("modifiers") or [], "modifiers")
		if not isinstance(chosen, list) or len(chosen) > MAX_MODIFIERS:
			frappe.throw(_("Invalid modifiers for {0}").format(item.item_name))
		picked, per_group = [], {}
		for m in chosen:
			if not isinstance(m, dict):
				frappe.throw(_("Invalid modifiers for {0}").format(item.item_name))
			group, name = m.get("group"), m.get("name")
			if group not in allowed:
				frappe.throw(_("Modifier group {0} is not available for {1}").format(group, item.item_name))
			master = next((x for x in visible_groups[group]["modifiers"] if x["name"] == name), None)
			if not master:
				frappe.throw(_("Modifier {0} not found in {1}").format(name, group))
			if any(p["group"] == group and p["name"] == name for p in picked):
				continue
			picked.append({"group": group, "name": name, "price": flt(master["price"], prec)})
			per_group[group] = per_group.get(group, 0) + 1

		for group, link in allowed.items():
			g = visible_groups[group]
			n = per_group.get(group, 0)
			if (link["is_required"] or g["is_required"]) and n == 0:
				frappe.throw(_("Please choose {0} for {1}").format(group, item.item_name))
			if g["selection_type"] == "Single" and n > 1:
				frappe.throw(_("Choose only one {0} for {1}").format(group, item.item_name))
			if g["max_selections"] and n > g["max_selections"]:
				frappe.throw(
					_("Choose at most {0} {1} for {2}").format(g["max_selections"], group, item.item_name)
				)

		modifier_total = flt(sum(p["price"] for p in picked), prec)
		rows.append(
			{
				"item_code": code,
				"item_name": item.item_name,
				"qty": qty,
				"rate": flt(item.standard_rate, prec),
				# desktop POS reads name/price; group is extra
				"modifiers": json.dumps(picked) if picked else "",
				"modifier_total": modifier_total,
				"special_instructions": _text(ln.get("special_instructions")),
				"round_no": round_no,
				"added_by": added_by,
			}
		)
	return rows


# --------------------------------------------------------------------------- #
# Order shape
# --------------------------------------------------------------------------- #


def _parse_modifiers(raw):
	if not raw:
		return []
	try:
		data = json.loads(raw) if isinstance(raw, str) else raw
	except ValueError:
		return []
	out = []
	for m in data if isinstance(data, list) else []:
		if isinstance(m, dict):
			out.append({"group": m.get("group"), "name": m.get("name"), "price": flt(m.get("price"))})
	return out


def order_shapes(main_names):
	"""Contract Order shapes for main orders (rounds folded in), keeping input order."""
	if not main_names:
		return []
	fields = [
		"name",
		"status",
		"pos_profile",
		"table",
		"room",
		"order_type",
		"guests",
		"waiter",
		"waiter_name",
		"creation",
		"modified",
		"notes",
		"parent_order",
		"round_no",
	]
	mains = {
		o.name: o for o in frappe.get_all(WO, filters={"name": ["in", main_names]}, fields=fields, limit=0)
	}
	rounds = frappe.get_all(
		WO,
		filters={"parent_order": ["in", list(mains) or [""]], "status": ["!=", "Cancelled"]},
		fields=fields,
		order_by="round_no asc, creation asc",
		limit=0,
	)
	docs = list(mains.values()) + rounds
	item_rows = frappe.get_all(
		WO_ITEM,
		filters={"parenttype": WO, "parent": ["in", [d.name for d in docs] or [""]]},
		fields=[
			"parent",
			"item_code",
			"item_name",
			"qty",
			"rate",
			"modifiers",
			"modifier_total",
			"special_instructions",
			"round_no",
			"added_by",
			"idx",
		],
		order_by="idx asc",
		limit=0,
	)
	by_parent = {}
	for r in item_rows:
		by_parent.setdefault(r.parent, []).append(r)
	rounds_of = {}
	for r in rounds:
		rounds_of.setdefault(r.parent_order, []).append(r)

	prec = _precision()
	currencies = {}
	out = []
	for name in main_names:
		o = mains.get(name)
		if not o:
			continue
		items, modified = [], o.modified
		for d in [o, *rounds_of.get(o.name, [])]:
			modified = max(modified, d.modified)
			for it in by_parent.get(d.name, []):
				mt = flt(it.modifier_total)
				items.append(
					{
						"item_code": it.item_code,
						"item_name": it.item_name,
						"qty": flt(it.qty),
						"rate": flt(it.rate),
						"modifiers": _parse_modifiers(it.modifiers),
						"modifier_total": mt,
						"amount": flt((flt(it.rate) + mt) * flt(it.qty), prec),
						"special_instructions": it.special_instructions or "",
						"round": cint(it.round_no) or cint(d.round_no) or 1,
						"added_by": it.added_by or d.waiter_name,
					}
				)
		if o.pos_profile not in currencies:
			currencies[o.pos_profile] = _profile_currency(o.pos_profile)
		out.append(
			{
				"name": o.name,
				"status": o.status,
				"pos_profile": o.pos_profile,
				"table": o.table,
				"room": o.room,
				"order_type": o.order_type,
				"guests": cint(o.guests),
				"waiter": o.waiter_name,
				"created": str(o.creation.replace(microsecond=0)),
				"modified": str(modified.replace(microsecond=0)),
				"notes": o.notes or "",
				"total": flt(sum(i["amount"] for i in items), prec),
				"currency": currencies[o.pos_profile],
				"items": items,
			}
		)
	return out


def _shape(name):
	return order_shapes([name])[0]


def _main_of(name):
	if not name or not isinstance(name, str):
		frappe.throw(_("Order name is required"))
	row = frappe.db.get_value(WO, name, ["name", "parent_order", "pos_profile"], as_dict=True)
	if not row:
		frappe.throw(_("Order {0} not found").format(name), frappe.DoesNotExistError)
	if row.parent_order:
		row = frappe.db.get_value(WO, row.parent_order, ["name", "parent_order", "pos_profile"], as_dict=True)
	return row


def _existing_by_request(client_request_id):
	return frappe.db.get_value(
		WO, {"client_request_id": client_request_id}, ["name", "waiter", "parent_order"], as_dict=True
	)


def _replay(existing):
	if existing.waiter != frappe.session.user:
		frappe.throw(_("This request id was already used"), frappe.DuplicateEntryError)
	return _shape(existing.parent_order or existing.name)


def _insert_unique(doc, client_request_id):
	"""Insert; if a concurrent retry won the unique client_request_id, return that one."""
	try:
		doc.insert(ignore_permissions=True)
		return None
	except (frappe.UniqueValidationError, frappe.DuplicateEntryError):
		frappe.clear_messages()
		existing = _existing_by_request(client_request_id)
		if existing:
			return existing
		raise


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@frappe.whitelist(methods=["GET", "POST"])
def bootstrap(pos_profile=None, version=None):
	"""Everything the app caches for offline ordering, in one call."""
	waiter = security.current_waiter()
	profile = security.assert_profile_access(waiter, pos_profile)
	settings = security.get_settings()
	menu = build_menu(profile.name)
	data = {
		"currency": profile.currency or _profile_currency(profile.name),
		"currency_precision": _precision(),
		"settings": {
			"order_start_time": _str_time(settings.order_start_time),
			"order_end_time": _str_time(settings.order_end_time),
			"allow_cancel_pending": bool(cint(settings.allow_cancel_pending)),
		},
	}
	data.update(menu)
	digest = hashlib.sha1(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()[:16]
	if version and version == digest:
		return {"version": digest, "unchanged": True}
	out = {"version": digest}
	out.update(data)
	return out


@frappe.whitelist(methods=["GET", "POST"])
def tables(pos_profile=None):
	"""Live floor: every table with status and the open order summary."""
	waiter = security.current_waiter()
	profile = security.assert_profile_access(waiter, pos_profile)
	table_rows = [t for t in registry.get_tables(profile.name) if cint(t.get("is_active", 1))]
	status_map = dict(
		frappe.get_all(
			"ServePOS Table",
			filters={"name": ["in", [t["name"] for t in table_rows] or [""]]},
			fields=["name", "status"],
			as_list=True,
			limit=0,
		)
	)
	open_orders = frappe.get_all(
		WO,
		filters={
			"pos_profile": profile.name,
			"status": ["in", OPEN_STATUSES],
			"parent_order": ["is", "not set"],
			"table": ["is", "set"],
			"creation": [">=", add_to_date(now_datetime(), hours=-24)],
		},
		pluck="name",
		order_by="creation desc",
		limit=500,
	)
	latest = {}
	for shape in order_shapes(open_orders):
		latest.setdefault(shape["table"], shape)

	out = []
	for t in table_rows:
		o = latest.get(t["name"])
		if o:
			status = "Occupied"
		elif status_map.get(t["name"]) == "Reserved":
			status = "Reserved"
		else:
			status = "Available"
		row = {
			"name": t["name"],
			"table_name": t.get("table_name") or t["name"],
			"room": t.get("room"),
			"capacity": cint(t.get("capacity")),
			"status": status,
			"order": None,
		}
		if o:
			row["order"] = {
				"order": o["name"],
				"waiter": o["waiter"],
				"guests": o["guests"],
				"since": o["created"],
				"total": o["total"],
				"items_count": len(o["items"]),
				"status": o["status"],
			}
		out.append(row)
	return out


@frappe.whitelist(methods=["POST"])
def create_order(
	pos_profile=None,
	client_request_id=None,
	order_type="Dine In",
	table=None,
	room=None,
	guests=1,
	notes=None,
	items=None,
):
	"""Create an order. Same client_request_id again returns the first order."""
	waiter = security.current_waiter()
	profile = security.assert_profile_access(waiter, pos_profile)
	cid = _request_id(client_request_id)

	existing = _existing_by_request(cid)
	if existing:
		return _replay(existing)

	_check_order_hours(security.get_settings())
	order_type = order_type or "Dine In"
	if order_type not in ORDER_TYPES:
		frappe.throw(_("Invalid order type"))

	table_row = None
	if table:
		if not isinstance(table, str):
			frappe.throw(_("Invalid table"))
		table_row = next(
			(
				t
				for t in registry.get_tables(profile.name)
				if t["name"] == table and cint(t.get("is_active", 1))
			),
			None,
		)
		if not table_row:
			frappe.throw(_("Table {0} is not on this POS Profile").format(table))
	elif order_type == "Dine In":
		frappe.throw(_("Please choose a table"))

	room_name = table_row.get("room") if table_row else None
	if not room_name and room:
		if not isinstance(room, str) or room not in [r["name"] for r in registry.get_rooms(profile.name)]:
			frappe.throw(_("Room {0} is not on this POS Profile").format(room))
		room_name = room

	guests = cint(guests) or 1
	if guests < 1 or guests > MAX_GUESTS:
		frappe.throw(_("Invalid number of guests"))

	rows = price_lines(profile.name, items, waiter.name, 1)

	doc = frappe.new_doc(WO)
	doc.waiter_name = waiter.name
	doc.order_type = order_type
	doc.table = table_row["name"] if table_row else None
	doc.room = room_name
	doc.guests = guests
	doc.notes = _text(notes)
	doc.pos_profile = profile.name
	doc.branch = profile.branch
	doc.status = "Pending"
	doc.client_request_id = cid
	doc.round_no = 1
	for r in rows:
		doc.append("items", r)
	winner = _insert_unique(doc, cid)
	if winner:
		return _replay(winner)
	return _shape(doc.name)


@frappe.whitelist(methods=["POST"])
def add_items(order=None, client_request_id=None, items=None):
	"""Add a round to an open order of this profile.

	Each round is stored as its own Pending ServePOS Waiter Order linked through
	`parent_order`, so the desktop POS picks it up (and prints its KOT) exactly like
	a new order, even when the first round was already accepted. The response folds
	all rounds into the original order.
	"""
	waiter = security.current_waiter()
	cid = _request_id(client_request_id)
	existing = _existing_by_request(cid)
	if existing:
		return _replay(existing)

	main = _main_of(order)
	security.assert_profile_access(waiter, main.pos_profile)
	# lock the main order row so concurrent rounds get distinct numbers
	locked = frappe.db.sql(
		f"select status, `table`, room, order_type, guests, branch from `tab{WO}` where name=%s for update",
		main.name,
		as_dict=True,
	)[0]
	if locked.status not in OPEN_STATUSES:
		frappe.throw(_("Order {0} is {1}; start a new order").format(main.name, locked.status))
	_check_order_hours(security.get_settings())

	last_round = frappe.db.sql(
		f"select max(round_no) from `tab{WO}` where name=%s or parent_order=%s", (main.name, main.name)
	)[0][0]
	round_no = max(cint(last_round), 1) + 1
	rows = price_lines(main.pos_profile, items, waiter.name, round_no)

	doc = frappe.new_doc(WO)
	doc.waiter_name = waiter.name
	doc.order_type = locked.order_type
	doc.table = locked.table
	doc.room = locked.room
	doc.guests = cint(locked.guests) or 1
	doc.pos_profile = main.pos_profile
	doc.branch = locked.branch
	doc.status = "Pending"
	doc.notes = _("Round {0} of {1}").format(round_no, main.name)
	doc.client_request_id = cid
	doc.parent_order = main.name
	doc.round_no = round_no
	for r in rows:
		doc.append("items", r)
	winner = _insert_unique(doc, cid)
	if winner:
		return _replay(winner)
	return _shape(main.name)


@frappe.whitelist(methods=["GET", "POST"])
def my_orders(pos_profile=None, scope="mine", days=1):
	"""scope=mine: my orders of the last `days`; scope=all: the profile's open orders."""
	waiter = security.current_waiter()
	profile = security.assert_profile_access(waiter, pos_profile)
	days = min(max(cint(days) or 1, 1), 31)
	cutoff = add_to_date(now_datetime().replace(hour=0, minute=0, second=0, microsecond=0), days=-(days - 1))
	filters = {"pos_profile": profile.name, "parent_order": ["is", "not set"], "creation": [">=", cutoff]}
	if scope == "all":
		filters["status"] = ["in", OPEN_STATUSES]
	else:
		filters["waiter"] = frappe.session.user
	names = frappe.get_all(WO, filters=filters, pluck="name", order_by="creation desc", limit=MAX_LIST)
	return order_shapes(names)


@frappe.whitelist(methods=["GET", "POST"])
def order(name=None):
	waiter = security.current_waiter()
	main = _main_of(name)
	security.assert_profile_access(waiter, main.pos_profile)
	return _shape(main.name)


@frappe.whitelist(methods=["POST"])
def cancel_order(name=None, reason=None):
	"""Cancel while Pending (not yet accepted at the till), only by the waiter who created it.

	Cancelling a main order also cancels its still-pending rounds; `name` may also
	be a single round.
	"""
	waiter = security.current_waiter()
	settings = security.get_settings()
	if not cint(settings.allow_cancel_pending):
		frappe.throw(_("Cancelling orders from the waiter app is turned off"), frappe.PermissionError)
	if not name or not isinstance(name, str):
		frappe.throw(_("Order name is required"))
	row = frappe.db.sql(
		f"select name, status, waiter, pos_profile, parent_order from `tab{WO}` where name=%s for update",
		name,
		as_dict=True,
	)
	if not row:
		frappe.throw(_("Order {0} not found").format(name), frappe.DoesNotExistError)
	row = row[0]
	security.assert_profile_access(waiter, row.pos_profile)
	if row.waiter != frappe.session.user:
		frappe.throw(_("Only the waiter who placed the order can cancel it"), frappe.PermissionError)
	if row.status != "Pending":
		frappe.throw(_("Order {0} is already {1} and cannot be cancelled here").format(name, row.status))

	reason = _text(reason, 140) or _("No reason given")
	targets = [row.name]
	if not row.parent_order:
		targets += frappe.get_all(WO, filters={"parent_order": row.name, "status": "Pending"}, pluck="name")
	for t in targets:
		doc = frappe.get_doc(WO, t)
		doc.status = "Cancelled"
		doc.edit_log = (
			(doc.edit_log or "") + f"\n[{now_datetime()}] Cancelled from waiter app: {reason}"
		).strip()
		doc.flags.servepos_cancelled_by_waiter = True
		doc.save(ignore_permissions=True)
	return _shape(row.parent_order or row.name)
