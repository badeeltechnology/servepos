"""
ServePOS Stock Management API
Handles automatic stock deduction using BOM (Bill of Materials)
"""
import frappe
from frappe import _
from frappe.utils import flt, nowdate, nowtime


@frappe.whitelist()
def deduct_stock_for_invoice(pos_invoice):
    """
    Create Stock Entry (Manufacture) for all items in a POS Invoice using their BOMs.

    This creates finished goods stock by consuming raw materials.
    The POS Invoice then deducts the finished goods via normal stock flow.
    """
    invoice = frappe.get_doc("POS Invoice", pos_invoice)

    # Check if auto deduct is enabled
    pos_profile = frappe.get_doc("POS Profile", invoice.pos_profile)
    if not pos_profile.get("auto_deduct_stock"):
        return {"message": "Auto stock deduction not enabled", "stock_entries": []}

    # Get warehouse from POS Profile
    warehouse = pos_profile.warehouse
    if not warehouse:
        frappe.throw(_("Warehouse not set in POS Profile"))

    created_entries = []

    for item in invoice.items:
        # Check if item has a BOM
        bom = get_default_bom(item.item_code)
        if not bom:
            continue

        # Create Stock Entry (Manufacture) for finished goods production
        stock_entry = create_manufacture_entry(
            bom=bom,
            qty=item.qty,
            warehouse=warehouse,
            pos_invoice=pos_invoice
        )

        if stock_entry:
            created_entries.append(stock_entry)

    return {
        "message": f"Created {len(created_entries)} stock entries",
        "stock_entries": created_entries
    }


def get_default_bom(item_code):
    """Get default BOM for an item"""
    bom = frappe.db.get_value(
        "BOM",
        {"item": item_code, "is_active": 1, "is_default": 1},
        "name"
    )
    return bom


def create_manufacture_entry(bom, qty, warehouse, pos_invoice):
    """
    Create Stock Entry (Manufacture) for finished goods production based on BOM.

    This creates a manufacture entry that:
    - Consumes raw materials from BOM (source warehouse)
    - Produces finished goods (target warehouse)

    The finished goods are then deducted via POS Invoice stock flow.
    """
    # Get BOM details
    bom_doc = frappe.get_doc("BOM", bom)

    # Get company - try from POS Invoice first, fall back to BOM
    if frappe.db.exists("POS Invoice", pos_invoice):
        company = frappe.db.get_value("POS Invoice", pos_invoice, "company")
    else:
        company = bom_doc.company

    # Create Stock Entry with Manufacture type
    stock_entry = frappe.new_doc("Stock Entry")
    stock_entry.stock_entry_type = "Manufacture"
    stock_entry.posting_date = nowdate()
    stock_entry.posting_time = nowtime()
    stock_entry.set_posting_time = 1
    stock_entry.company = company

    # BOM settings
    stock_entry.bom_no = bom
    stock_entry.from_bom = 1
    stock_entry.use_multi_level_bom = 1
    stock_entry.fg_completed_qty = flt(qty)

    # Warehouse settings
    stock_entry.from_warehouse = warehouse
    stock_entry.to_warehouse = warehouse

    # Add custom field reference to invoice (POS Invoice or Sales Invoice)
    if frappe.db.exists("POS Invoice", pos_invoice):
        stock_entry.custom_pos_invoice = pos_invoice
    elif frappe.db.exists("Sales Invoice", pos_invoice):
        stock_entry.custom_sales_invoice = pos_invoice

    # Add raw materials from BOM (source warehouse - consumed)
    for bom_item in bom_doc.items:
        raw_qty = flt(bom_item.qty) * flt(qty) / flt(bom_doc.quantity)
        stock_entry.append("items", {
            "item_code": bom_item.item_code,
            "item_name": bom_item.item_name,
            "qty": raw_qty,
            "uom": bom_item.uom or bom_item.stock_uom,
            "stock_uom": bom_item.stock_uom,
            "conversion_factor": bom_item.conversion_factor or 1,
            "s_warehouse": warehouse,  # Source - raw materials consumed
            "bom_no": "",
            "is_finished_item": 0
        })

    # Add finished good (target warehouse - produced)
    fg_item = frappe.get_doc("Item", bom_doc.item)
    stock_entry.append("items", {
        "item_code": bom_doc.item,
        "item_name": bom_doc.item_name,
        "qty": flt(qty),
        "uom": bom_doc.uom,
        "stock_uom": fg_item.stock_uom,
        "conversion_factor": 1,
        "t_warehouse": warehouse,  # Target - finished goods produced
        "bom_no": bom,
        "is_finished_item": 1
    })

    # Check stock availability for raw materials
    for item in stock_entry.items:
        if item.s_warehouse:
            available_qty = get_available_qty(item.item_code, item.s_warehouse)
            if available_qty < item.qty:
                frappe.msgprint(
                    _("Insufficient stock for {0}. Available: {1}, Required: {2}").format(
                        item.item_code, available_qty, item.qty
                    ),
                    indicator="orange"
                )

    stock_entry.insert()
    stock_entry.submit()

    return stock_entry.name


def get_available_qty(item_code, warehouse):
    """Get available quantity for an item in a warehouse"""
    from erpnext.stock.utils import get_stock_balance
    return get_stock_balance(item_code, warehouse)


