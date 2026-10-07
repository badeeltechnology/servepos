"""ERPNext entries created by Stock Orders. Users never create these by hand."""
import frappe
from frappe import _
from frappe.utils import flt

from servepos.stock_orders.utils import bin_qty, settings


def _company(warehouse):
	return frappe.get_cached_value("Warehouse", warehouse, "company")


def _rate_for(item_code, warehouse):
	r = flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate"))
	if not r:
		r = flt(frappe.db.get_value("Item", item_code, "valuation_rate"))
	if not r:
		r = flt(frappe.db.sql("""select valuation_rate from `tabStock Ledger Entry`
			where item_code=%s and is_cancelled=0 and valuation_rate>0
			order by posting_datetime desc, creation desc limit 1""", item_code)[0][0]
			if frappe.db.sql("select 1 from `tabStock Ledger Entry` where item_code=%s and valuation_rate>0 limit 1", item_code) else 0)
	return r


def make_entry(order, purpose, rows, remarks, additional_cost=None):
	"""rows: dicts with item_code, qty (stock UOM), s_warehouse/t_warehouse, optional expense_account/basic_rate."""
	rows = [r for r in rows if flt(r["qty"]) > 0]
	if not rows:
		return None
	wh = rows[0].get("s_warehouse") or rows[0].get("t_warehouse")
	se = frappe.new_doc("Stock Entry")
	se.stock_entry_type = purpose
	se.purpose = purpose
	se.company = _company(wh)
	se.servepos_stock_order = order.name
	se.remarks = remarks
	for r in rows:
		stock_uom = frappe.get_cached_value("Item", r["item_code"], "stock_uom")
		row = {
			"item_code": r["item_code"],
			"qty": flt(r["qty"]),
			"transfer_qty": flt(r["qty"]),
			"uom": stock_uom,
			"stock_uom": stock_uom,
			"conversion_factor": 1,
			"s_warehouse": r.get("s_warehouse"),
			"t_warehouse": r.get("t_warehouse"),
		}
		if r.get("basic_rate") is not None:
			row["basic_rate"] = r["basic_rate"]
			row["set_basic_rate_manually"] = 1
			if not flt(r["basic_rate"]):
				row["allow_zero_valuation_rate"] = 1
		if r.get("expense_account"):
			row["expense_account"] = r["expense_account"]
		se.append("items", row)
	if additional_cost and flt(additional_cost.get("amount")) > 0:
		se.append("additional_costs", additional_cost)
	se.flags.ignore_permissions = True
	se.insert()
	se.submit()
	return se


def record_production_shortfall(order, from_wh, need):
	"""need: {item_code: stock qty to ship}. Receives the missing quantity into the provider first."""
	have = bin_qty(need.keys(), from_wh)
	rows = []
	for code, qty in need.items():
		short = flt(qty) - flt(have.get(code, {}).get("actual_qty") if have.get(code) else 0)
		if short > 0.0001:
			rows.append({"item_code": code, "qty": short, "t_warehouse": from_wh, "basic_rate": _rate_for(code, from_wh)})
	if not rows:
		return None
	return make_entry(order, "Material Receipt", rows,
		_("Production recorded for Stock Order {0}: quantity shipped beyond recorded stock").format(order.name))


def check_available(from_wh, need):
	have = bin_qty(need.keys(), from_wh)
	short = []
	for code, qty in need.items():
		avail = flt(have[code].actual_qty) if code in have else 0
		if flt(qty) - avail > 0.0001:
			short.append((code, avail, qty))
	return short


def transit_wh():
	wh = settings().transit_warehouse
	if not wh:
		frappe.throw(_("Set the in-transit warehouse in ServePOS Stock Settings"))
	return wh
