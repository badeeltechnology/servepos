"""Backend for the manager app (/manage): who is signed in, which outlets they see, and the Today dashboard.

The sales figures reuse servepos.api.pos_session (the same numbers the old /pos admin showed);
this module only adds the outlet list, the comparison with the previous period and till status.
"""
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
	"""POS Profiles this user may see (user permissions apply)."""
	return frappe.get_list("POS Profile", filters={"disabled": 0}, fields=["name", "branch", "company", "warehouse", "currency"],
		order_by="name asc", limit_page_length=0)


def _check_profile(pos_profile):
	if pos_profile and pos_profile not in {p.name for p in _profiles()}:
		frappe.throw(_("You cannot see {0}").format(pos_profile), frappe.PermissionError)


@frappe.whitelist()
def get_context():
	_require()
	roles = set(frappe.get_roles())
	company = frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")
	return {
		"user": frappe.session.user,
		"full_name": frappe.utils.get_fullname(frappe.session.user),
		"today": nowdate(),
		"company": company,
		"currency": frappe.get_cached_value("Company", company, "default_currency") if company else "",
		"profiles": _profiles(),
		"is_manager": bool(roles & MANAGER_ROLES),
		"desk": frappe.get_cached_value("User", frappe.session.user, "user_type") == "System User",
	}


def _totals(pos_profile, from_date, to_date):
	"""Sales and order count from submitted POS sales (Sales Invoice is_pos and legacy POS Invoice)."""
	_p, _s, rows = pos_session._fetch_pos_invoices(["name", "grand_total"], from_date, to_date, pos_profile)
	return {"total_sales": sum(flt(r.grand_total) for r in rows), "order_count": len(rows)}


def _tills(names):
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
	tills = _tills([pos_profile] if pos_profile else visible)
	outlets = []
	for name in ([pos_profile] if pos_profile else visible):
		r = by_outlet.get(name) or {}
		outlets.append({"pos_profile": name, "total_sales": flt(r.get("total_sales")), "order_count": r.get("order_count") or 0,
			"tips": flt(r.get("tips")), **tills.get(name, {})})
	outlets.sort(key=lambda r: -r["total_sales"])
	return {
		"from_date": from_date, "to_date": to_date, "days": days,
		"previous": {"from_date": prev_from, "to_date": prev_to, **_totals(pos_profile, prev_from, prev_to)},
		"sales": sales,
		"outlets": outlets,
		"generated_at": str(now_datetime()),
	}
