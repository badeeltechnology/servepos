"""Whitelisted API for the /stock app (ServePOS Stock Orders).

Every action checks, on the server, that the user may act for the location involved
(User Permission on its warehouse) before any ERPNext entry is created.
"""
import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate, time_diff_in_hours

from servepos.stock_orders import stock
from servepos.stock_orders.utils import (
	all_locations, assert_can, bin_qty, can_act_for, can_receive_for, can_ship_from, cutoff_state, default_for_date,
	branch_field, can_see_amounts, factor_of, set_branch, supplied_by, is_admin, item_info, items_of_provider, location, my_locations, roles, settings,
)

OPEN = ("Draft", "Submitted")


def _json(v):
	return json.loads(v) if isinstance(v, str) else (v or [])


def _lock(name):
	frappe.db.sql("select name from `tabServePOS Stock Order` where name=%s for update", name)
	return frappe.get_doc("ServePOS Stock Order", name)


# ---------------------------------------------------------------- context

@frappe.whitelist()
def get_context():
	user = frappe.session.user
	r = roles(user)
	mine = my_locations(user)
	providers = [l for l in all_locations() if l.location_type == "Provider"]
	ships_for = [l.name for l in mine if l.location_type == "Provider" and can_ship_from(l.name)]
	s = settings()
	from servepos.stock_orders.access import _rules
	_landing, desk = _rules(user)
	return {
		"user": user,
		"desk": bool(desk),
		"see_amounts": can_see_amounts(user),
		"currency": frappe.get_cached_value("Company", frappe.defaults.get_global_default("company"), "default_currency") if frappe.defaults.get_global_default("company") else "",
		"full_name": frappe.utils.get_fullname(user),
		"is_admin": is_admin(user),
		"is_buyer": bool(r & {"Purchase User", "Purchase Manager"}) or is_admin(user),
		"outlets": [l for l in mine if l.location_type == "Outlet"],
		"providers": providers,
		"ships_for": ships_for,
		# the provider whose ship role the user holds comes first, so the storekeeper lands on the Store
		"my_providers": sorted([l for l in mine if l.location_type == "Provider"], key=lambda l: (0 if l.ship_role and l.ship_role in r else 1, l.name)),
		"all_outlets": [l for l in all_locations() if l.location_type == "Outlet"],
		"cutoff": cutoff_state(),
		"for_date": str(default_for_date()),
		"today": nowdate(),
		"settings": {
			"change_cutoff": str(s.change_cutoff or "")[:5], "order_cutoff": str(s.order_cutoff or "")[:5],
			"markup_mode": s.markup_mode, "show_system_qty": s.show_system_qty,
			"correction_window_hours": s.correction_window_hours,
		},
	}


@frappe.whitelist()
def get_home(location_name, for_date=None):
	assert_can(can_act_for(location_name), _("You cannot act for {0}").format(location_name))
	for_date = for_date or str(default_for_date())
	lists = frappe.get_all("ServePOS Order List", filters={"location": location_name, "enabled": 1}, fields=["name", "provider"])
	counts = {l.name: frappe.db.count("ServePOS Order List Item", {"parent": l.name}) for l in lists}
	orders = frappe.get_all("ServePOS Stock Order",
		filters={"to_location": location_name, "order_type": "Order", "for_date": for_date, "status": ["!=", "Cancelled"]},
		fields=["name", "from_location", "status", "submitted_on", "modified"])
	by_prov = {o.from_location: o for o in orders}
	cards = []
	for l in lists:
		o = by_prov.get(l.provider)
		filled = frappe.db.count("ServePOS Stock Order Item", {"parent": o.name, "qty_ordered": [">", 0]}) if o else 0
		cards.append({"provider": l.provider, "list_items": counts[l.name], "order": o, "filled": filled})
	incoming = frappe.get_all("ServePOS Stock Order", filters={"to_location": location_name, "status": "Shipped"},
		fields=["name", "order_type", "from_location", "shipped_on", "shipped_by"], order_by="shipped_on asc")
	for o in incoming:
		o.lines = frappe.db.count("ServePOS Stock Order Item", {"parent": o.name, "qty_shipped": [">", 0]})
	disc = frappe.get_all("ServePOS Stock Order", filters={"to_location": location_name, "status": "Discrepancy"},
		fields=["name", "from_location", "received_on"])
	asked = frappe.get_all("ServePOS Stock Order",
		filters={"from_location": location_name, "order_type": "Transfer", "status": "Submitted"},
		fields=["name", "to_location", "submitted_on", "note"])
	mine = frappe.get_all("ServePOS Stock Order",
		filters={"to_location": location_name, "order_type": "Transfer", "status": ["in", ["Submitted", "Shipped"]]},
		fields=["name", "from_location", "status", "submitted_on"])
	return {"for_date": for_date, "cutoff": cutoff_state(for_date), "cards": cards, "incoming": incoming,
		"discrepancies": disc, "transfers_asked": asked, "transfers_mine": mine,
		"inventory_due": _inventory_due(location_name), **_home_figures(location_name)}


def _home_figures(location_name):
	"""Numbers for the Today dashboard. Counts for everyone; stock and receipt values only for
	users allowed to see amounts (outlet staff see quantities, never prices)."""
	loc = location(location_name)
	money = can_see_amounts()
	stock = frappe.db.sql("""select coalesce(sum(stock_value), 0), coalesce(sum(actual_qty > 0), 0)
		from tabBin where warehouse = %s""", loc.warehouse)[0]
	start = add_days(nowdate(), -6)
	rows = frappe.db.sql("""select date(received_on) d, count(*) n, coalesce(sum(received_value), 0) v
		from `tabServePOS Stock Order` where to_location = %s and received_on >= %s
		group by date(received_on)""", (location_name, start), as_dict=True)
	by_day = {str(r.d): r for r in rows}
	days = [str(add_days(start, i)) for i in range(7)]
	month = frappe.db.sql("""select from_location provider, count(*) orders, coalesce(sum(received_value), 0) value
		from `tabServePOS Stock Order` where to_location = %s and received_on >= %s and status != 'Cancelled'
		group by from_location order by orders desc""", (location_name, add_days(nowdate(), -29)), as_dict=True)
	week = [{"date": d, "orders": int(by_day[d].n) if d in by_day else 0,
		"value": round(flt(by_day[d].v), 2) if money and d in by_day else (0 if money else None)} for d in days]
	company = frappe.get_cached_value("Warehouse", loc.warehouse, "company")
	return {
		"see_amounts": money,
		"currency": (frappe.get_cached_value("Company", company, "default_currency") if company else "") if money else "",
		"stock_value": flt(stock[0], 2) if money else None,
		"items_in_stock": int(stock[1]),
		"received_week": week,
		"received_week_orders": sum(w["orders"] for w in week),
		"received_week_total": round(sum(w["value"] or 0 for w in week), 2) if money else None,
		"received_month": [{"provider": r.provider, "orders": r.orders, "value": round(flt(r.value), 2) if money else None} for r in month],
	}


