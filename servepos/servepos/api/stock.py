"""
Stock Management API for ServePOS

Handles automatic raw material consumption via Stock Entry (Manufacture)
when POS Invoice is submitted.
"""

import frappe
from frappe import _
from frappe.utils import flt


def create_stock_consumption_for_invoice(doc, method):
    """
    Hook: Called on POS Invoice submit
    Creates Stock Entry (Manufacture) for items with BOM to auto-deduct raw materials
    """
    if not doc.pos_profile:
        return

    pos_profile = frappe.get_doc("POS Profile", doc.pos_profile)

    # Check if auto_deduct_stock is enabled (custom field)
    if not pos_profile.get("auto_deduct_stock"):
        return

    warehouse = pos_profile.warehouse
    if not warehouse:
        frappe.throw(_("Warehouse not set in POS Profile"))

    stock_entries_created = []

    for item in doc.items:
        # Check if BOM exists for this item
        bom = frappe.db.get_value(
            "BOM",
            {
                "item": item.item_code,
                "is_active": 1,
                "is_default": 1,
            },
            "name",
        )

        if not bom:
            continue  # No BOM, skip (handled by regular POS stock deduction)

        try:
            # Create Stock Entry with Manufacture type
            se = frappe.new_doc("Stock Entry")
            se.stock_entry_type = "Manufacture"
            se.company = doc.company
            se.bom_no = bom
            se.from_bom = 1
            se.use_multi_level_bom = 1  # Explode all BOM levels
            se.fg_completed_qty = item.qty
            se.from_warehouse = warehouse

            # THE MAGIC: This auto-populates all raw materials from BOM!
            se.get_items()

            # Custom field to link back to POS Invoice
            se.custom_pos_invoice = doc.name
            se.custom_pos_invoice_item = item.name
            se.remarks = f"Auto consumption for {item.item_name} x {item.qty} from POS Invoice {doc.name}"

            se.insert()
            se.submit()

            stock_entries_created.append(se.name)

        except Exception as e:
            frappe.log_error(
                title=f"ServePOS Stock Entry Error - {item.item_code}",
                message=str(e),
            )
            # Continue with other items even if one fails
            continue

    if stock_entries_created:
        frappe.msgprint(
            _("Raw materials consumed: {0}").format(", ".join(stock_entries_created)),
            indicator="green",
            alert=True,
        )


def reverse_stock_consumption(doc, method):
    """
    Hook: Called on POS Invoice cancel
    Cancels linked Stock Entries to reverse the raw material consumption
    """
    # Find all stock entries linked to this POS Invoice
    stock_entries = frappe.get_all(
        "Stock Entry",
        filters={
            "custom_pos_invoice": doc.name,
            "docstatus": 1,
        },
        pluck="name",
    )

    for se_name in stock_entries:
        try:
            se_doc = frappe.get_doc("Stock Entry", se_name)
            se_doc.cancel()
        except Exception as e:
            frappe.log_error(
                title=f"ServePOS Stock Entry Cancel Error - {se_name}",
                message=str(e),
            )


@frappe.whitelist()
def get_item_bom(item_code):
    """Get the default BOM for an item"""
    bom = frappe.db.get_value(
        "BOM",
        {
            "item": item_code,
            "is_active": 1,
            "is_default": 1,
        },
        ["name", "quantity", "total_cost"],
        as_dict=True,
    )
    return bom


@frappe.whitelist()
def get_bom_items(bom):
    """Get raw materials for a BOM"""
    if not bom:
        return []

    bom_doc = frappe.get_doc("BOM", bom)
    items = []

    for item in bom_doc.items:
        items.append(
            {
                "item_code": item.item_code,
                "item_name": item.item_name,
                "qty": item.qty,
                "uom": item.uom,
                "rate": item.rate,
                "amount": item.amount,
            }
        )

    return items


@frappe.whitelist()
def check_raw_material_availability(item_code, qty, warehouse):
    """
    Check if raw materials are available for a menu item
    Returns: {"available": True/False, "shortages": [...]}
    """
    bom = frappe.db.get_value(
        "BOM",
        {
            "item": item_code,
            "is_active": 1,
            "is_default": 1,
        },
        "name",
    )

    if not bom:
        return {"available": True, "shortages": [], "has_bom": False}

    bom_doc = frappe.get_doc("BOM", bom)
    shortages = []

    for bom_item in bom_doc.items:
        required_qty = flt(bom_item.qty) * flt(qty)

        # Get available stock
        available_qty = frappe.db.get_value(
            "Bin",
            {"item_code": bom_item.item_code, "warehouse": warehouse},
            "actual_qty",
        ) or 0

        if available_qty < required_qty:
            shortages.append(
                {
                    "item_code": bom_item.item_code,
                    "item_name": bom_item.item_name,
                    "required_qty": required_qty,
                    "available_qty": available_qty,
                    "shortage": required_qty - available_qty,
                }
            )

    return {
        "available": len(shortages) == 0,
        "shortages": shortages,
        "has_bom": True,
    }
