"""
ServePOS Kitchen Order Ticket (KOT) API
Handles KOT generation, status updates, and real-time KDS communication
"""
import frappe
from frappe import _
from frappe.utils import now_datetime, cint


@frappe.whitelist()
def generate_kot(pos_invoice, doctype=None):
    """
    Generate KOTs for an invoice (POS Invoice or Sales Invoice).
    Groups items by kitchen station and creates separate KOTs for each station.

    Also creates Stock Entry (Manufacture) for items with BOM to produce
    finished goods stock BEFORE the invoice is submitted.
    """
    # Determine doctype - try Sales Invoice first, then POS Invoice
    if doctype:
        invoice = frappe.get_doc(doctype, pos_invoice)
    elif frappe.db.exists("Sales Invoice", pos_invoice):
        invoice = frappe.get_doc("Sales Invoice", pos_invoice)
    else:
        invoice = frappe.get_doc("POS Invoice", pos_invoice)

    # Check if KOT already generated
    if invoice.get("servepos_kot_generated"):
        return {"message": "KOT already generated", "kots": [], "stock_entries": []}

    # Get POS Profile settings
    pos_profile = frappe.get_doc("POS Profile", invoice.pos_profile)
    enable_kds = cint(pos_profile.get("enable_kds", 1))

    if not enable_kds:
        return {"message": "KDS not enabled for this POS Profile", "kots": []}

    # Group items by kitchen station
    station_items = {}

    for item in invoice.items:
        # Get kitchen station for item
        kitchen_station = frappe.db.get_value("Item", item.item_code, "servepos_kitchen_station")

        if not kitchen_station:
            # Try to find station by item group
            kitchen_station = get_station_by_item_group(item.item_code)

        if not kitchen_station:
            # Default to first active station
            kitchen_station = frappe.db.get_value(
                "ServePOS Kitchen Station",
                {"is_active": 1},
                "name",
                order_by="display_order"
            )

        if kitchen_station:
            if kitchen_station not in station_items:
                station_items[kitchen_station] = []

            station_items[kitchen_station].append({
                "item_code": item.item_code,
                "item_name": item.item_name,
                "qty": item.qty,
                "modifiers": item.get("servepos_modifiers") or "",
                "special_instructions": item.get("servepos_comment") or "",
                "pos_invoice_item": item.name
            })

    # Create KOTs for each station
    created_kots = []

    for station, items in station_items.items():
        kot = frappe.new_doc("ServePOS KOT")
        kot.invoice_type = invoice.doctype
        kot.pos_invoice = pos_invoice
        kot.kitchen_station = station
        kot.table = invoice.get("servepos_table")
        kot.status = "Pending"
        kot.order_time = now_datetime()

        for item_data in items:
            kot.append("items", item_data)

        kot.insert()
        created_kots.append(kot.name)

        # Publish real-time event for KDS
        frappe.publish_realtime(
            "new_kot",
            {
                "kot": kot.name,
                "station": station,
                "table": invoice.get("servepos_table"),
                "items": items,
                "order_time": str(kot.order_time)
            },
            room=f"kds_{station}"
        )

    # Mark invoice as KOT generated
    if created_kots:
        frappe.db.set_value(invoice.doctype, pos_invoice, "servepos_kot_generated", 1)

    frappe.db.commit()

    return {
        "message": f"Generated {len(created_kots)} KOT(s)",
        "kots": created_kots
    }


def get_station_by_item_group(item_code):
    """Find kitchen station by item's item group"""
    item_group = frappe.db.get_value("Item", item_code, "item_group")
    if not item_group:
        return None

    # Check each station's item groups
    stations = frappe.get_all(
        "ServePOS Kitchen Station",
        filters={"is_active": 1},
        fields=["name"],
        order_by="display_order"
    )

    for station in stations:
        station_groups = frappe.get_all(
            "ServePOS Station Item Group",
            filters={"parent": station.name},
            pluck="item_group"
        )
        if item_group in station_groups:
            return station.name

    return None


