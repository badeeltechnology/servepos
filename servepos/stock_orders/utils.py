"""Shared helpers for ServePOS Stock Orders: settings, locations, permissions, item data."""
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, flt, get_time, getdate, now_datetime, nowdate

ADMIN_ROLES = {"System Manager", "Stock Manager", "ServePOS Manager"}


def settings():
	return frappe.get_cached_doc("ServePOS Stock Settings")


def roles(user=None):
	return set(frappe.get_roles(user or frappe.session.user))


def is_admin(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or bool(roles(user) & {"System Manager", "ServePOS Manager"})


def can_see_amounts(user=None):
	"""Prices, stock value and markup: System / ServePOS Managers always; other roles only when
	their row in Stock Order Settings ticks 'Sees prices and values'. Outlet staff do not."""
	user = user or frappe.session.user
	if is_admin(user):
		return True
	r = roles(user)
	return any(row.show_amounts and row.role in r for row in (settings().role_access or []))


def implied_roles(user=None):
	"""Roles a user holds because of warehouse User Permissions: an outlet warehouse means
	ServePOS Outlet User, a provider warehouse means that provider's ship role. This keeps access
	right even for users whose roles come from a Role Profile."""
	user = user or frappe.session.user
	whs = frappe.get_all("User Permission", filters={"user": user, "allow": "Warehouse"}, pluck="for_value")
	if not whs:
		return set()
	out = set()
	for loc in frappe.get_all("ServePOS Stock Location", filters={"warehouse": ["in", whs], "enabled": 1}, fields=["location_type", "ship_role"]):
		if loc.location_type == "Outlet":
			out.add("ServePOS Outlet User")
		elif loc.ship_role and loc.ship_role != "Stock Manager":
			out.add(loc.ship_role)
	return out


def allowed_warehouses(user=None):
	"""Warehouses from the user's User Permissions; None means not restricted."""
	user = user or frappe.session.user
	if is_admin(user):
		return None
	whs = frappe.get_all("User Permission", filters={"user": user, "allow": "Warehouse"}, pluck="for_value")
	return set(whs) if whs else None


def all_locations():
	return frappe.get_all(
		"ServePOS Stock Location",
		filters={"enabled": 1},
		fields=["name", "location_type", "warehouse", "location_group", "color", "buys_from_suppliers",
			"orders_from", "markup_percent", "ship_role", "record_production_for_shortfall"],
		order_by="location_type desc, location_name asc",
	)


def location(name):
	doc = frappe.get_cached_doc("ServePOS Stock Location", name)
	if not doc.enabled:
		frappe.throw(_("{0} is disabled").format(name))
	return doc


def my_locations(user=None):
	"""Locations the user may act for, from their warehouse User Permissions.
	Without any, only managers (System, ServePOS or Stock Manager) get every location."""
	user = user or frappe.session.user
	allowed = allowed_warehouses(user)
	locs = all_locations()
	if allowed is None:
		r = roles(user)
		if is_admin(user) or "Stock Manager" in r:
			return locs
		return []
	return [l for l in locs if l.warehouse in allowed]


def can_act_for(loc_name, user=None):
	return any(l.name == loc_name for l in my_locations(user))


def can_receive_for(loc_name, user=None):
	"""Receiving is the destination's own confirmation: the user must be assigned to it by a warehouse
	User Permission (System / ServePOS Managers excepted). A Stock Manager seeing every location does not count."""
	user = user or frappe.session.user
	if is_admin(user):
		return True
	allowed = allowed_warehouses(user)
	if allowed is None:
		# unrestricted stock manager: only providers' own receipts (returns to the Store), never an outlet's
		return location(loc_name).location_type == "Provider" and can_ship_from(loc_name, user)
	return location(loc_name).warehouse in allowed


def can_ship_from(loc_name, user=None):
	"""Shipping from a provider needs its ship role; from an outlet, acting for it is enough."""
	user = user or frappe.session.user
	if not can_act_for(loc_name, user):
		return False
	loc = location(loc_name)
	if loc.location_type == "Provider" and loc.ship_role and not is_admin(user):
		r = roles(user) | implied_roles(user)
		return loc.ship_role in r or "Stock Manager" in r
	return True


def assert_can(ok, msg):
	if not ok:
		frappe.throw(msg, frappe.PermissionError)


def default_for_date():
	return add_days(nowdate(), 1)


def cutoff_state(for_date=None):
	"""Where we are against today's cutoffs for orders delivered on for_date."""
	s = settings()
	for_date = getdate(for_date or default_for_date())
	now = now_datetime()
	order_day = add_days(for_date, -1)
	state = {"changes_open": True, "orders_open": True, "change_cutoff": None, "order_cutoff": None}
	if getdate(now) > getdate(order_day):
		# ordering on (or after) the delivery day itself is always late
		state.update(changes_open=False, orders_open=False)
		return state
	if getdate(now) < getdate(order_day):
		return state
	if s.change_cutoff:
		state["change_cutoff"] = str(s.change_cutoff)[:5]
		state["changes_open"] = now.time() < get_time(s.change_cutoff)
	if s.order_cutoff:
		state["order_cutoff"] = str(s.order_cutoff)[:5]
		state["orders_open"] = now.time() < get_time(s.order_cutoff)
	return state


def bin_qty(item_codes, warehouse):
	if not item_codes or not warehouse:
		return {}
	rows = frappe.get_all("Bin", filters={"warehouse": warehouse, "item_code": ["in", list(item_codes)]},
		fields=["item_code", "actual_qty", "valuation_rate"])
	return {r.item_code: r for r in rows}


def item_info(item_codes):
	"""Name, stock UOM, provider and UOM conversions for each item."""
	item_codes = list({c for c in item_codes if c})
	if not item_codes:
		return {}
	items = frappe.get_all("Item", filters={"name": ["in", item_codes]},
		fields=["name", "item_name", "stock_uom", "purchase_uom", "servepos_stock_provider", "valuation_rate", "is_stock_item", "disabled"])
	conv = defaultdict(dict)
	for c in frappe.get_all("UOM Conversion Detail", filters={"parent": ["in", item_codes], "parenttype": "Item"},
			fields=["parent", "uom", "conversion_factor"], order_by="idx"):
		conv[c.parent][c.uom] = flt(c.conversion_factor) or 1
	also = defaultdict(list)
	for r in frappe.get_all("ServePOS Item Provider", filters={"parent": ["in", item_codes], "parenttype": "Item"},
			fields=["parent", "provider"], order_by="idx"):
		also[r.parent].append(r.provider)
	out = {}
	for it in items:
		it.providers = [p for p in [it.servepos_stock_provider] + also.get(it.name, []) if p]
		uoms = conv.get(it.name) or {}
		uoms.setdefault(it.stock_uom, 1)
		it.uoms = [{"uom": u, "factor": f} for u, f in uoms.items()]
		it.factor = uoms
		out[it.name] = it
	return out


def items_of_provider(provider):
	"""Item codes a provider supplies: its default items plus items that list it under 'Also ordered from'."""
	main = frappe.get_all("Item", filters={"servepos_stock_provider": provider, "disabled": 0, "is_stock_item": 1}, pluck="name")
	extra = frappe.get_all("ServePOS Item Provider", filters={"provider": provider, "parenttype": "Item"}, pluck="parent")
	return list(dict.fromkeys(main + extra))


def factor_of(info, uom):
	if not info:
		return 1
	return flt(info.factor.get(uom or info.stock_uom)) or 1