# ---------------------------------------------------------------- ordering

def _line_view(row, info, here=None, there=None):
	i = info.get(row["item_code"])
	f = factor_of(i, row.get("uom"))
	return {
		**row,
		"item_name": i.item_name if i else row["item_code"],
		"stock_uom": i.stock_uom if i else row.get("uom"),
		"uoms": i.uoms if i else [],
		"factor": f,
		"stock_here": flt(here[row["item_code"]].actual_qty) if here and row["item_code"] in here else 0,
		"stock_there": flt(there[row["item_code"]].actual_qty) if there and row["item_code"] in there else None,
	}


@frappe.whitelist()
def get_order_form(location_name, provider, for_date=None):
	"""The location's list for this provider, merged with today's order if one exists."""
	assert_can(can_act_for(location_name), _("You cannot order for {0}").format(location_name))
	for_date = for_date or str(default_for_date())
	order_name = frappe.db.get_value("ServePOS Stock Order",
		{"to_location": location_name, "from_location": provider, "order_type": "Order", "for_date": for_date,
		 "status": ["!=", "Cancelled"]}, "name")
	lst = frappe.db.get_value("ServePOS Order List", {"location": location_name, "provider": provider}, "name")
	list_rows = frappe.get_all("ServePOS Order List Item", filters={"parent": lst}, fields=["item_code", "uom", "usual_qty"], order_by="idx") if lst else []
	lines, order = [], None
	if order_name:
		order = frappe.get_doc("ServePOS Stock Order", order_name)
		got = {}
		for it in order.items:
			got[it.item_code] = {"item_code": it.item_code, "uom": it.uom, "qty": it.qty_ordered, "row": it.name,
				"qty_shipped": it.qty_shipped, "qty_received": it.qty_received}
		for r in list_rows:
			lines.append({**got.pop(r.item_code, {"item_code": r.item_code, "uom": r.uom, "qty": None}), "usual": r.usual_qty, "usual_uom": r.uom})
		for extra in got.values():
			lines.append({**extra, "usual": None, "extra": 1})
	else:
		lines = [{"item_code": r.item_code, "uom": r.uom, "qty": None, "usual": r.usual_qty, "usual_uom": r.uom} for r in list_rows]
	codes = [l["item_code"] for l in lines]
	info = item_info(codes)
	ok = supplied_by(provider, info)
	lines = [l for l in lines if l["item_code"] in ok or l.get("row")]  # list lines outside the provider's groups are hidden
	here = bin_qty(codes, location(location_name).warehouse)
	lines = [_line_view(l, info, here) for l in lines if l["item_code"] in info]
	return {
		"order": order.as_dict() if order else None,
		"status": order.status if order else "New",
		"lines": lines,
		"for_date": for_date,
		"cutoff": cutoff_state(for_date),
		"editable": (not order or order.status in OPEN) and (cutoff_state(for_date)["changes_open"] or not order or order.status == "Draft"),
	}


@frappe.whitelist()
def search_items(provider, txt="", limit=20):
	"""Items of this provider, for adding a line that is not on the list yet."""
	codes = items_of_provider(provider)
	if not codes:
		return []
	cond = {"name": ["in", codes], "disabled": 0, "is_stock_item": 1}
	or_filters = {"item_name": ["like", f"%{txt}%"], "item_code": ["like", f"%{txt}%"]} if txt else None
	rows = frappe.get_all("Item", filters=cond, or_filters=or_filters, fields=["name as item_code", "item_name", "stock_uom"],
		limit=cint(limit), order_by="item_name asc")
	return rows


@frappe.whitelist()
def save_order(location_name, provider, lines, for_date=None, submit=0, note=None):
	assert_can(can_act_for(location_name), _("You cannot order for {0}").format(location_name))
	prov = location(provider)
	dest = location(location_name)
	if prov.location_type != "Provider":
		frappe.throw(_("{0} is not a provider").format(provider))
	if dest.location_type == "Provider" and dest.orders_from and dest.orders_from != provider:
		frappe.throw(_("{0} orders from {1}").format(location_name, dest.orders_from))
	for_date = for_date or str(default_for_date())
	if getdate(for_date) < getdate(nowdate()):
		frappe.throw(_("Delivery date cannot be in the past"))
	lines = [l for l in _json(lines) if l.get("item_code")]
	cut = cutoff_state(for_date)
	name = frappe.db.get_value("ServePOS Stock Order",
		{"to_location": location_name, "from_location": provider, "order_type": "Order", "for_date": for_date,
		 "status": ["!=", "Cancelled"]}, "name")
	doc = _lock(name) if name else frappe.new_doc("ServePOS Stock Order")
	if name and doc.status not in OPEN:
		frappe.throw(_("This order is already {0} and cannot change").format(doc.status.lower()))
	if name and doc.status == "Submitted" and not cut["changes_open"]:
		frappe.throw(_("Changes closed at {0}. Ask {1} to change it for you.").format(cut["change_cutoff"] or "the cutoff", provider))
	info = item_info([l["item_code"] for l in lines])
	ok = supplied_by(provider, info)
	wrong = [c for c in info if c not in ok]
	if wrong:
		frappe.throw(_("Not supplied by {0}: {1}").format(provider, ", ".join(info[c].item_name for c in wrong)))
	if not name:
		doc.update({"order_type": "Order", "from_location": provider, "to_location": location_name, "for_date": for_date,
			"requested_by": frappe.session.user, "status": "Draft"})
	existing = {it.item_code: it for it in doc.items}
	keep = []
	for l in lines:
		qty = flt(l.get("qty"))
		if qty <= 0 or l["item_code"] not in info:
			continue
		i = info[l["item_code"]]
		uom = l.get("uom") or i.stock_uom
		if uom not in i.factor:
			frappe.throw(_("{0} has no UOM {1}").format(i.item_name, uom))
		row = existing.get(l["item_code"])
		data = {"item_code": i.name, "item_name": i.item_name, "uom": uom, "conversion_factor": i.factor[uom],
			"stock_uom": i.stock_uom, "qty_ordered": qty}
		if row:
			row.update(data)
			keep.append(row)
		else:
			keep.append(doc.append("items", data))
	doc.items = keep
	for idx, row in enumerate(doc.items, 1):
		row.idx = idx
	if note is not None:
		doc.note = (note or "").strip()
	if cint(submit):
		if not doc.items:
			frappe.throw(_("Type at least one quantity"))
		if doc.status == "Draft":
			doc.is_late = 0 if cut["orders_open"] else 1
			if doc.is_late and settings().late_order_policy == "Not allowed":
				frappe.throw(_("Orders for {0} closed at {1}").format(for_date, cut["order_cutoff"]))
			doc.status = "Submitted"
			doc.submitted_on = now_datetime()
	doc.flags.ignore_permissions = True
	if not doc.items and doc.is_new():
		return {"name": None, "status": "New"}
	doc.save()
	return {"name": doc.name, "status": doc.status, "lines": len(doc.items), "is_late": doc.get("is_late")}


