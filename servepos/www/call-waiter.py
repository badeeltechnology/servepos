# Copyright (c) 2026, Badeel Technology and contributors
# For license information, please see license.txt

import json
import os

import frappe

no_cache = 1

# Guest page — no login required
allow_guest = True

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
    """Provide context for the guest call-waiter page.
    This page is accessible without login (allow_guest = True)."""
    csrf_token = frappe.sessions.get_csrf_token()
    context.csrf_token = csrf_token

    # Pass minimal context — actual data is fetched via API
    context.guest_context = {
        "site_name": frappe.local.site,
    }

    assets = _read_manifest()
    context.asset_js = f"/assets/servepos/frontend/{assets['js']}"
    context.asset_css = f"/assets/servepos/frontend/{assets['css']}"

    return context
