"""
ServePOS Session Management API
Handles POS Opening/Closing entries and session management
"""
import frappe
from frappe import _
from frappe.utils import nowdate, now_datetime, nowtime, flt, cint
import json


# --------------------------------------------------------------------------- #
# Shared helpers for invoice + payment fetching
# --------------------------------------------------------------------------- #

def _build_date_filters(from_date=None, to_date=None, pos_profile=None):
    """Build standard base filters for POS invoice queries."""
    if not from_date:
        from_date = nowdate()
    if not to_date:
        to_date = nowdate()
    filters = {"docstatus": 1, "posting_date": ["between", [from_date, to_date]]}
    if pos_profile:
        filters["pos_profile"] = pos_profile
    return filters, from_date, to_date


def _fetch_pos_invoices(fields, from_date=None, to_date=None, pos_profile=None):
    """
    Fetch submitted POS Invoice + Sales Invoice (is_pos=1) with given fields.
    Returns (pos_invoices, si_invoices, all_invoices).
    """
    base, from_date, to_date = _build_date_filters(from_date, to_date, pos_profile)
    pos_invoices = frappe.get_all("POS Invoice", filters=base, fields=fields, limit_page_length=0)
    si_invoices = frappe.get_all("Sales Invoice", filters={**base, "is_pos": 1}, fields=fields, limit_page_length=0)
    return pos_invoices, si_invoices, pos_invoices + si_invoices


def _fetch_invoice_payments(pos_inv_names, si_inv_names):
    """
    Fetch payment child-table entries for the given POS/Sales invoice names.
    Returns {inv_name: [{"mode": str, "amount": float}, ...]}.
    """
    payment_map = {}
    for pay_dt, inv_names in [("POS Invoice Payment", pos_inv_names), ("Sales Invoice Payment", si_inv_names)]:
        if not inv_names:
            continue
        payments = frappe.get_all(
            pay_dt,
            filters={"parent": ["in", inv_names], "docstatus": 1},
            fields=["parent", "mode_of_payment", "amount"],
        )
        for p in payments:
            payment_map.setdefault(p.parent, []).append({
                "mode": p.mode_of_payment,
                "amount": flt(p.amount),
            })
    return payment_map


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
def record_void(pos_order_id, order_number, void_type, void_reason, voided_by,
                void_date=None, pos_profile=None, branch=None, items=None,
                void_remarks=None, void_disposition=None, table_name=None,
                order_type=None, grand_total=0, invoice_name=None, cashier_name=None):
    """
    Record a void action from the Desktop POS app.
    Creates a ServePOS Void Log entry for reporting.
    Optionally cancels the linked Sales Invoice.
    """
    import json as _json

    if not void_reason:
        frappe.throw(_("Void reason is required"))

    # Parse items if string
    if isinstance(items, str):
        items = _json.loads(items) if items else []

    # Check for duplicate (idempotent — same pos_order_id + void_type)
    existing = frappe.db.exists("ServePOS Void Log", {
        "pos_order_id": pos_order_id,
        "void_type": void_type
    })
    if existing:
        return {"message": "Already recorded", "name": existing}

    doc = frappe.get_doc({
        "doctype": "ServePOS Void Log",
        "pos_order_id": pos_order_id,
        "order_number": order_number,
        "invoice_name": invoice_name,
        "void_type": void_type,
        "void_reason": void_reason,
        "void_remarks": void_remarks,
        "void_disposition": void_disposition,
        "voided_by": voided_by,
        "cashier_name": cashier_name,
        "void_date": void_date or frappe.utils.now_datetime(),
        "pos_profile": pos_profile,
        "branch": branch,
        "table_name": table_name,
        "order_type": order_type,
        "grand_total": grand_total or 0,
        "items": []
    })

    if items:
        for item in items:
            doc.append("items", {
                "item_code": item.get("item_code"),
                "item_name": item.get("item_name"),
                "qty": item.get("qty", 0),
                "rate": item.get("rate", 0),
                "amount": item.get("amount", 0),
                "void_reason": item.get("void_reason", ""),
                "void_remarks": item.get("void_remarks", "")
            })

    doc.insert(ignore_permissions=True)

    # If invoice exists and is submitted, cancel it
    if invoice_name and void_type == "Order Void":
        try:
            inv = frappe.get_doc("Sales Invoice", invoice_name)
            if inv.docstatus == 1:
                inv.add_comment("Comment", _("Voided from POS. Reason: {0}").format(void_reason))
                inv.cancel()
        except Exception:
            frappe.log_error(f"Failed to cancel invoice {invoice_name} for void {doc.name}")

    frappe.db.commit()
    return {"message": "Void recorded", "name": doc.name}


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