@frappe.whitelist()
def update_order_note(name, note=None):
	"""The requester can change the note until the order is shipped, even after the change cutoff."""
	doc = _lock(name)
	requester = doc.from_location if doc.order_type == "Return" else doc.to_location
	assert_can(can_act_for(requester) or is_admin(), _("Only {0} can change the note").format(requester))
	if doc.status not in OPEN:
		frappe.throw(_("This order is already {0}: the note cannot change").format(doc.status.lower()))
	doc.note = (note or "").strip()
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "note": doc.note}


@frappe.whitelist()
def cancel_order(name, reason=None):
	doc = _lock(name)
	requester = doc.from_location if doc.order_type == "Return" else doc.to_location
	giver = doc.from_location
	ok = can_act_for(requester) or (doc.order_type == "Transfer" and can_act_for(giver)) or is_admin()
	assert_can(ok, _("You cannot cancel this order"))
	if doc.status not in OPEN:
		frappe.throw(_("Only draft or submitted orders can be cancelled"))
	doc.status = "Cancelled"
	doc.note = "\n".join(filter(None, [doc.note, _("Cancelled by {0}: {1}").format(frappe.session.user, reason or "")]))
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "status": doc.status}


# ---------------------------------------------------------------- one order

@frappe.whitelist()
def get_order(name):
	doc = frappe.get_doc("ServePOS Stock Order", name)
	assert_can(can_act_for(doc.from_location) or can_act_for(doc.to_location), _("Not your order"))
	codes = [i.item_code for i in doc.items]
	info = item_info(codes)
	there = bin_qty(codes, location(doc.from_location).warehouse)
	here = bin_qty(codes, location(doc.to_location).warehouse)
	lines = []
	for it in doc.items:
		i = info.get(it.item_code)
		lines.append({
			"row": it.name, "item_code": it.item_code, "item_name": it.item_name, "uom": it.uom, "factor": it.conversion_factor or 1,
			"stock_uom": it.stock_uom, "qty_ordered": it.qty_ordered, "qty_shipped": it.qty_shipped, "qty_received": it.qty_received,
			"is_86": it.is_86, "difference": it.difference, "resolution": it.resolution, "remark": it.remark,
			"from_stock": flt(there[it.item_code].actual_qty) if it.item_code in there else 0,
			"to_stock": flt(here[it.item_code].actual_qty) if it.item_code in here else 0,
			"uoms": i.uoms if i else [],
		})
	from_loc = location(doc.from_location)
	d = doc.as_dict(no_child_table_fields=True)
	d.pop("items", None)
	if not can_see_amounts():
		for k in ("received_value", "markup_amount", "markup_percent"):
			d.pop(k, None)
	return {
		"doc": d,
		"lines": lines,
		"see_amounts": can_see_amounts(),
		"can_ship": doc.status == "Submitted" and can_ship_from(doc.from_location),
		"can_receive": doc.status == "Shipped" and can_receive_for(doc.to_location),
		"can_resolve": doc.status == "Discrepancy" and can_ship_from(doc.from_location),
		"can_edit_note": doc.status in OPEN and doc.order_type != "Delivery" and can_act_for(doc.from_location if doc.order_type == "Return" else doc.to_location),
		"can_cancel": doc.status in OPEN and (can_act_for(doc.to_location if doc.order_type != "Return" else doc.from_location) or (doc.order_type == "Transfer" and can_act_for(doc.from_location))),
		"records_production": bool(from_loc.record_production_for_shortfall),
	}


@frappe.whitelist()
def ship(name, lines):
	"""Provider (or giving outlet) ships: Qty Shipped per line, 0 = not available. Stock goes to transit."""
	doc = _lock(name)
	assert_can(can_ship_from(doc.from_location), _("You cannot ship for {0}").format(doc.from_location))
	if doc.status != "Submitted":
		frappe.throw(_("This order is {0}").format(doc.status.lower()))
	lines = _json(lines)
	by_row = {l["row"]: l for l in lines if l.get("row")}
	src = location(doc.from_location)
	_add_shipper_items(doc, [l for l in lines if not l.get("row") and l.get("item_code")], by_row)
	need = defaultdict(float)
	for it in doc.items:
		l = by_row.get(it.name)
		if l is None:
			frappe.throw(_("Missing shipped quantity for {0}").format(it.item_name))
		qty = flt(l.get("qty_shipped"))
		if qty < 0:
			frappe.throw(_("Quantity cannot be negative"))
		it.qty_shipped = qty
		it.is_86 = 1 if qty == 0 else 0
		if l.get("remark") is not None:
			it.remark = l.get("remark")
		need[it.item_code] += qty * flt(it.conversion_factor or 1)
	need = {k: v for k, v in need.items() if v > 0}
	if need:
		if src.record_production_for_shortfall:
			pe = stock.record_production_shortfall(doc, src.warehouse, need)
			if pe:
				doc.production_entry = pe.name
		short = stock.check_available(src.warehouse, need)
		if short:
			names = item_info([s[0] for s in short])
			frappe.throw(_("Not enough stock in {0}: {1}").format(src.name, "; ".join(
				f"{names[c].item_name}: has {flt(a, 3)}, shipping {flt(q, 3)} {names[c].stock_uom}" for c, a, q in short)))
		se = stock.make_entry(doc, "Material Transfer",
			[{"item_code": c, "qty": q, "s_warehouse": src.warehouse, "t_warehouse": stock.transit_wh()} for c, q in need.items()],
			_("Shipped for Stock Order {0} to {1}").format(doc.name, doc.to_location))
		doc.ship_entry = se.name
		rates = {r.item_code: flt(r.valuation_rate) for r in se.items}
		for it in doc.items:
			it.valuation_rate = rates.get(it.item_code, 0)
		doc.status = "Shipped"
	else:
		doc.status = "Closed"
		doc.note = "\n".join(filter(None, [doc.note, _("Declined: nothing sent") if doc.order_type == "Transfer" else _("Nothing shipped: no item available")]))
	doc.shipped_by, doc.shipped_on = frappe.session.user, now_datetime()
	if doc.order_type == "Transfer":
		doc.approved_by = frappe.session.user
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "status": doc.status, "ship_entry": doc.ship_entry, "production_entry": doc.production_entry}


