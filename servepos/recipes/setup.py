"""Setup for recipes and day close: custom fields, stock entry types. Safe to run repeatedly."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

DOCTYPES = ["servepos_day_close_line", "servepos_day_close"]
ENTRY_TYPES = {"POS Consumption": "Material Issue", "POS Waste": "Material Issue"}


def setup(sync=True):
	if sync:
		for dt in DOCTYPES:
			frappe.reload_doc("servepos", "doctype", dt, force=True)
	create_custom_fields({
		"BOM Item": [{
			"fieldname": "servepos_usable_qty", "label": "Usable qty (per recipe)", "fieldtype": "Float", "insert_after": "qty",
			"read_only": 1, "description": "The amount that ends up in the dish. Qty above is what leaves stock after trimming and cooking loss.",
		}, {
			"fieldname": "servepos_yield_percent", "label": "Yield %", "fieldtype": "Percent", "insert_after": "servepos_usable_qty",
			"default": "100", "read_only": 1,
		}],
		"Stock Entry": [{
			"fieldname": "servepos_day_close", "label": "ServePOS Day Close", "fieldtype": "Link", "options": "ServePOS Day Close",
			"insert_after": "stock_entry_type", "read_only": 1,
		}],
	}, update=True)
	for name, purpose in ENTRY_TYPES.items():
		if not frappe.db.exists("Stock Entry Type", name):
			frappe.get_doc({"doctype": "Stock Entry Type", "name": name, "purpose": purpose}).insert(ignore_permissions=True)
	seed_defaults()


def seed_defaults():
	"""Day close defaults on sites that had Stock Settings before these fields existed: a single's
	JSON default only applies to new sites, and every save writes 0 for unset fields. Runs once."""
	s = "ServePOS Stock Settings"
	if frappe.db.get_single_value(s, "day_close_seeded"):
		return
	if not frappe.db.get_single_value(s, "day_start_hour"):
		frappe.db.set_single_value(s, "day_start_hour", 5)
	frappe.db.set_single_value(s, "auto_day_close", 1)
	frappe.db.set_single_value(s, "day_close_seeded", 1)
