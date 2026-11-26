"""Manager app endpoints for day close."""
import frappe
from frappe.utils import cint, getdate

from servepos.api.admin import _assert
from servepos.recipes import day_close as dc


@frappe.whitelist()
def list_day_closes(pos_profile=None, from_date=None, to_date=None):
	_assert()
	f = {}
	if pos_profile:
		f["pos_profile"] = pos_profile
	if from_date and to_date:
		f["business_date"] = ["between", [from_date, to_date]]
	rows = frappe.get_all(dc.DOCTYPE, filters=f, fields=["name", "pos_profile", "business_date", "status", "invoices", "items_sold",
		"consumed_value", "short_lines", "no_recipe", "warnings", "consumption_entry"], order_by="business_date desc, pos_profile asc", limit=200)
	return {"rows": rows, "business_date": str(dc.business_date()), "open_shortfalls": frappe.db.sql("""select count(*) from `tabServePOS Day Close Line` l
		join `tabServePOS Day Close` d on d.name = l.parent where l.status = 'Short' and d.status != 'Cancelled'""")[0][0]}


@frappe.whitelist()
def get_day_close(name):
	_assert()
	d = frappe.get_doc(dc.DOCTYPE, name)
	return d.as_dict()


@frappe.whitelist()
def preview_day(pos_profile, business_date):
	"""What closing would post now, without posting."""
	_assert()
	need, no_recipe, invoices, items_sold = dc.needs(pos_profile, getdate(business_date))
	wh = frappe.db.get_value("POS Profile", pos_profile, "warehouse")
	have = dc._available(need.keys(), wh)
	lines = [{"item_code": k, "item_name": frappe.get_cached_value("Item", k, "item_name"), "stock_uom": frappe.get_cached_value("Item", k, "stock_uom"),
		"needed_qty": v, "in_stock": have.get(k, 0)} for k, v in sorted(need.items())]
	return {"lines": lines, "no_recipe": no_recipe, "invoices": invoices, "items_sold": items_sold, "pending_deliveries": dc._pending_deliveries(pos_profile)}


@frappe.whitelist(methods=["POST"])
def close_day(pos_profile, business_date, force=0):
	_assert()
	return dc.close_day(pos_profile, business_date, force=cint(force)).name


@frappe.whitelist(methods=["POST"])
def cancel_day_close(name):
	_assert()
	return dc.cancel_day_close(name).status


@frappe.whitelist(methods=["POST"])
def retry_shortfalls(name):
	_assert()
	wh = frappe.db.get_value(dc.DOCTYPE, name, "warehouse")
	return dc.retry_shortfalls(wh)