@frappe.whitelist()
def update_kot_status(kot_name, status):
    """Update KOT status and notify frontend"""
    if status not in ["Pending", "In Progress", "Ready", "Served", "Cancelled"]:
        frappe.throw(_("Invalid KOT status"))

    kot = frappe.get_doc("ServePOS KOT", kot_name)
    old_status = kot.status
    kot.status = status
    kot.save()

    # Update individual item statuses if marking whole KOT
    if status in ["Ready", "Served"]:
        for item in kot.items:
            item.status = status
        kot.save()

    # Publish real-time update
    frappe.publish_realtime(
        "kot_status_update",
        {
            "kot": kot_name,
            "old_status": old_status,
            "new_status": status,
            "station": kot.kitchen_station,
            "table": kot.table
        },
        room=f"kds_{kot.kitchen_station}"
    )

    # Also notify POS for the table
    if kot.table:
        frappe.publish_realtime(
            "kot_status_update",
            {
                "kot": kot_name,
                "old_status": old_status,
                "new_status": status,
                "station": kot.kitchen_station
            },
            room=f"pos_table_{kot.table}"
        )

    frappe.db.commit()
    return {"message": f"KOT status updated to {status}"}


@frappe.whitelist()
def update_kot_item_status(kot_name, item_name, status):
    """Update individual KOT item status"""
    if status not in ["Pending", "In Progress", "Ready", "Served"]:
        frappe.throw(_("Invalid item status"))

    kot = frappe.get_doc("ServePOS KOT", kot_name)

    for item in kot.items:
        if item.name == item_name:
            item.status = status
            break

    # Auto-update KOT status based on items
    all_ready = all(item.status == "Ready" for item in kot.items)
    all_served = all(item.status == "Served" for item in kot.items)
    any_in_progress = any(item.status == "In Progress" for item in kot.items)

    if all_served:
        kot.status = "Served"
    elif all_ready:
        kot.status = "Ready"
    elif any_in_progress:
        kot.status = "In Progress"

    kot.save()

    # Publish real-time update
    frappe.publish_realtime(
        "kot_item_status_update",
        {
            "kot": kot_name,
            "item": item_name,
            "status": status,
            "kot_status": kot.status,
            "station": kot.kitchen_station
        },
        room=f"kds_{kot.kitchen_station}"
    )

    frappe.db.commit()
    return {"message": f"Item status updated to {status}"}


@frappe.whitelist()
def get_kots_for_station(station=None, status_filter=None):
    """Get all KOTs for a kitchen station"""
    import json

    filters = {}

    # Only filter by station if provided
    if station:
        filters["kitchen_station"] = station

    if status_filter:
        # Handle JSON string from frontend
        if isinstance(status_filter, str):
            try:
                status_filter = json.loads(status_filter)
            except json.JSONDecodeError:
                status_filter = [status_filter]
        filters["status"] = ["in", status_filter]
    else:
        # Default: show all active orders (not served/cancelled)
        filters["status"] = ["in", ["Pending", "In Progress", "Ready"]]

    kots = frappe.get_all(
        "ServePOS KOT",
        filters=filters,
        fields=["name", "pos_invoice", "table", "status", "priority", "order_time", "notes"],
        order_by="order_time asc"
    )

    # Get items for each KOT
    for kot in kots:
        kot["items"] = frappe.get_all(
            "ServePOS KOT Item",
            filters={"parent": kot["name"]},
            fields=["name", "item_code", "item_name", "qty", "modifiers", "special_instructions", "status"]
        )
        # Get table name if exists
        if kot.get("table"):
            kot["table_name"] = frappe.db.get_value("ServePOS Table", kot["table"], "table_name")

    return kots


@frappe.whitelist()
def get_all_stations():
    """Get all active kitchen stations"""
    return frappe.get_all(
        "ServePOS Kitchen Station",
        filters={"is_active": 1},
        fields=["name", "station_name", "description", "display_order"],
        order_by="display_order"
    )


@frappe.whitelist()
def bump_kot(kot_name):
    """Mark KOT as ready (bump) - common KDS action"""
    return update_kot_status(kot_name, "Ready")


@frappe.whitelist()
def recall_kot(kot_name):
    """Recall a ready KOT back to in progress"""
    return update_kot_status(kot_name, "In Progress")


@frappe.whitelist()
def mark_served(kot_name):
    """Mark KOT as served"""
    return update_kot_status(kot_name, "Served")


def auto_generate_kot_on_submit(doc, method):
    """Hook: Auto generate KOT when POS Invoice is submitted"""
    # Check if KDS is enabled for this POS Profile
    pos_profile = frappe.get_doc("POS Profile", doc.pos_profile)
    auto_generate = cint(pos_profile.get("auto_generate_kot", 1))
    enable_kds = cint(pos_profile.get("enable_kds", 1))

    if not auto_generate or not enable_kds:
        return

    # Generate KOT
    result = generate_kot(doc.name)

    if result.get("kots"):
        frappe.msgprint(
            _("Generated {0} Kitchen Order Ticket(s)").format(len(result["kots"])),
            indicator="green"
        )