def _add_shipper_items(doc, extra, by_row):
	"""Lines the shipper adds before shipping (a substitute or something the receiver forgot).
	They carry Qty Ordered 0 and a remark, so the receiver sees they were added."""
	extra = [l for l in extra if flt(l.get("qty_shipped")) > 0]
	if not extra:
		return
	info = item_info([l["item_code"] for l in extra])
	have = {it.item_code for it in doc.items}
	for l in extra:
		i = info.get(l["item_code"])
		if not i:
			frappe.throw(_("Unknown item {0}").format(l["item_code"]))
		if i.name in have:
			frappe.throw(_("{0} is already on this order: change its quantity instead").format(i.item_name))
		uom = l.get("uom") or i.stock_uom
		if uom not in i.factor:
			frappe.throw(_("{0} has no UOM {1}").format(i.item_name, uom))
		row = doc.append("items", {"item_code": i.name, "item_name": i.item_name, "uom": uom, "conversion_factor": i.factor[uom],
			"stock_uom": i.stock_uom, "qty_ordered": 0})
		row.name = frappe.generate_hash(length=10)
		have.add(i.name)
		by_row[row.name] = {"qty_shipped": l.get("qty_shipped"),
			"remark": l.get("remark") or _("Added by {0}").format(doc.from_location)}


@frappe.whitelist()
def receive(name, lines, note=None):
	doc = _lock(name)
	assert_can(can_receive_for(doc.to_location), _("Only {0} can confirm what arrived").format(doc.to_location))
	if doc.status != "Shipped":
		frappe.throw(_("This order is {0}").format(doc.status.lower()))
	by_row = {l["row"]: l for l in _json(lines)}
	dest, src = location(doc.to_location), location(doc.from_location)
	got = defaultdict(float)
	short_lines = 0
	value = 0
	for it in doc.items:
		if not flt(it.qty_shipped):
			it.qty_received, it.difference = 0, 0
			continue
		l = by_row.get(it.name)
		if l is None or l.get("qty_received") in (None, ""):
			frappe.throw(_("Type what arrived for {0}").format(it.item_name))
		qty = flt(l["qty_received"])
		if qty < 0:
			frappe.throw(_("Quantity cannot be negative"))
		if qty > flt(it.qty_shipped) + 1e-9:
			frappe.throw(_("{0}: received {1} is more than the {2} shipped").format(it.item_name, qty, it.qty_shipped))
		it.qty_received = qty
		it.difference = flt(it.qty_shipped) - qty
		if it.difference > 1e-9:
			short_lines += 1
		got[it.item_code] += qty * flt(it.conversion_factor or 1)
		it.amount = qty * flt(it.conversion_factor or 1) * flt(it.valuation_rate)
		value += it.amount
	s = settings()
	markup = flt(src.markup_percent) if doc.order_type in ("Order", "Delivery") else 0
	doc.markup_percent = markup
	doc.received_value = value
	doc.markup_amount = flt(value * markup / 100, 2)
	add_cost = None
	if markup and s.markup_mode == "Accounts" and doc.markup_amount:
		if not s.markup_account:
			frappe.throw(_("Set the markup income account in ServePOS Stock Settings"))
		add_cost = {"expense_account": s.markup_account, "description": _("{0}% markup from {1}").format(markup, src.name),
			"amount": doc.markup_amount}
		if branch_field() and src.branch:
			add_cost[branch_field()] = src.branch  # the markup is the provider's income
	got = {k: v for k, v in got.items() if v > 0}
	if got:
		se = stock.make_entry(doc, "Material Transfer",
			[{"item_code": c, "qty": q, "s_warehouse": stock.transit_wh(), "t_warehouse": dest.warehouse} for c, q in got.items()],
			_("Received for Stock Order {0} from {1}").format(doc.name, doc.from_location), additional_cost=add_cost, branch=dest.branch)
		doc.receive_entry = se.name
	doc.received_by, doc.received_on = frappe.session.user, now_datetime()
	doc.receive_note = note
	if short_lines:
		doc.status = "Discrepancy"
		if s.short_delivery_default == "Back to provider stock":
			for it in doc.items:
				if flt(it.difference) > 0:
					it.resolution = "Back to provider"
			_apply_resolution(doc)
	else:
		doc.status = "Received"
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "status": doc.status, "receive_entry": doc.receive_entry, "short_lines": short_lines}


def _apply_resolution(doc):
	src = location(doc.from_location)
	s = settings()
	back, off = defaultdict(float), defaultdict(float)
	for it in doc.items:
		d = flt(it.difference) * flt(it.conversion_factor or 1)
		if d <= 0:
			continue
		if it.resolution == "Back to provider":
			back[it.item_code] += d
		elif it.resolution == "Write off":
			off[it.item_code] += d
		else:
			frappe.throw(_("Choose what happens to the missing {0}").format(it.item_name))
	if back:
		se = stock.make_entry(doc, "Material Transfer",
			[{"item_code": c, "qty": q, "s_warehouse": stock.transit_wh(), "t_warehouse": src.warehouse} for c, q in back.items()],
			_("Short delivery on {0} returned to {1}").format(doc.name, src.name))
		doc.return_entry = se.name
	if off:
		se = stock.make_entry(doc, "Material Issue",
			[{"item_code": c, "qty": q, "s_warehouse": stock.transit_wh(), "expense_account": s.write_off_account} for c, q in off.items()],
			_("Short delivery on {0} written off: {1}").format(doc.name, doc.receive_note or ""), branch=src.branch)
		doc.writeoff_entry = se.name
	doc.status = "Closed"
	doc.resolved_by = frappe.session.user