@frappe.whitelist()
def check_stock_availability(items, warehouse):
    """
    Check stock availability for items before order
    Returns list of items with insufficient stock
    """
    if isinstance(items, str):
        import json
        items = json.loads(items)

    insufficient = []

    for item in items:
        item_code = item.get("item_code")
        qty = flt(item.get("qty", 1))

        # Check if item has BOM
        bom = get_default_bom(item_code)
        if bom:
            # Check raw materials
            bom_doc = frappe.get_doc("BOM", bom)
            for bom_item in bom_doc.items:
                raw_qty = flt(bom_item.qty) * qty / flt(bom_doc.quantity)
                available = get_available_qty(bom_item.item_code, warehouse)

                if available < raw_qty:
                    insufficient.append({
                        "finished_item": item_code,
                        "raw_item": bom_item.item_code,
                        "raw_item_name": bom_item.item_name,
                        "required": raw_qty,
                        "available": available,
                        "short": raw_qty - available
                    })
        else:
            # Check item itself
            available = get_available_qty(item_code, warehouse)
            if available < qty:
                insufficient.append({
                    "item": item_code,
                    "item_name": item.get("item_name", item_code),
                    "required": qty,
                    "available": available,
                    "short": qty - available
                })

    return {
        "has_insufficient": len(insufficient) > 0,
        "insufficient_items": insufficient
    }


@frappe.whitelist()
def get_item_stock_status(item_code, warehouse):
    """Get detailed stock status for an item"""
    bom = get_default_bom(item_code)

    if bom:
        # Item has BOM - show raw materials
        bom_doc = frappe.get_doc("BOM", bom)
        materials = []

        for bom_item in bom_doc.items:
            available = get_available_qty(bom_item.item_code, warehouse)
            # How many finished items can be made
            can_make = available / (flt(bom_item.qty) / flt(bom_doc.quantity)) if bom_item.qty else 0

            materials.append({
                "item_code": bom_item.item_code,
                "item_name": bom_item.item_name,
                "required_per_unit": flt(bom_item.qty) / flt(bom_doc.quantity),
                "available": available,
                "can_make": int(can_make)
            })

        # Find limiting material
        min_can_make = min((m["can_make"] for m in materials), default=0)

        return {
            "has_bom": True,
            "bom": bom,
            "can_make": min_can_make,
            "materials": materials
        }
    else:
        # No BOM - show direct stock
        available = get_available_qty(item_code, warehouse)
        return {
            "has_bom": False,
            "available": available
        }


def create_manufacture_entries_before_submit(doc, method):
    """
    Hook: Create Stock Entry (Manufacture) BEFORE invoice is submitted.

    This produces finished goods stock so the invoice can deduct it on submit.
    For Sales Invoice with update_stock=1, the finished goods need to exist.
    """
    # Check if this is a POS invoice
    if not doc.get("pos_profile"):
        return

    # Check if auto deduct is enabled
    pos_profile = frappe.get_doc("POS Profile", doc.pos_profile)
    if not pos_profile.get("auto_deduct_stock"):
        return

    warehouse = pos_profile.warehouse
    if not warehouse:
        return

    created_entries = []

    for item in doc.items:
        # Check if item has a BOM
        bom = get_default_bom(item.item_code)
        if not bom:
            continue

        try:
            # Create Stock Entry (Manufacture) for this item
            stock_entry = create_manufacture_entry(
                bom=bom,
                qty=item.qty,
                warehouse=warehouse,
                pos_invoice=doc.name
            )
            if stock_entry:
                created_entries.append(stock_entry)
        except Exception as e:
            # Log error but allow submission to continue
            frappe.log_error(
                f"Failed to create manufacture entry for {item.item_code}: {str(e)}",
                "ServePOS Manufacture Entry Error"
            )
            frappe.msgprint(
                _("Could not create manufacture entry for {0}: {1}").format(item.item_code, str(e)),
                indicator="orange"
            )

    if created_entries:
        frappe.msgprint(
            _("Created {0} manufacture entries for raw material consumption").format(len(created_entries)),
            indicator="green"
        )


def auto_deduct_stock_on_submit(doc, method):
    """Hook: Auto deduct stock when POS Invoice is submitted (deprecated - use before_submit)"""
    # This function is kept for backwards compatibility but is no longer used
    pass


def reverse_stock_on_cancel(doc, method):
    """Hook: Reverse stock entries when invoice is cancelled (POS or Sales Invoice)"""
    # Determine which field to filter by based on doctype
    if doc.doctype == "Sales Invoice":
        filter_field = "custom_sales_invoice"
    else:
        filter_field = "custom_pos_invoice"

    # Find and cancel related stock entries
    stock_entries = frappe.get_all(
        "Stock Entry",
        filters={
            filter_field: doc.name,
            "docstatus": 1
        },
        pluck="name"
    )

    for entry_name in stock_entries:
        try:
            entry = frappe.get_doc("Stock Entry", entry_name)
            entry.cancel()
            frappe.msgprint(
                _("Reversed stock entry: {0}").format(entry_name),
                indicator="blue"
            )
        except Exception as e:
            frappe.log_error(f"Error reversing stock entry {entry_name}: {str(e)}")
            frappe.msgprint(
                _("Could not reverse stock entry {0}: {1}").format(entry_name, str(e)),
                indicator="red"
            )
