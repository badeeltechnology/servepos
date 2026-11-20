"""Backend for the manager app (/manage): who is signed in, which outlets they see, and the Today dashboard.

The sales figures reuse servepos.api.pos_session (the same numbers the old /pos admin showed);
this module only adds the outlet list, the comparison with the previous period and POS status.
"""
import json

import frappe
from frappe import _
from frappe.utils import add_days, date_diff, flt, getdate, now_datetime, nowdate

from servepos.api import analytics, pos_session

MANAGER_ROLES = {"System Manager", "ServePOS Manager"}
VIEW_ROLES = MANAGER_ROLES | {"ServePOS Reporter"}


def _require(roles=VIEW_ROLES):
	if frappe.session.user == "Guest" or not (set(frappe.get_roles()) & roles):
		frappe.throw(_("You need the ServePOS Manager or ServePOS Reporter role"), frappe.PermissionError)


def _profiles():
	"""POS Profiles this user may see. User permissions on POS Profile apply; a Reporter without desk
	read access on POS Profile still sees the outlets, limited by those user permissions when set."""
	fields = ["name", "branch", "company", "warehouse", "currency"]
	if frappe.has_permission("POS Profile", "read"):
		return frappe.get_list("POS Profile", filters={"disabled": 0}, fields=fields, order_by="name asc", limit_page_length=0)
	filters = {"disabled": 0}
	allowed = [p.get("doc") for p in frappe.permissions.get_user_permissions(frappe.session.user).get("POS Profile", [])]
	if allowed:
		filters["name"] = ["in", allowed]
	return frappe.get_all("POS Profile", filters=filters, fields=fields, order_by="name asc", limit_page_length=0)


def _check_profile(pos_profile):
	if pos_profile and pos_profile not in {p.name for p in _profiles()}:
		frappe.throw(_("You cannot see {0}").format(pos_profile), frappe.PermissionError)


