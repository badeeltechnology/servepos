# Copyright (c) 2026, Badeel Technology and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import get_system_timezone

no_cache = 1


def get_context(context):
    """Provide context for the ServePOS frontend including CSRF token."""
    csrf_token = frappe.sessions.get_csrf_token()
    context.csrf_token = csrf_token
    context.boot = get_boot()
    return context


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
    """Development mode endpoint to get boot data for Vite dev server."""
    if not frappe.conf.developer_mode:
        frappe.throw("This method is only available in developer mode")
    return get_boot()


def get_boot():
    """Return boot data for the frontend application."""
    return frappe._dict(
        {
            "frappe_version": frappe.__version__,
            "site_name": frappe.local.site,
            "read_only_mode": frappe.flags.read_only,
            "system_timezone": get_system_timezone(),
        }
    )
