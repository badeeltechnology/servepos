"""
ServePOS Session Management API
Handles POS Opening/Closing entries and session management
"""
import frappe
from frappe import _
from frappe.utils import nowdate, now_datetime, nowtime, flt, cint
import json


@frappe.whitelist()
def check_opening_entry(user=None, pos_profile=None):
    """
    Check if user has an open POS session
    Returns open vouchers or None
    """
    if not user:
        user = frappe.session.user

    filters = {
        "user": user,
        "pos_closing_entry": ["in", ["", None]],
        "docstatus": 1,
        "status": "Open"
    }

    if pos_profile:
        filters["pos_profile"] = pos_profile

    open_vouchers = frappe.db.get_all(
        "POS Opening Entry",
        filters=filters,
        fields=["name", "company", "pos_profile", "period_start_date", "posting_date"],
        order_by="period_start_date desc"
    )

    return open_vouchers


@frappe.whitelist()
def create_opening_entry(pos_profile, company, balance_details=None):
    """
    Create a new POS Opening Entry
    balance_details: list of {mode_of_payment, opening_amount}
    """
    # Check if there's already an open session
    existing = check_opening_entry(frappe.session.user, pos_profile)
    if existing:
        frappe.throw(_("You already have an open POS session for this profile: {0}").format(existing[0].name))

    # Get payment methods from POS Profile
    pos_profile_doc = frappe.get_doc("POS Profile", pos_profile)

    if balance_details:
        if isinstance(balance_details, str):
            balance_details = json.loads(balance_details)
    else:
        # Default to 0 for all payment methods
        balance_details = []
        for payment in pos_profile_doc.payments:
            balance_details.append({
                "mode_of_payment": payment.mode_of_payment,
                "opening_amount": 0
            })

    # Create Opening Entry
    opening_entry = frappe.new_doc("POS Opening Entry")
    opening_entry.period_start_date = now_datetime()
    opening_entry.posting_date = nowdate()
    opening_entry.user = frappe.session.user
    opening_entry.pos_profile = pos_profile
    opening_entry.company = company

    for detail in balance_details:
        opening_entry.append("balance_details", {
            "mode_of_payment": detail.get("mode_of_payment"),
            "opening_amount": flt(detail.get("opening_amount", 0))
        })

    opening_entry.insert()
    opening_entry.submit()

    return {
        "name": opening_entry.name,
        "pos_profile": pos_profile,
        "company": company,
        "period_start_date": str(opening_entry.period_start_date)
    }


@frappe.whitelist()
def get_session_details(pos_opening_entry):
    """
    Get current session details including totals
    """
    opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)

    # Get all POS invoices in this session
    invoices = frappe.get_all(
        "POS Invoice",
        filters={
            "pos_profile": opening.pos_profile,
            "owner": opening.user,
            "posting_date": [">=", opening.posting_date],
            "creation": [">=", opening.period_start_date],
            "docstatus": 1
        },
        fields=["name", "grand_total", "total_taxes_and_charges", "net_total"]
    )

    # Calculate totals
    total_sales = sum(flt(inv.get("grand_total", 0)) for inv in invoices)
    total_tax = sum(flt(inv.get("total_taxes_and_charges", 0)) for inv in invoices)
    net_total = sum(flt(inv.get("net_total", 0)) for inv in invoices)

    # Get payment breakdown
    payment_breakdown = {}
    for inv in invoices:
        payments = frappe.get_all(
            "POS Invoice Payment",
            filters={"parent": inv["name"]},
            fields=["mode_of_payment", "amount"]
        )
        for p in payments:
            mode = p.get("mode_of_payment")
            if mode not in payment_breakdown:
                payment_breakdown[mode] = 0
            payment_breakdown[mode] += flt(p.get("amount", 0))

    # Get opening balances
    opening_balances = {}
    for detail in opening.balance_details:
        opening_balances[detail.mode_of_payment] = flt(detail.opening_amount)

    return {
        "opening_entry": pos_opening_entry,
        "pos_profile": opening.pos_profile,
        "company": opening.company,
        "user": opening.user,
        "period_start_date": str(opening.period_start_date),
        "invoice_count": len(invoices),
        "total_sales": total_sales,
        "total_tax": total_tax,
        "net_total": net_total,
        "payment_breakdown": payment_breakdown,
        "opening_balances": opening_balances
    }


