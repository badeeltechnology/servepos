"""
ServePOS Waiter API
Handles waiter order creation and management from the mobile app
"""
import frappe
from frappe import _
from frappe.utils import now_datetime, flt, cint
import json


@frappe.whitelist()
def get_waiters():
    """Get list of active waiters (names only, no PINs)"""
    return frappe.get_all(
        "ServePOS Waiter",
        filters={"is_active": 1},
        fields=["name", "waiter_name", "phone"],
        order_by="waiter_name"
    )


@frappe.whitelist()
def verify_waiter_pin(waiter_name, pin):
    """Verify waiter PIN and return waiter info"""
    waiter = frappe.get_doc("ServePOS Waiter", waiter_name)
    if not waiter or not waiter.is_active:
        return {"success": False, "error": "Waiter not found or inactive"}

    # Compare PIN (stored as Password field)
    stored_pin = waiter.get_password("pin")
    if stored_pin == pin:
        return {
            "success": True,
            "waiter_name": waiter.waiter_name,
            "phone": waiter.phone
        }
    return {"success": False, "error": "Invalid PIN"}


@frappe.whitelist()
def create_order(waiter_name=None, order_type="Dine In", table=None, room=None, guests=1, notes=None, items=None):
    """Create a waiter order from the mobile app"""
    if not items:
        frappe.throw(_("Items are required"))

    if isinstance(items, str):
        items = json.loads(items)

    if not items:
        frappe.throw(_("At least one item is required"))

    doc = frappe.new_doc("ServePOS Waiter Order")
    doc.waiter_name = waiter_name or "Unknown"
    doc.order_type = order_type
    doc.table = table
    doc.room = room
    doc.guests = cint(guests) or 1
    doc.notes = notes

    for item in items:
        doc.append("items", {
            "item_code": item.get("item_code"),
            "item_name": item.get("item_name"),
            "qty": flt(item.get("qty", 1)),
            "rate": flt(item.get("rate", 0)),
            "modifiers": item.get("modifiers"),
            "modifier_total": flt(item.get("modifier_total", 0)),
            "special_instructions": item.get("special_instructions"),
        })

    doc.insert()
    return doc.as_dict()


@frappe.whitelist()
def get_my_orders(waiter_name=None, status_filter=None):
    """Get waiter's orders by name"""
    filters = {}
    if waiter_name:
        filters["waiter_name"] = waiter_name

    if status_filter:
        filters["status"] = status_filter
    else:
        filters["status"] = ["not in", ["Paid", "Cancelled"]]

    orders = frappe.get_all(
        "ServePOS Waiter Order",
        filters=filters,
        fields=["name", "waiter", "waiter_name", "table", "room", "order_type",
                "guests", "status", "notes", "creation", "pos_order_id"],
        order_by="creation desc",
        limit=50
    )

    # Fetch items for each order
    for order in orders:
        order["items"] = frappe.get_all(
            "ServePOS Waiter Order Item",
            filters={"parent": order["name"]},
            fields=["item_code", "item_name", "qty", "rate", "modifiers",
                    "modifier_total", "special_instructions"]
        )

    return orders


@frappe.whitelist()
def update_order_status(order_name, status):
    """Update waiter order status"""
    doc = frappe.get_doc("ServePOS Waiter Order", order_name)
    doc.status = status
    doc.save()
    return {"success": True, "status": doc.status}


@frappe.whitelist()
def add_items_to_order(order_name, items):
    """Add items to an existing waiter order (amendment)"""
    if isinstance(items, str):
        items = json.loads(items)

    doc = frappe.get_doc("ServePOS Waiter Order", order_name)

    if doc.status in ["Paid", "Cancelled"]:
        frappe.throw(_("Cannot modify a {0} order").format(doc.status))

    for item in items:
        doc.append("items", {
            "item_code": item.get("item_code"),
            "item_name": item.get("item_name"),
            "qty": flt(item.get("qty", 1)),
            "rate": flt(item.get("rate", 0)),
            "modifiers": item.get("modifiers"),
            "modifier_total": flt(item.get("modifier_total", 0)),
            "special_instructions": item.get("special_instructions"),
        })

    doc.save()
    return doc.as_dict()


@frappe.whitelist()
def get_pending_orders(branch=None, pos_profile=None):
    """Get pending waiter orders for the POS terminal to pick up"""
    filters = {"status": "Pending"}
    if branch:
        filters["branch"] = branch
    if pos_profile:
        filters["pos_profile"] = pos_profile

    orders = frappe.get_all(
        "ServePOS Waiter Order",
        filters=filters,
        fields=["name", "waiter", "waiter_name", "table", "room", "order_type",
                "guests", "status", "notes", "creation"],
        order_by="creation asc"
    )

    for order in orders:
        order["items"] = frappe.get_all(
            "ServePOS Waiter Order Item",
            filters={"parent": order["name"]},
            fields=["item_code", "item_name", "qty", "rate", "modifiers",
                    "modifier_total", "special_instructions"]
        )

    return orders


@frappe.whitelist()
def accept_order(order_name, pos_order_id=None):
    """Mark a waiter order as accepted by the POS terminal"""
    doc = frappe.get_doc("ServePOS Waiter Order", order_name)
    doc.status = "Accepted"
    if pos_order_id:
        doc.pos_order_id = pos_order_id
    doc.save()
    return {"success": True}
