"""Waiter App (Mobile API v2): role and default settings."""

import frappe


def execute():
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
