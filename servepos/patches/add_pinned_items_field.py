"""POS Profile: hidden JSON list of pinned favourite items (the till's Popular tab)."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	field = {
		"fieldname": "servepos_pinned_items",
		"label": "Pinned Items (JSON)",
		"fieldtype": "Long Text",
		"hidden": 1,
		"description": "JSON array of item codes pinned as favourites for this outlet, in display order. Managed from /pos > Menu.",
	}
	if frappe.get_meta("POS Profile").has_field("servepos_menu_item_order"):
		field["insert_after"] = "servepos_menu_item_order"
	create_custom_fields({"POS Profile": [field]}, update=True)