@frappe.whitelist()
def get_context():
	"""Who is signed in. Anyone signed in may open /manage: stock-only users (outlet staff, the central
	kitchen, buyers) see just their stock screens, so this never refuses; sales screens check is_viewer."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in"), frappe.PermissionError)
	roles = set(frappe.get_roles())
	viewer = bool(roles & VIEW_ROLES) or frappe.session.user == "Administrator"
	company = frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")
	return {
		"user": frappe.session.user,
		"full_name": frappe.utils.get_fullname(frappe.session.user),
		"today": nowdate(),
		"company": company,
		"currency": frappe.get_cached_value("Company", company, "default_currency") if company else "",
		"profiles": _profiles() if viewer else [],
		"is_viewer": viewer,
		"is_manager": bool(roles & MANAGER_ROLES) or frappe.session.user == "Administrator",
		"desk": frappe.get_cached_value("User", frappe.session.user, "user_type") == "System User",
	}


def _pos_status(names):
	"""Per outlet: when its last sale reached ERPNext and its last closed shift."""
	if not names:
		return {}
	out = {n: {"last_sale": None, "last_shift": None} for n in names}
	for r in frappe.db.sql("""select pos_profile, max(creation) as last_sale from `tabSales Invoice`
			where is_pos = 1 and docstatus = 1 and pos_profile in %(p)s and creation >= %(since)s group by pos_profile""",
			{"p": tuple(names), "since": add_days(nowdate(), -30)}, as_dict=True):
		out[r.pos_profile]["last_sale"] = r.last_sale
	for r in frappe.db.sql("""select pos_profile, max(closed_at) as last_shift from `tabServePOS Shift Log`
			where pos_profile in %(p)s group by pos_profile""", {"p": tuple(names)}, as_dict=True):
		if r.pos_profile in out:
			out[r.pos_profile]["last_shift"] = r.last_shift
	return out


def _scope(pos_profile):
	"""The outlets a report covers: the chosen one, or every outlet this user may see."""
	return [pos_profile] if pos_profile else [p.name for p in _profiles()]


def _dates(from_date, to_date):
	f = str(getdate(from_date or nowdate()))
	return f, str(getdate(to_date or f))


@frappe.whitelist()
def get_dashboard(pos_profile=None, from_date=None, to_date=None):
	"""Everything the Today and Sales screens show for one outlet or all of them, for a date range,
	with the period before and the same dates last year to compare against."""
	_require()
	_check_profile(pos_profile)
	from_date, to_date = _dates(from_date, to_date)
	scope = _scope(pos_profile)
	per = analytics.periods(from_date, to_date)
	sales = analytics.sales(scope, from_date, to_date, seed_profile=pos_profile)
	now_by, prev_by = sales.pop("by_outlet"), analytics.by_outlet(scope, *per["previous"])
	pos_status = _pos_status(scope)
	outlets = []
	for name in scope:
		r, p = now_by.get(name) or {}, prev_by.get(name) or {}
		orders = int(flt(r.get("order_count")))
		outlets.append({"pos_profile": name, "total_sales": flt(r.get("total_sales")), "order_count": orders,
			"avg_order": flt(r.get("total_sales")) / orders if orders else 0, "guests": int(flt(r.get("guests"))),
			"tips": flt(r.get("tips")), "discount": flt(r.get("discount")), "previous_sales": flt(p.get("total_sales")),
			**pos_status.get(name, {})})
	outlets.sort(key=lambda r: -r["total_sales"])
	return {
		"from_date": from_date, "to_date": to_date, "days": date_diff(to_date, from_date) + 1,
		"previous": {"from_date": per["previous"][0], "to_date": per["previous"][1], **analytics.totals(scope, *per["previous"])},
		"last_year": {"from_date": per["last_year"][0], "to_date": per["last_year"][1], **analytics.totals(scope, *per["last_year"])},
		"sales": sales,
		"outlets": outlets,
		"day_start_hour": int(frappe.db.get_single_value("ServePOS Stock Settings", "day_start_hour") or 5) if frappe.db.exists("DocType", "ServePOS Stock Settings") else 5,
		"generated_at": str(now_datetime()),
	}


@frappe.whitelist()
def get_compare(pos_profile=None, from_date=None, to_date=None, against="previous", other_from=None, other_to=None):
	"""Two periods side by side: totals, each outlet, each day (lined up by day), categories and
	the items that moved most. against = previous | last_year | custom (other_from, other_to)."""
	_require()
	_check_profile(pos_profile)
	from_date, to_date = _dates(from_date, to_date)
	scope = _scope(pos_profile)
	if against == "custom" and other_from:
		b_from, b_to = _dates(other_from, other_to)
	else:
		b_from, b_to = analytics.periods(from_date, to_date)["last_year" if against == "last_year" else "previous"]

	ta, ga = analytics._pass(scope, from_date, to_date)
	tb, gb = analytics._pass(scope, b_from, b_to)

	def day_series(g, f, t):
		out, d = [], getdate(f)
		while d <= getdate(t):
			r = g["day"].get(d) or {}
			out.append({"date": str(d), "total": flt(r.get("total")), "count": int(r.get("count") or 0)})
			d = add_days(d, 1)
		return out

	def item_map(f, t):
		return {r.item_code: r for r in analytics.items(scope, f, t)}

	a_items, b_items = item_map(from_date, to_date), item_map(b_from, b_to)
	moves = []
	for code in set(a_items) | set(b_items):
		a, b = a_items.get(code) or {}, b_items.get(code) or {}
		moves.append({"item_code": code, "item_name": (a or b).get("item_name"), "item_group": (a or b).get("item_group"),
			"a_qty": flt(a.get("total_qty")), "b_qty": flt(b.get("total_qty")),
			"a_amount": flt(a.get("total_amount")), "b_amount": flt(b.get("total_amount"))})
	for m in moves:
		m["change"] = m["a_amount"] - m["b_amount"]
	cats = {}
	for m in moves:
		c = cats.setdefault(m["item_group"] or "Uncategorized", {"category": m["item_group"] or "Uncategorized", "a": 0, "b": 0})
		c["a"] += m["a_amount"]
		c["b"] += m["b_amount"]
	outlets = []
	for name in scope:
		a, b = ga["outlet"].get(name) or {}, gb["outlet"].get(name) or {}
		outlets.append({"pos_profile": name, "a_sales": flt(a.get("total")), "b_sales": flt(b.get("total")),
			"a_orders": int(a.get("count") or 0), "b_orders": int(b.get("count") or 0),
			"a_guests": int(flt(a.get("guests"))), "b_guests": int(flt(b.get("guests")))})
	outlets.sort(key=lambda r: -r["a_sales"])
	moves.sort(key=lambda m: m["change"])
	return {
		"a": {"from_date": from_date, "to_date": to_date, **ta, "days": day_series(ga, from_date, to_date)},
		"b": {"from_date": b_from, "to_date": b_to, **tb, "days": day_series(gb, b_from, b_to)},
		"outlets": outlets,
		"categories": sorted(cats.values(), key=lambda c: -c["a"]),
		"risers": [m for m in reversed(moves) if m["change"] > 0][:10],
		"fallers": [m for m in moves if m["change"] < 0][:10],
	}


# ---------------------------------------------------------------- menu engineering and food cost

@frappe.whitelist()
def get_menu_engineering(pos_profile=None, from_date=None, to_date=None, item_group=None):
	"""Each menu item by popularity (share of portions sold) and profit per portion (price less recipe
	cost), against the averages of the items compared: Star (popular, profitable), Plowhorse (popular,
	low profit), Puzzle (profitable, not popular), Dog (neither). Items without a recipe have no cost,
	so they are listed apart."""
	_require()
	_check_profile(pos_profile)
	from_date, to_date = _dates(from_date, to_date)
	from servepos.recipes.recipe import all_recipe_costs

	rows = [r for r in analytics.items(_scope(pos_profile), from_date, to_date) if flt(r.total_qty) > 0]
	groups = sorted({r.item_group or "Uncategorized" for r in rows})
	if item_group:
		rows = [r for r in rows if (r.item_group or "Uncategorized") == item_group]
	costs = all_recipe_costs([r.item_code for r in rows])
	costed = [r for r in rows if r.item_code in costs]
	total_qty = sum(flt(r.total_qty) for r in costed)
	items, no_recipe = [], []
	for r in rows:
		qty, amount = flt(r.total_qty), flt(r.net_amount or r.total_amount)
		price = amount / qty if qty else 0
		row = {"item_code": r.item_code, "item_name": r.item_name, "item_group": r.item_group, "qty": qty, "sales": amount, "price": price}
		if r.item_code not in costs:
			no_recipe.append(row)
			continue
		cost = flt(costs[r.item_code])
		row.update({"cost": cost, "margin": price - cost, "total_margin": (price - cost) * qty,
			"food_cost_pct": cost / price * 100 if price else 0, "mix_pct": qty / total_qty * 100 if total_qty else 0})
		items.append(row)
	avg_margin = sum(i["total_margin"] for i in items) / total_qty if total_qty else 0
	# popular: at least 70 % of an even share (the usual menu engineering rule)
	pop_line = (100 / len(items)) * 0.7 if items else 0
	for i in items:
		popular, profitable = i["mix_pct"] >= pop_line, i["margin"] >= avg_margin
		i["class"] = "Star" if popular and profitable else "Plowhorse" if popular else "Puzzle" if profitable else "Dog"
	items.sort(key=lambda i: -i["total_margin"])
	no_recipe.sort(key=lambda i: -i["sales"])
	return {"from_date": from_date, "to_date": to_date, "item_group": item_group or "", "groups": groups,
		"avg_margin": avg_margin, "popularity_line": pop_line, "items": items, "no_recipe": no_recipe,
		"no_recipe_sales": sum(i["sales"] for i in no_recipe), "costed_sales": sum(i["sales"] for i in items)}


@frappe.whitelist()
def get_food_cost(pos_profile=None, from_date=None, to_date=None):
	"""Food cost from recipes (what the sales should have used, at today's ingredient costs) per outlet
	and per day, next to what day close took out of stock, shortfalls still open and recorded waste."""
	_require()
	_check_profile(pos_profile)
	from_date, to_date = _dates(from_date, to_date)
	from servepos.recipes.recipe import all_recipe_costs

	scope = _scope(pos_profile)
	costs = all_recipe_costs()
	w, a = analytics._where(scope, from_date, to_date)

	def lines(key):
		# sales lines grouped by (key, item): the covering index answers this without reading invoice rows
		return frappe.db.sql(f"""select {key} as k, sii.item_code, sum(sii.stock_qty) as qty, sum(sii.qty) as sold, sum(sii.net_amount) as sales
			from `tabSales Invoice Item` sii join `tabSales Invoice` si on si.name = sii.parent where {w} group by 1, 2""", a, as_dict=True)

	def roll(rows):
		out = {}
		for r in rows:
			o = out.setdefault(r.k, {"sales": 0.0, "recipe_sales": 0.0, "cost": 0.0})
			o["sales"] += flt(r.sales)
			if r.item_code in costs:
				o["recipe_sales"] += flt(r.sales)
				o["cost"] += flt(r.qty) * flt(costs[r.item_code])
		return out

	def shape(o):
		sales, rs, cost = flt(o.get("sales")), flt(o.get("recipe_sales")), flt(o.get("cost"))
		return {"sales": sales, "recipe_sales": rs, "cost": cost, "food_cost_pct": cost / rs * 100 if rs else 0,
			"coverage_pct": rs / sales * 100 if sales else 0}

	by_outlet_items = lines("si.pos_profile")
	per_outlet = {k: shape(v) for k, v in roll(by_outlet_items).items()}
	total = shape({f: sum(flt(o[f]) for o in per_outlet.values()) for f in ("sales", "recipe_sales", "cost")})
	daily = [{"date": str(k), **shape(v)} for k, v in sorted(roll(lines("si.posting_date")).items())]
	items = {}
	for r in by_outlet_items:
		it = items.setdefault(r.item_code, {"item_code": r.item_code, "qty": 0.0, "sales": 0.0, "cost": 0.0, "has_recipe": r.item_code in costs})
		it["qty"] += flt(r.sold)
		it["sales"] += flt(r.sales)
		it["cost"] += flt(r.qty) * flt(costs.get(r.item_code) or 0)
	names = dict(frappe.get_all("Item", filters={"name": ["in", list(items) or ["-"]]}, fields=["name", "item_name"], as_list=True)) if items else {}
	for it in items.values():
		it["item_name"] = names.get(it["item_code"]) or it["item_code"]
	items = sorted(items.values(), key=lambda r: -r["sales"])

	dc = {r.pos_profile: r for r in frappe.db.sql("""select pos_profile, sum(consumed_value) as posted, sum(short_lines) as short_lines, count(*) as days
		from `tabServePOS Day Close` where docstatus < 2 and status != 'Cancelled' and business_date between %(f)s and %(t)s and pos_profile in %(ps)s
		group by pos_profile""", {"f": from_date, "t": to_date, "ps": tuple(scope) or ("-",)}, as_dict=True)}
	wh = {p.name: p.warehouse for p in _profiles() if p.name in scope}
	waste = {}
	if wh and frappe.db.exists("Stock Entry Type", "POS Waste"):
		for r in frappe.db.sql("""select sed.s_warehouse as wh, sum(sed.amount) as v from `tabStock Entry Detail` sed
				join `tabStock Entry` se on se.name = sed.parent
				where se.docstatus = 1 and se.stock_entry_type = 'POS Waste' and se.posting_date between %(f)s and %(t)s
				and sed.s_warehouse in %(w)s group by sed.s_warehouse""", {"f": from_date, "t": to_date, "w": tuple(set(wh.values())) or ("-",)}, as_dict=True):
			waste[r.wh] = flt(r.v)
	outlets = []
	for name in scope:
		d = dc.get(name) or {}
		outlets.append({"pos_profile": name, **per_outlet.get(name, shape({})), "posted": flt(d.get("posted")),
			"closed_days": int(flt(d.get("days"))), "short_lines": int(flt(d.get("short_lines"))), "waste": waste.get(wh.get(name), 0)})
	outlets.sort(key=lambda o: -o["sales"])

	with_recipe = [{**r, "food_cost_pct": flt(r["cost"]) / flt(r["sales"]) * 100 if flt(r["sales"]) else 0} for r in items if r["has_recipe"]]
	return {
		"from_date": from_date, "to_date": to_date, "total": total, "daily": daily, "outlets": outlets,
		"posted": sum(o["posted"] for o in outlets), "waste": sum(o["waste"] for o in outlets),
		"short_lines": sum(o["short_lines"] for o in outlets), "recipes": len(costs),
		"highest": sorted(with_recipe, key=lambda r: -r["food_cost_pct"])[:15],
		"no_recipe": [r for r in items if not r["has_recipe"]][:20],
	}


# ---------------------------------------------------------------- sales detail: invoices, voids, export

@frappe.whitelist()
def list_invoices(pos_profile=None, from_date=None, to_date=None, search=None, start=0, page_length=50):
	"""POS sales (Sales Invoice, is_pos) for a period, newest first, one page at a time."""
	_require()
	_check_profile(pos_profile)
	from_date = str(getdate(from_date or nowdate()))
	to_date = str(getdate(to_date or from_date))
	cond = ["si.is_pos = 1", "si.docstatus = 1", "si.posting_date between %(f)s and %(t)s"]
	args = {"f": from_date, "t": to_date, "start": int(start or 0), "len": min(int(page_length or 50), 200)}
	if pos_profile:
		cond.append("si.pos_profile = %(p)s")
		args["p"] = pos_profile
	else:
		names = [p.name for p in _profiles()] or ["-"]
		cond.append("si.pos_profile in %(ps)s")
		args["ps"] = tuple(names)
	if search:
		cond.append("(si.name like %(s)s or si.servepos_order_number like %(s)s or si.customer_name like %(s)s)")
		args["s"] = f"%{search.strip()}%"
	where = " and ".join(cond)
	rows = frappe.db.sql(f"""select si.name, si.servepos_order_number as order_number, si.posting_date, si.posting_time, si.creation,
			si.pos_profile, si.customer_name, si.grand_total, si.servepos_order_type as order_type, si.servepos_table as table_name,
			si.servepos_waiter as waiter, si.is_return, si.status
		from `tabSales Invoice` si where {where} order by si.posting_date desc, si.creation desc limit %(start)s, %(len)s""", args, as_dict=True)
	total = frappe.db.sql(f"select count(*), coalesce(sum(si.grand_total), 0) from `tabSales Invoice` si where {where}", args)[0]
	if rows:
		pays = {}
		for p in frappe.db.sql("""select parent, mode_of_payment from `tabSales Invoice Payment` where parent in %(n)s and amount != 0""",
				{"n": tuple(r.name for r in rows)}, as_dict=True):
			pays.setdefault(p.parent, []).append(p.mode_of_payment)
		for r in rows:
			r.payments = ", ".join(sorted(set(pays.get(r.name, []))))
	return {"rows": rows, "total": total[0], "amount": flt(total[1])}


@frappe.whitelist()
def get_invoice(name):
	_require()
	doctype = "Sales Invoice" if frappe.db.exists("Sales Invoice", name) else "POS Invoice"
	_check_profile(frappe.db.get_value(doctype, name, "pos_profile"))
	data = pos_session.get_invoice_detail(name)
	doc = frappe.get_doc(doctype, name)
	data.update({"order_number": doc.get("servepos_order_number"), "order_type": doc.get("servepos_order_type"), "table": doc.get("servepos_table"),
		"waiter": doc.get("servepos_waiter"), "cashier": doc.get("servepos_cashier"), "tip": flt(doc.get("servepos_tip")),
		"discount_amount": flt(doc.discount_amount), "discount_reason": doc.get("servepos_discount_reason"), "remarks": doc.remarks,
		"modifiers": {i.name: i.get("servepos_modifiers") for i in doc.items}, "desk_url": f"/app/{frappe.scrub(doctype).replace('_', '-')}/{name}"})
	for i, row in zip(data.get("items") or [], doc.items):
		try:
			mods = json.loads(row.get("servepos_modifiers") or "[]")
		except Exception:
			mods = []
		i["modifiers"] = ", ".join((m.get("name") or m.get("modifier_name") or "") for m in mods if isinstance(m, dict))
		i["comment"] = row.get("servepos_comment")
	return data


@frappe.whitelist()
def list_voids(pos_profile=None, from_date=None, to_date=None):
	_require()
	_check_profile(pos_profile)
	from_date = str(getdate(from_date or nowdate()))
	to_date = str(getdate(to_date or from_date))
	rows = pos_session.get_void_log_summary(pos_profile, from_date, to_date) or []
	if not pos_profile:
		visible = {p.name for p in _profiles()}
		rows = [r for r in rows if not r.get("pos_profile") or r.get("pos_profile") in visible]
	return rows


@frappe.whitelist()
def export_sales(pos_profile=None, from_date=None, to_date=None):
	"""Excel workbook of the period: summary, payments, items, staff, voids and every invoice."""
	_require()
	from frappe.utils.xlsxutils import make_xlsx

	d = get_dashboard(pos_profile, from_date, to_date)
	s = d["sales"]
	title = f"{pos_profile or 'All outlets'} {d['from_date']}" + (f" to {d['to_date']}" if d["to_date"] != d["from_date"] else "")
	rows = [["Sales report", title], [],
		["Total sales", flt(s["total_sales"], 2)], ["Net total", flt(s["net_total"], 2)], ["Tax", flt(s["total_tax"], 2)],
		["Orders", s["order_count"]], ["Average bill", flt(s["avg_order"], 2)], ["Guests", s["total_guests"]], ["Tips", flt(s["total_tips"], 2)],
		["Voids", s["void_summary"]["count"]], ["Void amount", flt(s["void_summary"]["amount"], 2)], [],
		["Payment method", "Amount"]] + [[p["mode_of_payment"], flt(p["total"], 2)] for p in s["payment_breakdown"]] + [[],
		["Order type", "Orders", "Sales"]] + [[t["type"], t["count"], flt(t["total"], 2)] for t in s["order_type_breakdown"]] + [[],
		["Outlet", "Orders", "Sales", "Tips"]] + [[o["pos_profile"], o["order_count"], flt(o["total_sales"], 2), flt(o["tips"], 2)] for o in d["outlets"]] + [[],
		["Waiter", "Orders", "Sales"]] + [[w["waiter"], w["count"], flt(w["total"], 2)] for w in s.get("waiter_breakdown", [])] + [[],
		["Cashier", "Orders", "Sales"]] + [[c["cashier"], c["count"], flt(c["total"], 2)] for c in s.get("cashier_breakdown", [])]
	items = [["Item code", "Item", "Category", "Qty", "Sales"]] + [[i["item_code"], i["item_name"], i.get("item_group"), flt(i["total_qty"], 3), flt(i["total_amount"], 2)]
		for i in sorted(s["top_items"], key=lambda x: -flt(x["total_amount"])) if flt(i["total_qty"])]
	voids = [["Order", "Type", "Reason", "Disposition", "Amount", "By", "When"]] + [[v.get("order_number") or v.get("name"), v.get("void_type"), v.get("void_reason"),
		v.get("void_disposition"), flt(v.get("grand_total"), 2), v.get("voided_by"), str(v.get("void_date") or "")]
		for v in list_voids(pos_profile, d["from_date"], d["to_date"])]
	inv = list_invoices(pos_profile, d["from_date"], d["to_date"], page_length=200)
	invoices = [["Invoice", "Order", "Outlet", "Date", "Customer", "Type", "Table", "Waiter", "Payment", "Total"]] + [[r.name, r.order_number, r.pos_profile,
		str(r.posting_date), r.customer_name, r.order_type, r.table_name, r.waiter, r.payments, flt(r.grand_total, 2)] for r in inv["rows"]]
	# make_xlsx writes one sheet; the extra sheets are added with openpyxl on the same workbook
	from io import BytesIO

	from openpyxl import load_workbook

	wb = load_workbook(BytesIO(make_xlsx(rows, "Summary").getvalue()))
	for sheet, data in (("Items", items), ("Voids", voids), ("Invoices", invoices)):
		ws = wb.create_sheet(sheet)
		for r in data:
			ws.append(r)
	buf = BytesIO()
	wb.save(buf)
	frappe.response["filename"] = f"Sales {title}.xlsx"
	frappe.response["filecontent"] = buf.getvalue()
	frappe.response["type"] = "binary"
