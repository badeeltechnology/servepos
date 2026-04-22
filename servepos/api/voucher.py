"""
ServePOS Voucher API
====================
Validate and redeem 6-digit discount voucher codes from the POS client.
"""
import frappe
from frappe import _
from frappe.utils import today, getdate


@frappe.whitelist()
def validate_voucher(code):
    """Validate a 6-digit voucher code.

    Returns:
        dict: {valid: True, discount_percent, description} on success,
              {valid: False, reason: "..."} on failure.
    """
    if not code or not str(code).strip():
        return {"valid": False, "reason": _("No voucher code provided.")}

    code = str(code).strip()

    voucher = frappe.db.get_value(
        "ServePOS Voucher",
        {"code": code},
        ["name", "code", "discount_percent", "max_uses", "times_used",
         "expires_on", "is_active", "description", "pos_profile"],
        as_dict=True,
    )

    if not voucher:
        return {"valid": False, "reason": _("Voucher code not found.")}

    if not voucher.is_active:
        return {"valid": False, "reason": _("This voucher is no longer active.")}

    if getdate(voucher.expires_on) < getdate(today()):
        return {"valid": False, "reason": _("This voucher has expired.")}

    if voucher.max_uses and voucher.max_uses > 0 and voucher.times_used >= voucher.max_uses:
        return {"valid": False, "reason": _("This voucher has already been fully redeemed.")}

    return {
        "valid": True,
        "discount_percent": voucher.discount_percent,
        "description": voucher.description or "",
        "pos_profile": voucher.pos_profile or "",
    }


@frappe.whitelist()
def use_voucher(code, order_number=None):
    """Mark a voucher as used. Called during sync when an invoice is created.

    Args:
        code: The 6-digit voucher code.
        order_number: Optional POS order number / Sales Invoice name for audit trail.

    Returns:
        dict: {success: True, times_used: N} on success,
              {success: False, reason: "..."} on failure.
    """
    if not code or not str(code).strip():
        return {"success": False, "reason": _("No voucher code provided.")}

    code = str(code).strip()

    voucher_name = frappe.db.get_value("ServePOS Voucher", {"code": code}, "name")
    if not voucher_name:
        return {"success": False, "reason": _("Voucher code not found.")}

    doc = frappe.get_doc("ServePOS Voucher", voucher_name)

    # Re-validate before incrementing
    if not doc.is_active:
        return {"success": False, "reason": _("This voucher is no longer active.")}

    if getdate(doc.expires_on) < getdate(today()):
        return {"success": False, "reason": _("This voucher has expired.")}

    if doc.max_uses and doc.max_uses > 0 and doc.times_used >= doc.max_uses:
        return {"success": False, "reason": _("This voucher has already been fully redeemed.")}

    doc.times_used = (doc.times_used or 0) + 1
    doc.flags.ignore_permissions = True
    doc.save()

    # Log the usage as a comment for audit trail
    if order_number:
        frappe.get_doc(
            doctype="Comment",
            comment_type="Info",
            reference_doctype="ServePOS Voucher",
            reference_name=doc.name,
            content=_("Voucher used for order: {0}").format(order_number),
        ).insert(ignore_permissions=True)

    return {"success": True, "times_used": doc.times_used}