# Legacy get_all_modifier_groups removed —
# use servepos.api.registry.get_modifier_groups(pos_profile).


@frappe.whitelist()
def get_invoice_summary(pos_profile=None, from_date=None, to_date=None):
    """
    Get invoice summary with payment details for reconciliation view.
    Returns: list of invoices with name, servepos_order_number, grand_total, paid_amount, mode_of_payment
    """
    base_fields = ["name", "grand_total", "paid_amount", "posting_date", "posting_time",
                   "status", "customer_name"]

    # POS Invoice has no servepos_order_number — fetch separately with different field lists
    base, from_date, to_date = _build_date_filters(from_date, to_date, pos_profile)
    pos_invoices = frappe.get_all("POS Invoice", filters=base, fields=base_fields, limit_page_length=0)
    si_invoices = frappe.get_all(
        "Sales Invoice", filters={**base, "is_pos": 1},
        fields=base_fields + ["servepos_order_number"], limit_page_length=0
    )

    all_invoices = pos_invoices + si_invoices
    if not all_invoices:
        return []

    payment_map = _fetch_invoice_payments(
        [i.name for i in pos_invoices], [i.name for i in si_invoices]
    )

    result = []
    for inv in all_invoices:
        modes = payment_map.get(inv.name, [])
        mode_str = ", ".join(f"{m['mode']}" for m in modes) if modes else ""
        result.append({
            "name": inv.name,
            "servepos_order_number": inv.get("servepos_order_number") or "",
            "customer_name": inv.get("customer_name") or "",
            "grand_total": flt(inv.grand_total),
            "paid_amount": flt(inv.paid_amount),
            "mode_of_payment": mode_str,
            "payments": modes,
            "posting_date": str(inv.posting_date),
            "posting_time": str(inv.posting_time or ""),
            "status": inv.status,
        })

    result.sort(key=lambda x: (x["posting_date"], x["posting_time"]), reverse=True)
    return result


@frappe.whitelist()
def get_profile_summary(from_date=None, to_date=None):
    """
    Per-POS-Profile revenue + payment breakdown for the dashboard overview.
    Returns one row per profile: total_sales, order_count, and amount per payment mode.
    """
    pos_invoices, si_invoices, all_invoices = _fetch_pos_invoices(
        ["name", "pos_profile", "grand_total"], from_date, to_date
    )
    if not all_invoices:
        return {"rows": [], "payment_modes": []}

    # Aggregate per profile
    profile_map = {}
    inv_to_profile = {}
    for inv in all_invoices:
        p = inv.pos_profile or "Unknown"
        if p not in profile_map:
            profile_map[p] = {"profile": p, "total_sales": 0, "order_count": 0, "payments": {}}
        profile_map[p]["total_sales"] += flt(inv.grand_total)
        profile_map[p]["order_count"] += 1
        inv_to_profile[inv.name] = p

    # Payment breakdown per profile
    payment_map = _fetch_invoice_payments(
        [i.name for i in pos_invoices], [i.name for i in si_invoices]
    )
    for inv_name, modes in payment_map.items():
        p = inv_to_profile.get(inv_name)
        if not p:
            continue
        for m in modes:
            mode = m["mode"] or "Other"
            profile_map[p]["payments"][mode] = profile_map[p]["payments"].get(mode, 0) + m["amount"]

    all_modes = set()
    for m in profile_map.values():
        all_modes.update(m["payments"].keys())

    result = []
    for m in profile_map.values():
        row = {"profile": m["profile"], "total_sales": m["total_sales"], "order_count": m["order_count"]}
        for mode in all_modes:
            row[mode] = m["payments"].get(mode, 0)
        result.append(row)

    result.sort(key=lambda x: x["total_sales"], reverse=True)
    return {"rows": result, "payment_modes": sorted(all_modes)}


