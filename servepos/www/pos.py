# Copyright (c) 2026, Badeel Technology and contributors
# For license information, please see license.txt

import json
import os

import frappe
from frappe.utils import get_system_timezone

no_cache = 1

ASSET_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "public",
    "frontend",
)


def _read_manifest():
    """Read Vite manifest to resolve hashed asset filenames."""
    manifest_path = os.path.join(ASSET_DIR, ".vite", "manifest.json")
    if not os.path.exists(manifest_path):
        return {"js": "assets/index.js", "css": "assets/index.css"}

    with open(manifest_path) as f:
        manifest = json.load(f)

    entry = manifest.get("src/main.tsx", {})
    js_file = entry.get("file", "assets/index.js")
    css_files = entry.get("css", [])
    css_file = css_files[0] if css_files else "assets/index.css"

    return {"js": js_file, "css": css_file}


def get_context(context):
    """Provide context for the ServePOS frontend including CSRF token."""
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/pos"
        raise frappe.Redirect

    csrf_token = frappe.sessions.get_csrf_token()
    context.csrf_token = csrf_token
    context.boot = get_boot()

    assets = _read_manifest()
    context.asset_js = f"/assets/servepos/frontend/{assets['js']}"
    context.asset_css = f"/assets/servepos/frontend/{assets['css']}"

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
