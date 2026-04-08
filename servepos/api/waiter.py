"""
ServePOS Waiter API
Handles waiter order creation and management from the mobile app
"""
import frappe
from frappe import _
from frappe.utils import now_datetime, flt, cint
import json


# Legacy get_waiters removed — use servepos.api.registry.get_waiters(pos_profile).


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
def create_order(waiter_name=None, order_type="Dine In", table=None, room=None, guests=1, notes=None, items=None, pos_profile=None, branch=None):
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

    # Resolve POS Profile strictly from the waiter's logged-in user.
    # Priority:
    #   1. explicit `pos_profile` arg (must belong to the user)
    #   2. user's `default` POS Profile
    #   3. the only POS Profile assigned to the user (if exactly one)
    # Branch is always derived from the chosen POS Profile — never from the
    # table (table numbers can collide across branches).
    waiter_user = frappe.session.user
    user_profiles = []
    if waiter_user and waiter_user not in ("Guest", "Administrator"):
        ppu = frappe.qb.DocType("POS Profile User")
        pp = frappe.qb.DocType("POS Profile")
        user_profiles = (
            frappe.qb.from_(ppu)
            .inner_join(pp).on(pp.name == ppu.parent)
            .select(pp.name, pp.branch, ppu.default)
            .where(ppu.user == waiter_user)
            .where(pp.disabled == 0)
            .run(as_dict=True)
        ) or []

    if pos_profile:
        if not any(p.name == pos_profile for p in user_profiles):
            frappe.throw(_("POS Profile {0} is not assigned to user {1}").format(pos_profile, waiter_user))
        doc.pos_profile = pos_profile
    elif user_profiles:
        pick = next((p for p in user_profiles if p.get("default")), None)
        if not pick and len(user_profiles) == 1:
            pick = user_profiles[0]
        if not pick:
            frappe.throw(_("User {0} is assigned to multiple POS Profiles; set one as default or pass pos_profile explicitly").format(waiter_user))
        doc.pos_profile = pick.name
    else:
        frappe.throw(_("No POS Profile is assigned to user {0}").format(waiter_user))

    # Branch always comes from the chosen POS Profile (explicit arg only honored if it matches)
    profile_branch = frappe.db.get_value("POS Profile", doc.pos_profile, "branch")
    if branch and branch != profile_branch:
        frappe.throw(_("Branch {0} does not match POS Profile {1}").format(branch, doc.pos_profile))
    doc.branch = profile_branch

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
def get_my_orders(waiter_name=None, status_filter=None, days=1):
    """Get waiter's orders by name.
    `days` limits results to orders created within the last N days (default: 1 = today).
    Pass days=0 to disable the date filter."""
    filters = {}
    if waiter_name:
        filters["waiter_name"] = waiter_name

    if status_filter:
        filters["status"] = status_filter
    else:
        filters["status"] = ["not in", ["Paid", "Cancelled"]]

    # Date filter — default: only today's orders
    try:
        days_int = int(days)
    except (TypeError, ValueError):
        days_int = 1
    if days_int > 0:
        from frappe.utils import add_days, today
        cutoff = add_days(today(), -(days_int - 1))
        filters["creation"] = [">=", cutoff]

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


# Legacy get_pending_orders / get_active_orders removed —
# use servepos.api.registry.get_active_orders(pos_profile, statuses=...).


@frappe.whitelist()
def accept_order(order_name, pos_order_id=None):
    """Mark a waiter order as accepted by the POS terminal"""
    doc = frappe.get_doc("ServePOS Waiter Order", order_name)
    doc.status = "Accepted"
    if pos_order_id:
        doc.pos_order_id = pos_order_id
    doc.save()
    return {"success": True}


# Status mapping: Desktop POS status → ERPNext Waiter Order status
POS_TO_WAITER_STATUS = {
    "Open": "Accepted",
    "Preparing": "In Kitchen",
    "Ready to Serve": "Ready",
    "Invoiced": "Served",
    "Completed": "Paid",
}


@frappe.whitelist()
def update_order_status_by_pos(pos_order_id, status):
    """Update waiter order status from the Desktop POS (coordinator/cashier).
    Called when coordinator marks Ready to Serve, etc.
    Maps POS statuses to waiter order statuses.
    Accepts either pos_order_id (local UUID) or the waiter order name (WO-YYYY-#####)."""

    mapped_status = POS_TO_WAITER_STATUS.get(status)
    if not mapped_status:
        return {"success": False, "error": f"Unknown status: {status}"}

    # Try by pos_order_id first
    orders = frappe.get_all(
        "ServePOS Waiter Order",
        filters={"pos_order_id": pos_order_id},
        fields=["name"],
        limit=1,
    )
    # Fallback: if the passed id looks like a waiter order name, use it directly
    if not orders and pos_order_id and frappe.db.exists("ServePOS Waiter Order", pos_order_id):
        waiter_order_name = pos_order_id
    elif orders:
        waiter_order_name = orders[0].name
    else:
        return {"success": False, "error": "No waiter order linked to this POS order"}

    doc = frappe.get_doc("ServePOS Waiter Order", waiter_order_name)
    doc.status = mapped_status
    doc.save()

    return {"success": True, "waiter_order": doc.name, "status": mapped_status}
