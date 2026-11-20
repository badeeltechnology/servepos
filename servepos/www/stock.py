"""/stock moved into the manager app: /stock/<path> now opens /manage/stock/<path>.
Kept so bookmarks, tablets at the outlets and older landing pages keep working."""
import frappe

no_cache = 1


def get_context(context):
	path = frappe.request.path if frappe.request else "/stock"
	qs = frappe.request.query_string.decode() if frappe.request and frappe.request.query_string else ""
	frappe.local.flags.redirect_location = "/manage" + path + (("?" + qs) if qs else "")
	raise frappe.Redirect