@frappe.whitelist()
def create_closing_entry(pos_opening_entry, payment_reconciliation=None):
    """
    Create POS Closing Entry
    payment_reconciliation: list of {mode_of_payment, closing_amount}
    """
    opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)

    if opening.status == "Closed":
        frappe.throw(_("This session is already closed"))

    # Get session details
    session = get_session_details(pos_opening_entry)

    if payment_reconciliation:
        if isinstance(payment_reconciliation, str):
            payment_reconciliation = json.loads(payment_reconciliation)
    else:
        # Auto-populate from session data
        payment_reconciliation = []
        for mode, amount in session.get("payment_breakdown", {}).items():
            opening_amount = session.get("opening_balances", {}).get(mode, 0)
            payment_reconciliation.append({
                "mode_of_payment": mode,
                "opening_amount": opening_amount,
                "expected_amount": amount + opening_amount,
                "closing_amount": amount + opening_amount  # Default to expected
            })

    # Get POS invoices for this session
    invoices = frappe.get_all(
        "POS Invoice",
        filters={
            "pos_profile": opening.pos_profile,
            "owner": opening.user,
            "posting_date": [">=", opening.posting_date],
            "creation": [">=", opening.period_start_date],
            "docstatus": 1
        },
        fields=["name", "grand_total", "net_total", "total_taxes_and_charges", "posting_date", "posting_time", "customer"]
    )

    # Create Closing Entry
    closing = frappe.new_doc("POS Closing Entry")
    closing.period_start_date = opening.period_start_date
    closing.period_end_date = now_datetime()
    closing.posting_date = nowdate()
    closing.posting_time = nowtime()
    closing.pos_opening_entry = pos_opening_entry
    closing.pos_profile = opening.pos_profile
    closing.company = opening.company
    closing.user = opening.user
    closing.net_total = session.get("net_total", 0)
    closing.grand_total = session.get("total_sales", 0)
    closing.total_quantity = len(invoices)
    closing.total_taxes_and_charges = session.get("total_tax", 0)

    # Add invoices
    for inv in invoices:
        closing.append("pos_invoices", {
            "pos_invoice": inv.name,
            "grand_total": inv.grand_total,
            "posting_date": inv.posting_date,
            "customer": inv.customer
        })

    # Add payment reconciliation
    for rec in payment_reconciliation:
        closing.append("payment_reconciliation", {
            "mode_of_payment": rec.get("mode_of_payment"),
            "opening_amount": flt(rec.get("opening_amount", 0)),
            "expected_amount": flt(rec.get("expected_amount", 0)),
            "closing_amount": flt(rec.get("closing_amount", 0)),
            "difference": flt(rec.get("closing_amount", 0)) - flt(rec.get("expected_amount", 0))
        })

    closing.insert()
    closing.submit()

    # Update Opening Entry
    frappe.db.set_value("POS Opening Entry", pos_opening_entry, {
        "status": "Closed",
        "pos_closing_entry": closing.name
    })

    frappe.db.commit()

    return {
        "name": closing.name,
        "grand_total": closing.grand_total,
        "invoice_count": len(invoices)
    }


@frappe.whitelist()
def get_pos_profiles_for_user():
    """
    Get POS Profiles available for the current user
    """
    user = frappe.session.user

    # Get profiles where user is allowed
    profiles = frappe.get_all(
        "POS Profile",
        filters={"disabled": 0},
        fields=["name", "company", "warehouse", "customer", "write_off_account"]
    )

    allowed_profiles = []
    for profile in profiles:
        profile_doc = frappe.get_doc("POS Profile", profile.name)

        # Check if user is in applicable users or no users specified (all allowed)
        if not profile_doc.applicable_for_users:
            allowed_profiles.append(profile)
        else:
            for u in profile_doc.applicable_for_users:
                if u.user == user:
                    allowed_profiles.append(profile)
                    break

    # Add session status for each profile
    for profile in allowed_profiles:
        session = check_opening_entry(user, profile["name"])
        profile["has_open_session"] = len(session) > 0
        if session:
            profile["open_session"] = session[0]

    return allowed_profiles


@frappe.whitelist()
def get_payment_methods(pos_profile):
    """
    Get payment methods configured for a POS Profile
    """
    profile = frappe.get_doc("POS Profile", pos_profile)

    payments = []
    for p in profile.payments:
        payments.append({
            "mode_of_payment": p.mode_of_payment,
            "default": cint(p.default)
        })

    return payments


@frappe.whitelist()
def void_invoice(invoice_name, reason):
    """
    Cancel/void a POS Invoice with reason
    """
    if not reason:
        frappe.throw(_("Void reason is required"))

    invoice = frappe.get_doc("POS Invoice", invoice_name)

    if invoice.docstatus == 2:
        frappe.throw(_("Invoice is already cancelled"))

    if invoice.docstatus != 1:
        frappe.throw(_("Only submitted invoices can be voided"))

    # Store void reason
    invoice.add_comment("Comment", _("Invoice voided. Reason: {0}").format(reason))

    # Cancel the invoice
    invoice.cancel()

    frappe.db.commit()

    return {"message": _("Invoice voided successfully")}


