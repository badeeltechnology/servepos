"""How many decimals money has on this site, the way ERPNext decides it.

ERPNext uses System Settings > Currency Precision when it is set, and otherwise the number
format of the currency itself (OMR, KWD and BHD carry 3 decimals, QAR and AED 2).
"""

import frappe
from frappe.utils import cint


def currency_precision(currency=None):
	precision = cint(frappe.db.get_single_value("System Settings", "currency_precision"))
	if precision:
		return precision
	currency = currency or frappe.db.get_default("currency")
	number_format = (currency and frappe.db.get_value("Currency", currency, "number_format", cache=True)) or frappe.db.get_default("number_format")
	try:
		from frappe.utils.number_format import NumberFormat

		return NumberFormat.from_string(number_format or "#,###.##").precision
	except Exception:
		return 2