@frappe.whitelist()
def resolve(name, lines):
	doc = _lock(name)
	assert_can(can_ship_from(doc.from_location), _("Only {0} can resolve this").format(doc.from_location))
	if doc.status != "Discrepancy":
		frappe.throw(_("This order is {0}").format(doc.status.lower()))
	by_row = {l["row"]: l for l in _json(lines)}
	for it in doc.items:
		if flt(it.difference) > 0:
			res = (by_row.get(it.name) or {}).get("resolution")
			if res not in ("Back to provider", "Write off"):
				frappe.throw(_("Choose what happens to the missing {0}").format(it.item_name))
			it.resolution = res
	_apply_resolution(doc)
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "status": doc.status, "return_entry": doc.return_entry, "writeoff_entry": doc.writeoff_entry}


# ---------------------------------------------------------------- transfers and returns

def _new_moving_order(order_type, from_loc, to_loc, lines, note=None, reason=None):
	info = item_info([l["item_code"] for l in lines])
	doc = frappe.new_doc("ServePOS Stock Order")
	doc.update({"order_type": order_type, "from_location": from_loc, "to_location": to_loc, "for_date": nowdate(),
		"note": note, "reason": reason, "requested_by": frappe.session.user, "status": "Submitted", "submitted_on": now_datetime()})
	for l in lines:
		qty = flt(l.get("qty"))
		if qty <= 0 or l["item_code"] not in info:
			continue
		i = info[l["item_code"]]
		uom = l.get("uom") or i.stock_uom
		doc.append("items", {"item_code": i.name, "item_name": i.item_name, "uom": uom, "conversion_factor": factor_of(i, uom),
			"stock_uom": i.stock_uom, "qty_ordered": qty, "remark": l.get("remark")})
	if not doc.items:
		frappe.throw(_("Type at least one quantity"))
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc


@frappe.whitelist()
def request_transfer(from_location, to_location, lines, note=None):
	"""to_location (the outlet in need) asks from_location (another outlet) for stock."""
	assert_can(can_act_for(to_location), _("You cannot ask for {0}").format(to_location))
	if from_location == to_location:
		frappe.throw(_("Choose another outlet"))
	if location(from_location).location_type != "Outlet":
		frappe.throw(_("Order from providers with a normal order"))
	doc = _new_moving_order("Transfer", from_location, to_location, _json(lines), note=note)
	return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def send_delivery(from_location, to_location, lines, note=None):
	"""
	Send stock without an order: the Store, Central Kitchen or Pastry to any location, or an outlet to another
	outlet. It ships now (stock goes to transit); the receiving side confirms what arrived, as for any delivery.
	"""
	assert_can(can_ship_from(from_location), _("You cannot send from {0}").format(from_location))
	if from_location == to_location:
		frappe.throw(_("Choose where to send"))
	src, dest = location(from_location), location(to_location)
	if not dest or not dest.enabled:
		frappe.throw(_("{0} is not an active location").format(to_location))
	if src.location_type == "Outlet" and dest.location_type != "Outlet":
		frappe.throw(_("Send stock back to a provider with a Return"))
	doc = _new_moving_order("Delivery", from_location, to_location, _json(lines),
		note=note or _("Sent without an order"))
	return ship(doc.name, [{"row": it.name, "qty_shipped": it.qty_ordered} for it in doc.items])


@frappe.whitelist()
def send_return(from_location, to_location, lines, reason=None, note=None):
	"""Send stock back to a provider; it ships immediately and the provider confirms on receipt."""
	assert_can(can_act_for(from_location), _("You cannot return for {0}").format(from_location))
	if location(to_location).location_type != "Provider":
		frappe.throw(_("Returns go to a provider"))
	doc = _new_moving_order("Return", from_location, to_location, _json(lines), note=note, reason=reason)
	res = ship(doc.name, [{"row": it.name, "qty_shipped": it.qty_ordered} for it in doc.items])
	return res


@frappe.whitelist()
def get_stock_items(location_name, txt=""):
	"""Items the location holds (for returns and transfers)."""
	assert_can(can_act_for(location_name) or True, "")
	wh = location(location_name).warehouse
	cond = "and (b.item_code like %(t)s or i.item_name like %(t)s)" if txt else ""
	return frappe.db.sql(f"""select b.item_code, i.item_name, i.stock_uom, b.actual_qty, i.servepos_stock_provider provider
		from tabBin b join tabItem i on i.name=b.item_code
		where b.warehouse=%(w)s and b.actual_qty>0 {cond} order by i.item_name limit 50""", {"w": wh, "t": f"%{txt}%"}, as_dict=True)


# ---------------------------------------------------------------- lists for screens

@frappe.whitelist()
def list_orders(view, location_name=None, for_date=None):
	"""view: to_ship | shipped | discrepancies | incoming | transfers | returns | sent | history"""
	locs = [l.name for l in my_locations()]
	if location_name:
		assert_can(location_name in locs, _("Not your location"))
		locs = [location_name]
	if not locs:
		return []
	f = {}
	if view == "to_ship":
		f = {"from_location": ["in", locs], "status": "Submitted", "order_type": ["in", ["Order", "Transfer"]]}
		if for_date:
			f["for_date"] = ["<=", for_date]
	elif view == "shipped":
		f = {"from_location": ["in", locs], "status": "Shipped"}
	elif view == "discrepancies":
		f = {"from_location": ["in", locs], "status": "Discrepancy"}
	elif view == "incoming":
		f = {"to_location": ["in", locs], "status": "Shipped"}
	elif view == "sent":
		f = {"from_location": ["in", locs], "order_type": "Delivery"}
	elif view == "history":
		f = {"to_location": ["in", locs]}
	of = None
	if view in ("transfers", "returns"):
		f = {"order_type": "Transfer" if view == "transfers" else "Return"}
		of = {"from_location": ["in", locs], "to_location": ["in", locs]}
	orders = frappe.get_all("ServePOS Stock Order", filters=f, or_filters=of,
		fields=["name", "order_type", "from_location", "to_location", "status", "for_date", "submitted_on", "shipped_on",
			"received_on", "is_late", "requested_by", "note", "reason"],
		order_by=("modified desc" if view in ("history", "transfers", "returns", "sent") else "is_late desc, for_date asc, submitted_on asc"), limit=200)
	for o in orders:
		o.lines = frappe.db.count("ServePOS Stock Order Item", {"parent": o.name})
	return orders


