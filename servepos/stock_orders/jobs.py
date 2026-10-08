import frappe
from frappe.utils import add_days, cint, now_datetime

from servepos.stock_orders.utils import settings


def auto_close_received():
	days = cint(settings().auto_close_days or 0)
	if not days:
		return
	cutoff = add_days(now_datetime(), -days)
	for name in frappe.get_all("ServePOS Stock Order", filters={"status": "Received", "received_on": ["<", cutoff]}, pluck="name"):
		frappe.db.set_value("ServePOS Stock Order", name, "status", "Closed")
	frappe.db.commit()
