import json
import os

import frappe

no_cache = 1

ASSET_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "stock")


def _assets():
	manifest = os.path.join(ASSET_DIR, ".vite", "manifest.json")
	if not os.path.exists(manifest):
		return {"js": "assets/index.js", "css": []}
	with open(manifest) as f:
		data = json.load(f)
	entry = data.get("index.html") or data.get("src/main.js") or next(iter(data.values()))
	return {"js": entry.get("file"), "css": entry.get("css", [])}


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=" + (frappe.request.path if frappe.request else "/stock")
		raise frappe.Redirect
	assets = _assets()
	context.csrf_token = frappe.sessions.get_csrf_token()
	context.asset_js = f"/assets/servepos/stock/{assets['js']}"
	context.asset_css = [f"/assets/servepos/stock/{c}" for c in assets["css"]]
	context.no_header = 1
	return context