@frappe.whitelist()
def get_picking(provider, for_date=None):
	assert_can(can_act_for(provider), _("Not your location"))
	if not for_date:
		# the earliest day that still has orders waiting to ship, otherwise tomorrow
		waiting = frappe.get_all("ServePOS Stock Order", filters={"from_location": provider, "order_type": "Order",
			"status": "Submitted", "for_date": [">=", nowdate()]}, pluck="for_date", order_by="for_date asc", limit=1)
		for_date = str(waiting[0]) if waiting else str(default_for_date())
	orders = frappe.get_all("ServePOS Stock Order",
		filters={"from_location": provider, "order_type": "Order", "for_date": for_date, "status": ["in", ["Submitted", "Shipped", "Received", "Discrepancy", "Closed"]]},
		fields=["name", "to_location", "status", "is_late"])
	if not orders:
		return {"for_date": for_date, "outlets": [], "rows": [], "orders": [], "not_ordered": _not_ordered(provider, for_date, [])}
	items = frappe.get_all("ServePOS Stock Order Item", filters={"parent": ["in", [o.name for o in orders]]},
		fields=["parent", "item_code", "item_name", "qty_ordered", "conversion_factor", "stock_uom"])
	dest = {o.name: o.to_location for o in orders}
	outlets = sorted({o.to_location for o in orders})
	grid = defaultdict(lambda: defaultdict(float))
	names, uoms = {}, {}
	for it in items:
		grid[it.item_code][dest[it.parent]] += flt(it.qty_ordered) * flt(it.conversion_factor or 1)
		names[it.item_code], uoms[it.item_code] = it.item_name, it.stock_uom
	have = bin_qty(grid.keys(), location(provider).warehouse)
	rows = []
	for code, per in sorted(grid.items(), key=lambda kv: names[kv[0]]):
		total = sum(per.values())
		stock_qty = flt(have[code].actual_qty) if code in have else 0
		rows.append({"item_code": code, "item_name": names[code], "uom": uoms[code], "per": dict(per), "total": total,
			"stock": stock_qty, "to_make": max(0, total - stock_qty)})
	return {"for_date": for_date, "outlets": outlets, "rows": rows, "orders": orders,
		"not_ordered": _not_ordered(provider, for_date, outlets)}


def _not_ordered(provider, for_date, ordered):
	lists = frappe.get_all("ServePOS Order List", filters={"provider": provider, "enabled": 1}, pluck="location")
	return sorted(set(lists) - set(ordered))


# ---------------------------------------------------------------- procurement