@frappe.whitelist()
def get_sales_analytics(pos_profile=None, from_date=None, to_date=None):
    """Get comprehensive sales analytics for the dashboard"""
    base_filters, from_date, to_date = _build_date_filters(from_date, to_date, pos_profile)

    # --- All items visible to this POS profile (so zero-sales items show up too) ---
    profile_items = []
    if pos_profile:
        try:
            from servepos.api.registry import get_items as _registry_get_items
            profile_items = _registry_get_items(pos_profile) or []
        except Exception:
            profile_items = []

    def _seed_items_with_zero():
        seeded = {}
        for it in profile_items:
            code = it.get("item_code") or it.get("name")
            if not code:
                continue
            seeded[code] = {
                "item_code": code,
                "item_name": it.get("item_name") or code,
                "item_group": it.get("item_group"),
                "total_qty": 0.0,
                "total_amount": 0.0,
            }
        return seeded

    base_inv_fields = ["name", "grand_total", "net_total", "total_taxes_and_charges",
                       "posting_date", "posting_time", "pos_profile", "customer_name"]

    # --- Fetch POS Invoices (limited custom fields) ---
    pos_inv_fields = base_inv_fields + ["servepos_cashier"]
    pos_invoices = frappe.get_all(
        "POS Invoice",
        filters=base_filters,
        fields=pos_inv_fields,
        limit_page_length=0
    )

    # --- Fetch Sales Invoices (POS) — has all custom fields ---
    si_filters = {**base_filters, "is_pos": 1}
    si_inv_fields = base_inv_fields + ["servepos_order_type", "servepos_guests",
                                        "servepos_cashier", "servepos_waiter",
                                        "servepos_tip"]
    sales_invoices = frappe.get_all(
        "Sales Invoice",
        filters=si_filters,
        fields=si_inv_fields,
        limit_page_length=0
    )

    all_invoices = pos_invoices + sales_invoices
    invoice_names_pos = [i.name for i in pos_invoices]
    invoice_names_si = [i.name for i in sales_invoices]

    if not all_invoices:
        empty_items = list(_seed_items_with_zero().values())
        return {
            "total_sales": 0, "net_total": 0, "total_tax": 0,
            "order_count": 0, "avg_order": 0, "total_guests": 0,
            "total_tips": 0, "total_items_sold": 0,
            "payment_breakdown": [], "top_items": empty_items, "category_breakdown": [],
            "order_type_breakdown": [], "hourly_sales": [], "daily_sales": [],
            "cashier_breakdown": [],
            "void_summary": {"count": 0, "amount": 0, "void_rate": 0,
                             "by_type": [], "by_reason": [], "by_disposition": [],
                             "by_staff": [], "top_items": []},
        }

    # --- Payment Breakdown ---
    pay_map = {}
    for pay_doctype, inv_names in [("POS Invoice Payment", invoice_names_pos), ("Sales Invoice Payment", invoice_names_si)]:
        if not inv_names:
            continue
        table = frappe.qb.DocType(pay_doctype)
        rows = (
            frappe.qb.from_(table)
            .select(table.mode_of_payment, frappe.query_builder.functions.Sum(table.amount).as_("total"))
            .where(table.parent.isin(inv_names))
            .where(table.docstatus == 1)
            .groupby(table.mode_of_payment)
            .run(as_dict=True)
        )
        for r in rows:
            pay_map[r.mode_of_payment] = pay_map.get(r.mode_of_payment, 0) + flt(r.total)
    payment_breakdown = sorted(
        [{"mode_of_payment": k, "total": v} for k, v in pay_map.items()],
        key=lambda x: x["total"], reverse=True
    )

    # --- Top Selling Items (seeded with all profile items so zeros appear) ---
    item_map = _seed_items_with_zero()
    for item_doctype, inv_names in [("POS Invoice Item", invoice_names_pos), ("Sales Invoice Item", invoice_names_si)]:
        if not inv_names:
            continue
        table = frappe.qb.DocType(item_doctype)
        rows = (
            frappe.qb.from_(table)
            .select(
                table.item_code, table.item_name, table.item_group,
                frappe.query_builder.functions.Sum(table.qty).as_("total_qty"),
                frappe.query_builder.functions.Sum(table.amount).as_("total_amount"),
            )
            .where(table.parent.isin(inv_names))
            .where(table.docstatus == 1)
            .groupby(table.item_code)
            .run(as_dict=True)
        )
        for r in rows:
            if r.item_code in item_map:
                item_map[r.item_code]["total_qty"] += flt(r.total_qty)
                item_map[r.item_code]["total_amount"] += flt(r.total_amount)
            else:
                item_map[r.item_code] = {
                    "item_code": r.item_code, "item_name": r.item_name,
                    "item_group": r.item_group, "total_qty": flt(r.total_qty),
                    "total_amount": flt(r.total_amount),
                }
    item_data = list(item_map.values())

    top_items = sorted(item_data, key=lambda x: x["total_amount"], reverse=True)

    # --- Category Breakdown ---
    cat_map = {}
    for it in item_data:
        if it["total_qty"] == 0 and it["total_amount"] == 0:
            continue
        g = it.get("item_group") or "Uncategorized"
        if g not in cat_map:
            cat_map[g] = {"category": g, "qty": 0, "amount": 0, "items": 0}
        cat_map[g]["qty"] += it["total_qty"]
        cat_map[g]["amount"] += it["total_amount"]
        cat_map[g]["items"] += 1
    category_breakdown = sorted(cat_map.values(), key=lambda x: x["amount"], reverse=True)

    # --- Order Type Breakdown ---
    type_map = {}
    for inv in all_invoices:
        ot = inv.get("servepos_order_type") or "Other"
        if ot not in type_map:
            type_map[ot] = {"type": ot, "count": 0, "total": 0}
        type_map[ot]["count"] += 1
        type_map[ot]["total"] += inv.grand_total or 0
    order_type_breakdown = sorted(type_map.values(), key=lambda x: x["total"], reverse=True)

    # --- Hourly Sales Distribution ---
    hourly_map = {}
    for inv in all_invoices:
        hour = int(str(inv.posting_time or "0").split(":")[0])
        if hour not in hourly_map:
            hourly_map[hour] = {"hour": hour, "count": 0, "total": 0}
        hourly_map[hour]["count"] += 1
        hourly_map[hour]["total"] += inv.grand_total or 0
    hourly_sales = sorted(hourly_map.values(), key=lambda x: x["hour"])

    # --- Daily Sales (for multi-day ranges) ---
    daily_map = {}
    for inv in all_invoices:
        d = str(inv.posting_date)
        if d not in daily_map:
            daily_map[d] = {"date": d, "count": 0, "total": 0}
        daily_map[d]["count"] += 1
        daily_map[d]["total"] += inv.grand_total or 0
    daily_sales = sorted(daily_map.values(), key=lambda x: x["date"])

    # --- Waiter Breakdown ---
    waiter_map = {}
    for inv in all_invoices:
        w = inv.get("servepos_waiter") or ""
        if not w:
            continue
        if w not in waiter_map:
            waiter_map[w] = {"waiter": w, "count": 0, "total": 0}
        waiter_map[w]["count"] += 1
        waiter_map[w]["total"] += inv.grand_total or 0
    waiter_breakdown = sorted(waiter_map.values(), key=lambda x: x["total"], reverse=True)

    # --- Cashier Breakdown ---
    cashier_map = {}
    for inv in all_invoices:
        c = inv.get("servepos_cashier") or ""
        if not c:
            continue
        if c not in cashier_map:
            cashier_map[c] = {"cashier": c, "count": 0, "total": 0}
        cashier_map[c]["count"] += 1
        cashier_map[c]["total"] += inv.grand_total or 0
    cashier_breakdown = sorted(cashier_map.values(), key=lambda x: x["total"], reverse=True)

    # --- Totals ---
    total_sales = sum(inv.grand_total or 0 for inv in all_invoices)
    net_total = sum(inv.net_total or 0 for inv in all_invoices)
    total_tax = sum(inv.total_taxes_and_charges or 0 for inv in all_invoices)
    total_guests = sum(inv.servepos_guests or 0 for inv in all_invoices)
    total_tips = sum(flt(inv.get("servepos_tip") or 0) for inv in all_invoices)
    total_items_sold = sum(it["total_qty"] for it in item_data if it["total_qty"] > 0)
    order_count = len(all_invoices)

    # --- Void Analytics (from ServePOS Void Log) ---
    void_filters = {"void_date": ["between", [f"{from_date} 00:00:00", f"{to_date} 23:59:59"]]}
    if pos_profile:
        void_filters["pos_profile"] = pos_profile

    void_logs = frappe.get_all(
        "ServePOS Void Log",
        filters=void_filters,
        fields=["name", "void_type", "void_reason", "void_disposition",
                "grand_total", "voided_by", "order_number"],
        limit_page_length=0
    )

    void_count = len(void_logs)
    void_amount = sum(flt(v.grand_total) for v in void_logs)

    # Void by type
    void_type_map = {}
    for v in void_logs:
        vt = v.void_type or "Other"
        if vt not in void_type_map:
            void_type_map[vt] = {"type": vt, "count": 0, "amount": 0}
        void_type_map[vt]["count"] += 1
        void_type_map[vt]["amount"] += flt(v.grand_total)
    void_by_type = sorted(void_type_map.values(), key=lambda x: x["amount"], reverse=True)

    # Void by reason
    void_reason_map = {}
    for v in void_logs:
        vr = v.void_reason or "No reason"
        if vr not in void_reason_map:
            void_reason_map[vr] = {"reason": vr, "count": 0, "amount": 0}
        void_reason_map[vr]["count"] += 1
        void_reason_map[vr]["amount"] += flt(v.grand_total)
    void_by_reason = sorted(void_reason_map.values(), key=lambda x: x["count"], reverse=True)

    # Void by disposition
    void_disp_map = {}
    for v in void_logs:
        vd = v.void_disposition or "Not specified"
        if vd not in void_disp_map:
            void_disp_map[vd] = {"disposition": vd, "count": 0, "amount": 0}
        void_disp_map[vd]["count"] += 1
        void_disp_map[vd]["amount"] += flt(v.grand_total)
    void_by_disposition = sorted(void_disp_map.values(), key=lambda x: x["amount"], reverse=True)

    # Void by staff
    void_staff_map = {}
    for v in void_logs:
        vs = v.voided_by or "Unknown"
        if vs not in void_staff_map:
            void_staff_map[vs] = {"staff": vs, "count": 0, "amount": 0}
        void_staff_map[vs]["count"] += 1
        void_staff_map[vs]["amount"] += flt(v.grand_total)
    void_by_staff = sorted(void_staff_map.values(), key=lambda x: x["amount"], reverse=True)

    # Top voided items
    void_item_logs = []
    if void_logs:
        void_log_names = [v.name for v in void_logs]
        vli = frappe.qb.DocType("ServePOS Void Log Item")
        void_item_logs = (
            frappe.qb.from_(vli)
            .select(
                vli.item_code, vli.item_name,
                frappe.query_builder.functions.Sum(vli.qty).as_("total_qty"),
                frappe.query_builder.functions.Sum(vli.amount).as_("total_amount"),
            )
            .where(vli.parent.isin(void_log_names))
            .groupby(vli.item_code)
            .orderby(frappe.query_builder.functions.Sum(vli.amount), order=frappe.qb.desc)
            .limit(20)
            .run(as_dict=True)
        )

    return {
        "total_sales": total_sales,
        "net_total": net_total,
        "total_tax": total_tax,
        "order_count": order_count,
        "avg_order": total_sales / order_count if order_count else 0,
        "total_guests": total_guests,
        "total_tips": total_tips,
        "total_items_sold": total_items_sold,
        "payment_breakdown": payment_breakdown,
        "top_items": top_items,
        "category_breakdown": category_breakdown,
        "order_type_breakdown": order_type_breakdown,
        "hourly_sales": hourly_sales,
        "daily_sales": daily_sales,
        "waiter_breakdown": waiter_breakdown,
        "cashier_breakdown": cashier_breakdown,
        "void_summary": {
            "count": void_count,
            "amount": void_amount,
            "void_rate": round(void_count / (order_count + void_count) * 100, 1) if (order_count + void_count) > 0 else 0,
            "by_type": void_by_type,
            "by_reason": void_by_reason,
            "by_disposition": void_by_disposition,
            "by_staff": void_by_staff,
            "top_items": void_item_logs,
        },
    }
