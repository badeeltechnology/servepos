"""Waiter App (Mobile API v2): role and default settings."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	insert_after = (
		"servepos_restaurant_display_name"
		if frappe.get_meta("POS Profile").has_field("servepos_restaurant_display_name")
		else None
	)
	field = {
		"fieldname": "servepos_waiter_app",
		"label": "Waiter App",
		"fieldtype": "Select",
		"options": "Old and new app\nNew app only",
		"default": "Old and new app",
		"description": "Which waiter phone app this outlet accepts. Switch to New app only once every waiter here uses the new app.",
	}
	if insert_after:
		field["insert_after"] = insert_after
	create_custom_fields({"POS Profile": [field]}, update=True)

	if not frappe.db.exists("Role", "ServePOS Waiter"):
		frappe.get_doc({"doctype": "Role", "role_name": "ServePOS Waiter", "desk_access": 0}).insert(
			ignore_permissions=True
		)

	if frappe.db.exists("DocType", "ServePOS Mobile Settings"):
		settings = frappe.get_single("ServePOS Mobile Settings")
		changed = False
		for field, default in (("session_days", 30), ("max_session_days", 180), ("allow_cancel_pending", 1)):
			if not settings.get(field) and field != "allow_cancel_pending":
				settings.set(field, default)
				changed = True
		if settings.get("allow_cancel_pending") is None:
			settings.allow_cancel_pending = 1
			changed = True
		if changed:
			settings.flags.ignore_permissions = True
			settings.save()
