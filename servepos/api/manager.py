"""Backend for the manager app (/manage): who is signed in, which outlets they see, and the Today dashboard.

The sales figures reuse servepos.api.pos_session (the same numbers the old /pos admin showed);
this module only adds the outlet list, the comparison with the previous period and POS status.
"""
import json

import frappe
from frappe import _
from frappe.utils import add_days, date_diff, flt, getdate, now_datetime, nowdate

from servepos.api import pos_session

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


def _totals(pos_profile, from_date, to_date):
	"""Sales and order count from submitted POS sales (Sales Invoice is_pos and legacy POS Invoice)."""
	_p, _s, rows = pos_session._fetch_pos_invoices(["name", "grand_total"], from_date, to_date, pos_profile)
	return {"total_sales": sum(flt(r.grand_total) for r in rows), "order_count": len(rows)}


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


@frappe.whitelist()
def get_dashboard(pos_profile=None, from_date=None, to_date=None):
	"""Everything the Today screen shows for one outlet or all of them, for a date range."""
	_require()
	_check_profile(pos_profile)
	from_date = str(getdate(from_date or nowdate()))
	to_date = str(getdate(to_date or from_date))
	days = date_diff(to_date, from_date) + 1
	prev_to = str(add_days(from_date, -1))
	prev_from = str(add_days(from_date, -days))

	sales = pos_session.get_sales_analytics(pos_profile, from_date, to_date)
	visible = [p.name for p in _profiles()]
	summary = pos_session.get_profile_summary(from_date, to_date)
	by_outlet = {r["profile"]: r for r in summary.get("rows", [])}
	pos_status = _pos_status([pos_profile] if pos_profile else visible)
	outlets = []
	for name in ([pos_profile] if pos_profile else visible):
		r = by_outlet.get(name) or {}
		outlets.append({"pos_profile": name, "total_sales": flt(r.get("total_sales")), "order_count": r.get("order_count") or 0,
			"tips": flt(r.get("tips")), **pos_status.get(name, {})})
	outlets.sort(key=lambda r: -r["total_sales"])
	return {
		"from_date": from_date, "to_date": to_date, "days": days,
		"previous": {"from_date": prev_from, "to_date": prev_to, **_totals(pos_profile, prev_from, prev_to)},
		"sales": sales,
		"outlets": outlets,
		"generated_at": str(now_datetime()),
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
