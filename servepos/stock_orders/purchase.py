# Copyright (c) 2026, Badeel Technology and contributors
# For license information, please see license.txt
"""Purchase Order helpers: reuse what was last ordered from a supplier."""

import frappe
from frappe import _
from frappe.utils import cint, strip_html


@frappe.whitelist()
def supplier_items(supplier, company=None, months=12):
	"""Every item ordered from the supplier (submitted Purchase Orders in the last `months`), once each,
	with the description, UOM, rate and quantity of its latest order."""
	if not frappe.has_permission("Purchase Order", "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	cond, values = "", {"supplier": supplier, "months": cint(months) or 12}
	if company:
		cond = "and po.company = %(company)s"
		values["company"] = company
	rows = frappe.db.sql(
		f"""select poi.item_code, poi.item_name, poi.description, poi.uom, poi.conversion_factor, poi.stock_uom,
			poi.qty, poi.rate, po.transaction_date, po.name as purchase_order, poi.idx
		from `tabPurchase Order Item` poi
		join `tabPurchase Order` po on po.name = poi.parent
		where po.supplier = %(supplier)s and po.docstatus = 1 {cond}
			and po.transaction_date >= date_sub(curdate(), interval %(months)s month)
		order by po.transaction_date desc, po.creation desc, poi.idx asc""",
		values,
		as_dict=True,
	)
	latest, times, described = {}, {}, {}
	for r in rows:
		times[r.item_code] = times.get(r.item_code, 0) + 1
		if r.item_code not in latest:
			latest[r.item_code] = r
		if r.item_code not in described and strip_html(r.description or "").strip():
			described[r.item_code] = r.description  # the latest description someone actually typed
	disabled = set(frappe.get_all("Item", filters={"name": ["in", list(latest) or [""]], "disabled": 1}, pluck="name"))
	out = []
	for code, r in latest.items():
		if code in disabled:
			continue
		r.times_ordered = times[code]
		if not strip_html(r.description or "").strip() and code in described:
			r.description = described[code]
		r.description_text = strip_html(r.description or "").strip()
		out.append(r)
	out.sort(key=lambda r: (-r.times_ordered, r.item_name or ""))
	return out