@frappe.whitelist()
def create_return_invoice(original_invoice, items_to_return=None):
    """
    Create a return/refund invoice
    items_to_return: list of {item_code, qty, rate} for partial returns
    """
    original = frappe.get_doc("POS Invoice", original_invoice)

    if original.docstatus != 1:
        frappe.throw(_("Only submitted invoices can be returned"))

    if items_to_return:
        if isinstance(items_to_return, str):
            items_to_return = json.loads(items_to_return)

    # Create return invoice
    return_invoice = frappe.new_doc("POS Invoice")
    return_invoice.is_return = 1
    return_invoice.return_against = original_invoice
    return_invoice.pos_profile = original.pos_profile
    return_invoice.customer = original.customer
    return_invoice.company = original.company
    return_invoice.posting_date = nowdate()
    return_invoice.posting_time = nowtime()
    return_invoice.set_warehouse = original.set_warehouse

    # Copy custom fields
    if original.get("servepos_table"):
        return_invoice.servepos_table = original.servepos_table
    if original.get("servepos_order_type"):
        return_invoice.servepos_order_type = original.servepos_order_type

    if items_to_return:
        # Partial return - only return specified items
        for item in items_to_return:
            # Find original item
            original_item = None
            for oi in original.items:
                if oi.item_code == item.get("item_code"):
                    original_item = oi
                    break

            if original_item:
                return_invoice.append("items", {
                    "item_code": item.get("item_code"),
                    "item_name": original_item.item_name,
                    "qty": -abs(flt(item.get("qty", 1))),  # Negative qty for return
                    "rate": flt(item.get("rate")) or original_item.rate,
                    "uom": original_item.uom,
                    "warehouse": original_item.warehouse
                })
    else:
        # Full return - return all items
        for item in original.items:
            return_invoice.append("items", {
                "item_code": item.item_code,
                "item_name": item.item_name,
                "qty": -item.qty,  # Negative qty for return
                "rate": item.rate,
                "uom": item.uom,
                "warehouse": item.warehouse
            })

    # Copy payments (negative amounts for refund)
    for payment in original.payments:
        return_invoice.append("payments", {
            "mode_of_payment": payment.mode_of_payment,
            "amount": -payment.amount if not items_to_return else 0  # Will be calculated
        })

    return_invoice.insert()
    return_invoice.submit()

    frappe.db.commit()

    return {
        "name": return_invoice.name,
        "grand_total": return_invoice.grand_total,
        "message": _("Return invoice created successfully")
    }


@frappe.whitelist()
def get_closing_summary_preview(pos_opening_entry):
    """
    Get a preview of closing summary before creating closing entry
    """
    session = get_session_details(pos_opening_entry)

    # Prepare reconciliation data
    reconciliation = []
    opening_balances = session.get("opening_balances", {})
    payment_breakdown = session.get("payment_breakdown", {})

    # Get all modes of payment from opening
    all_modes = set(list(opening_balances.keys()) + list(payment_breakdown.keys()))

    for mode in all_modes:
        opening = flt(opening_balances.get(mode, 0))
        sales = flt(payment_breakdown.get(mode, 0))
        expected = opening + sales

        reconciliation.append({
            "mode_of_payment": mode,
            "opening_amount": opening,
            "sales_amount": sales,
            "expected_amount": expected,
            "closing_amount": expected  # Default to expected
        })

    return {
        "session": session,
        "reconciliation": reconciliation
    }


@frappe.whitelist()
def get_pos_settings():
    """
    Get POS Settings for the current site
    Returns invoice_type and other relevant settings
    """
    pos_settings = frappe.get_single("POS Settings")
    return {
        "invoice_type": pos_settings.invoice_type or "POS Invoice"
    }


@frappe.whitelist()
def get_item_modifiers(item_code):
    """
    Get modifiers for an item.
    First checks item-level modifiers, then falls back to item group level.
    """
    # Get item's modifier groups
    item_modifier_groups = frappe.get_all(
        "ServePOS Item Modifier Group",
        filters={"parent": item_code, "parenttype": "Item"},
        fields=["modifier_group", "is_required", "display_order"],
        order_by="display_order"
    )

    # If no item-level modifiers, check item group
    if not item_modifier_groups:
        item_group = frappe.db.get_value("Item", item_code, "item_group")
        if item_group:
            item_modifier_groups = frappe.get_all(
                "ServePOS Item Modifier Group",
                filters={"parent": item_group, "parenttype": "Item Group"},
                fields=["modifier_group", "is_required", "display_order"],
                order_by="display_order"
            )

    # Build modifier data
    result = []
    for img in item_modifier_groups:
        group = frappe.get_doc("ServePOS Modifier Group", img.modifier_group)
        modifiers = []
        for m in group.modifiers:
            modifiers.append({
                "name": m.modifier_name,
                "price": flt(m.price),
                "is_default": cint(m.is_default)
            })

        result.append({
            "group_name": group.group_name,
            "selection_type": group.selection_type,
            "is_required": cint(img.is_required) or cint(group.is_required),
            "max_selections": cint(group.max_selections),
            "modifiers": modifiers
        })

    return result


@frappe.whitelist()
def get_all_modifier_groups():
    """Get all modifier groups for configuration"""
    groups = frappe.get_all(
        "ServePOS Modifier Group",
        fields=["name", "group_name", "selection_type", "is_required", "max_selections"]
    )

    for group in groups:
        group["modifiers"] = frappe.get_all(
            "ServePOS Modifier",
            filters={"parent": group.name},
            fields=["modifier_name", "price", "is_default"]
        )

    return groups