@frappe.whitelist()
def get_to_buy(for_date=None):
	assert_can(bool(roles() & {"Purchase User", "Purchase Manager"}) or is_admin(), _("Procurement only"))
	buyers = [l for l in all_locations() if l.location_type == "Provider" and l.buys_from_suppliers]
	out = []
	for b in buyers:
		f = {"from_location": b.name, "status": "Submitted"}
		if for_date:
			f["for_date"] = ["<=", for_date]
		orders = frappe.get_all("ServePOS Stock Order", filters=f, fields=["name", "to_location"])
		if not orders:
			continue
		dest = {o.name: o.to_location for o in orders}
		need = defaultdict(float)
		who = defaultdict(set)
		refs = defaultdict(set)
		for it in frappe.get_all("ServePOS Stock Order Item", filters={"parent": ["in", list(dest)]},
				fields=["parent", "item_code", "qty_ordered", "conversion_factor"]):
			need[it.item_code] += flt(it.qty_ordered) * flt(it.conversion_factor or 1)
			who[it.item_code].add(dest[it.parent])
			refs[it.item_code].add(it.parent)
		have = frappe.get_all("Bin", filters={"warehouse": b.warehouse, "item_code": ["in", list(need)]},
			fields=["item_code", "actual_qty", "ordered_qty"])
		have = {h.item_code: h for h in have}
		# drafts are not in Bin.ordered_qty yet; count them so nobody raises a second PO
		drafts = dict(frappe.db.sql("""select poi.item_code, sum(poi.stock_qty) from `tabPurchase Order Item` poi
			join `tabPurchase Order` po on po.name = poi.parent
			where po.docstatus = 0 and poi.warehouse = %s and poi.item_code in %s group by poi.item_code""",
			(b.warehouse, tuple(need))))
		info = item_info(list(need))
		for code, qty in need.items():
			h = have.get(code)
			stock_qty = flt(h.actual_qty) if h else 0
			on_po = flt(h.ordered_qty) if h else 0
			in_draft = flt(drafts.get(code))
			short = qty - stock_qty - on_po - in_draft
			if short <= 0.0001:
				continue
			i = info[code]
			last = frappe.db.sql("""select po.supplier, poi.rate, poi.uom, poi.conversion_factor, po.transaction_date
				from `tabPurchase Order Item` poi join `tabPurchase Order` po on po.name=poi.parent
				where poi.item_code=%s and po.docstatus=1 order by po.transaction_date desc, po.creation desc limit 1""", code, as_dict=True)
			last = last[0] if last else None
			buy_uom = (last.uom if last else None) or i.purchase_uom or i.stock_uom
			f_ = factor_of(i, buy_uom)
			out.append({
				"item_code": code, "item_name": i.item_name, "stock_uom": i.stock_uom, "provider": b.name,
				"needed": qty, "store_has": stock_qty, "on_po": on_po, "in_draft": in_draft, "short": short,
				"buy_uom": buy_uom, "buy_factor": f_, "buy_qty": -(-short // f_) if f_ > 1 else round(short, 3),
				"uoms": i.uoms, "who": sorted(who[code]), "orders": sorted(refs[code]),
				"suggested_supplier": last.supplier if last else None,
				"last_rate": flt(last.rate) if last else None, "last_uom": last.uom if last else None,
			})
	out.sort(key=lambda r: r["item_name"])
	return out


@frappe.whitelist()
def search_suppliers(txt=""):
	return frappe.get_all("Supplier", filters={"disabled": 0, "supplier_name": ["like", f"%{txt}%"]},
		fields=["name", "supplier_name"], limit=20, order_by="supplier_name")


@frappe.whitelist()
def create_purchase_orders(lines, schedule_date=None):
	"""lines: item_code, qty, uom, supplier (chosen by procurement), orders. One draft PO per supplier."""
	assert_can(bool(roles() & {"Purchase User", "Purchase Manager"}) or is_admin(), _("Procurement only"))
	lines = [l for l in _json(lines) if l.get("supplier") and flt(l.get("qty")) > 0]
	if not lines:
		frappe.throw(_("Choose items, quantities and suppliers"))
	store = next((l for l in all_locations() if l.location_type == "Provider" and l.buys_from_suppliers), None)
	company = frappe.get_cached_value("Warehouse", store.warehouse, "company")
	by_sup = defaultdict(list)
	for l in lines:
		by_sup[l["supplier"]].append(l)
	info = item_info([l["item_code"] for l in lines])
	made = []
	for sup, rows in by_sup.items():
		po = frappe.new_doc("Purchase Order")
		po.supplier = sup
		po.company = company
		po.transaction_date = nowdate()
		po.schedule_date = schedule_date or str(default_for_date())
		po.set_warehouse = store.warehouse
		set_branch(po, store.branch)  # bought for the Store
		dim = branch_field()
		for l in rows:
			i = info[l["item_code"]]
			uom = l.get("uom") or i.stock_uom
			row = {"item_code": i.name, "qty": flt(l["qty"]), "uom": uom, "conversion_factor": factor_of(i, uom),
				"schedule_date": po.schedule_date, "warehouse": store.warehouse,
				"servepos_stock_orders": ", ".join(l.get("orders") or [])}
			if l.get("rate") is not None:
				row["rate"] = flt(l["rate"])
			if dim and store.branch:
				row[dim] = store.branch
			po.append("items", row)
		po.insert()
		made.append({"name": po.name, "supplier": sup, "items": len(rows), "total": po.grand_total})
	return made


# ---------------------------------------------------------------- inventory

def _inventory_days(month_date):
	import calendar
	d = getdate(month_date)
	last = calendar.monthrange(d.year, d.month)[1]
	days = []
	for tok in (settings().inventory_days or "15,end").split(","):
		tok = tok.strip().lower()
		if tok == "end":
			days.append(last)
		elif tok.isdigit():
			days.append(min(int(tok), last))
	return sorted(set(days))


def _inventory_due(location_name):
	today = getdate(nowdate())
	if today.day in _inventory_days(today):
		done = frappe.db.get_value("ServePOS Inventory Count", {"location": location_name, "count_date": today}, "status")
		return {"date": str(today), "status": done or "Due"}
	nxt = [d for d in _inventory_days(today) if d > today.day]
	return {"date": str(today.replace(day=nxt[0])) if nxt else None, "status": "Next"}


@frappe.whitelist()
def get_inventory(location_name, count_date=None):
	assert_can(can_act_for(location_name), _("Not your location"))
	count_date = count_date or nowdate()
	name = frappe.db.get_value("ServePOS Inventory Count", {"location": location_name, "count_date": count_date}, "name")
	s = settings()
	loc = location(location_name)
	if name:
		doc = frappe.get_doc("ServePOS Inventory Count", name)
		lines = [{"item_code": i.item_code, "item_name": i.item_name, "provider": i.provider, "uom": i.uom,
			"factor": i.conversion_factor or 1, "stock_uom": i.stock_uom, "counted": i.counted_qty if i.is_counted else None,
			"system": i.system_qty, "difference": i.difference, "is_corrected": i.is_corrected, "original": i.original_qty} for i in doc.items]
		status = doc.status
	else:
		doc = None
		codes = []
		for l in frappe.get_all("ServePOS Order List", filters={"location": location_name}, pluck="name"):
			codes += frappe.get_all("ServePOS Order List Item", filters={"parent": l}, pluck="item_code", order_by="idx")
		codes += frappe.get_all("Bin", filters={"warehouse": loc.warehouse, "actual_qty": ["!=", 0]}, pluck="item_code")
		seen, ordered = set(), []
		for c in codes:
			if c not in seen:
				seen.add(c)
				ordered.append(c)
		info = item_info(ordered)
		lines = [{"item_code": c, "item_name": info[c].item_name, "provider": info[c].servepos_stock_provider, "uom": info[c].stock_uom,
			"factor": 1, "stock_uom": info[c].stock_uom, "counted": None} for c in ordered if c in info and info[c].is_stock_item and not info[c].disabled]
		status = "Counting"
	show = status != "Counting" or s.show_system_qty == "Always"
	if show:
		have = bin_qty([l["item_code"] for l in lines], loc.warehouse)
		for l in lines:
			if status == "Counting":
				l["system"] = flt(have[l["item_code"]].actual_qty) / flt(l["factor"] or 1) if l["item_code"] in have else 0
	else:
		for l in lines:
			l.pop("system", None)
			l.pop("difference", None)
	for l in lines:
		i = item_info([l["item_code"]]).get(l["item_code"])
		l["uoms"] = i.uoms if i else []
	can_correct = bool(doc and doc.status == "Submitted" and doc.submitted_on and
		time_diff_in_hours(now_datetime(), doc.submitted_on) <= flt(s.correction_window_hours or 24))
	count_time = _count_time(doc) if doc and doc.get("count_time") else None
	return {"name": name, "status": status, "count_date": count_date, "count_time": count_time, "lines": lines, "show_system": show,
		"can_correct": can_correct, "reconciliation": doc.reconciliation if doc else None,
		"correction": doc.correction_reconciliation if doc else None, "days": _inventory_days(count_date)}


@frappe.whitelist()
def list_inventory(location_name):
	"""Recent counts for a location."""
	assert_can(can_act_for(location_name), _("Not your location"))
	rows = frappe.get_all("ServePOS Inventory Count", filters={"location": location_name},
		fields=["name", "count_date", "count_time", "status", "submitted_by", "submitted_on", "reconciliation", "correction_reconciliation"],
		order_by="count_date desc", limit=12)
	for r in rows:
		r.count_time = _count_time(r) if r.count_time else None
	return rows


def _count_time(doc):
	"""Count time as HH:MM:SS (Time fields come back as timedelta, '0:13:05')."""
	from frappe.utils import get_time
	return get_time(doc.get("count_time") or "23:59:59").strftime("%H:%M:%S")


def _is_now(doc):
	"""A count timed within the last two minutes is treated as 'right now'."""
	moment = get_datetime(f"{doc.count_date} {_count_time(doc)}")
	return (now_datetime() - moment).total_seconds() <= 120


def _check_count_moment(count_date, count_time):
	moment = get_datetime(f"{count_date} {count_time or '00:00:00'}")
	if moment > now_datetime():
		frappe.throw(_("The count date and time cannot be in the future"))


def _reco(doc, rows, purpose_note):
	loc = location(doc.location)
	company = frappe.get_cached_value("Warehouse", loc.warehouse, "company")
	sr = frappe.new_doc("Stock Reconciliation")
	sr.company = company
	sr.purpose = "Stock Reconciliation"
	sr.servepos_inventory_count = doc.name
	set_branch(sr, loc.branch)  # counted where it stands
	# stock is set to what was counted as of the count date and time the user entered;
	# a count timed "just now" posts at the real current time so it lands after everything already recorded
	if not _is_now(doc):
		sr.set_posting_time = 1
		sr.posting_date = doc.count_date
		sr.posting_time = _count_time(doc)
	missing = []
	for r in rows:
		qty = flt(r["counted_qty"]) * flt(r["conversion_factor"] or 1)
		rate = stock._rate_for(r["item_code"], loc.warehouse)
		if qty > 0 and not rate:
			missing.append(r["item_name"])
		sr.append("items", {"item_code": r["item_code"], "warehouse": loc.warehouse, "qty": qty, "valuation_rate": rate,
			"allow_zero_valuation_rate": 1 if not rate else 0})
	sr.remarks = purpose_note
	sr.flags.ignore_permissions = True
	sr.insert()
	sr.submit()
	return sr


@frappe.whitelist()
def save_inventory(location_name, lines, count_date=None, submit=0, count_time=None):
	assert_can(can_act_for(location_name), _("Not your location"))
	count_date = count_date or nowdate()
	if getdate(count_date) > getdate(nowdate()):
		frappe.throw(_("Count date cannot be in the future"))
	name = frappe.db.get_value("ServePOS Inventory Count", {"location": location_name, "count_date": count_date}, "name")
	doc = frappe.get_doc("ServePOS Inventory Count", name) if name else frappe.new_doc("ServePOS Inventory Count")
	if name and doc.status != "Counting":
		frappe.throw(_("This count is already submitted. Use the correction."))
	if not name:
		doc.location, doc.count_date, doc.status = location_name, count_date, "Counting"
	if count_time:
		doc.count_time = count_time
	if not doc.get("count_time"):
		doc.count_time = now_datetime().strftime("%H:%M:%S") if getdate(count_date) == getdate(nowdate()) else "23:59:59"
	info = item_info([l["item_code"] for l in _json(lines)])
	doc.items = []
	for l in _json(lines):
		i = info.get(l["item_code"])
		if not i:
			continue
		uom = l.get("uom") or i.stock_uom
		counted = l.get("counted")
		doc.append("items", {"item_code": i.name, "item_name": i.item_name, "provider": i.servepos_stock_provider, "uom": uom,
			"conversion_factor": factor_of(i, uom), "stock_uom": i.stock_uom,
			"is_counted": 0 if counted in (None, "") else 1, "counted_qty": flt(counted) if counted not in (None, "") else 0})
	doc.flags.ignore_permissions = True
	doc.save()
	if cint(submit):
		counted = [r for r in doc.items if r.is_counted]
		if not counted:
			frappe.throw(_("Count at least one item"))
		_check_count_moment(doc.count_date, _count_time(doc))
		from erpnext.stock.utils import get_stock_balance
		wh = location(location_name).warehouse
		now_count = _is_now(doc)
		have = bin_qty([r.item_code for r in doc.items], wh) if now_count else {}
		for r in doc.items:
			# what the system held at the count moment, in the count UOM
			if now_count:
				base = flt(have[r.item_code].actual_qty) if r.item_code in have else 0
			else:
				base = flt(get_stock_balance(r.item_code, wh, doc.count_date, _count_time(doc)))
			sysq = base / flt(r.conversion_factor or 1)
			r.system_qty = sysq
			r.difference = flt(r.counted_qty) - sysq if r.is_counted else 0
		sr = _reco(doc, [r.as_dict() for r in counted], _("Inventory count {0}").format(doc.name))
		doc.reconciliation = sr.name
		doc.status = "Submitted"
		doc.submitted_by, doc.submitted_on = frappe.session.user, now_datetime()
		doc.save()
	return {"name": doc.name, "status": doc.status, "reconciliation": doc.reconciliation, "count_time": _count_time(doc)}


@frappe.whitelist()
def correct_inventory(name, lines):
	"""One correction within the window: only changed lines, saved on the same count."""
	doc = frappe.get_doc("ServePOS Inventory Count", name)
	assert_can(can_act_for(doc.location), _("Not your location"))
	if doc.status != "Submitted":
		frappe.throw(_("A count can be corrected once"))
	if time_diff_in_hours(now_datetime(), doc.submitted_on) > flt(settings().correction_window_hours or 24):
		frappe.throw(_("The correction window has passed"))
	new = {l["item_code"]: l.get("counted") for l in _json(lines)}
	changed = []
	for r in doc.items:
		if r.item_code not in new or new[r.item_code] in (None, ""):
			continue
		val = flt(new[r.item_code])
		if r.is_counted and abs(val - flt(r.counted_qty)) < 1e-9:
			continue
		r.original_qty = r.counted_qty if r.is_counted else None
		r.counted_qty, r.is_counted, r.is_corrected = val, 1, 1
		r.difference = val - flt(r.system_qty)
		changed.append(r)
	if not changed:
		frappe.throw(_("Nothing changed"))
	sr = _reco(doc, [r.as_dict() for r in changed], _("Correction of inventory count {0}").format(doc.name))
	doc.correction_reconciliation = sr.name
	doc.status = "Corrected"
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "status": doc.status, "correction": sr.name, "changed": len(changed)}


# ---------------------------------------------------------------- reports

@frappe.whitelist()
def markup_report(from_date, to_date):
	assert_can(can_see_amounts(), _("Prices and values are not shown to your role"))
	return frappe.db.sql("""select to_location outlet, from_location provider, count(*) orders,
			sum(received_value) received_value, max(markup_percent) markup_percent, sum(markup_amount) markup_amount
		from `tabServePOS Stock Order`
		where order_type in ('Order', 'Delivery') and markup_percent>0 and received_on between %s and %s
		group by to_location, from_location order by to_location""", (from_date, f"{to_date} 23:59:59"), as_dict=True)
