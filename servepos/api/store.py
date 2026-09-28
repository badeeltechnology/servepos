"""
ServeStore APIs — Branch stock overview and request management.
"""
import frappe
from frappe.utils import today, add_days, now


def _get_settings():
    return frappe.get_single("ServePOS Store Settings")


def _get_item_filters(settings):
    """Return SQL conditions based on store settings item_filter."""
    if settings.item_filter == "All Items":
        return "AND i.disabled = 0"
    elif settings.item_filter == "Selected Groups":
        groups = [r.item_group for r in (settings.allowed_item_groups or [])]
        if not groups:
            return "AND 1=0"
        group_list = ", ".join(f"'{frappe.db.escape(g)}'" for g in groups)
        return f"AND i.disabled = 0 AND i.item_group IN ({group_list})"
    else:
        # Stock Items Only (default)
        return "AND i.disabled = 0 AND i.is_stock_item = 1"


@frappe.whitelist()
def get_store_settings():
    settings = _get_settings()
    return {
        "central_warehouse": settings.central_warehouse,
        "item_filter": settings.item_filter,
        "allowed_item_groups": [r.item_group for r in (settings.allowed_item_groups or [])],
        "default_required_days": settings.default_required_days or 3,
        "enable_low_stock_alerts": settings.enable_low_stock_alerts,
        "low_stock_threshold": settings.low_stock_threshold or 10,
    }


@frappe.whitelist()
def save_store_settings(central_warehouse, item_filter, allowed_item_groups=None, default_required_days=3, enable_low_stock_alerts=1, low_stock_threshold=10):
    import json
    if isinstance(allowed_item_groups, str):
        allowed_item_groups = json.loads(allowed_item_groups)

    doc = frappe.get_single("ServePOS Store Settings")
    doc.central_warehouse = central_warehouse
    doc.item_filter = item_filter
    doc.default_required_days = int(default_required_days)
    doc.enable_low_stock_alerts = int(enable_low_stock_alerts)
    doc.low_stock_threshold = float(low_stock_threshold)

    doc.allowed_item_groups = []
    for g in (allowed_item_groups or []):
        doc.append("allowed_item_groups", {"item_group": g})

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def get_branch_stock(warehouse, search=None, item_group=None):
    """Get current stock levels for a branch warehouse."""
    settings = _get_settings()
    item_filter = _get_item_filters(settings)
    central_wh = settings.central_warehouse

    conditions = ""
    if search:
        conditions += f" AND (i.item_name LIKE '%{frappe.db.escape(search)}%' OR i.item_code LIKE '%{frappe.db.escape(search)}%')"
    if item_group:
        conditions += f" AND i.item_group = '{frappe.db.escape(item_group)}'"

    items = frappe.db.sql(f"""
        SELECT
            i.name as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            i.image,
            COALESCE(bin_branch.actual_qty, 0) as branch_stock,
            COALESCE(bin_central.actual_qty, 0) as central_stock,
            COALESCE(rl.warehouse_reorder_level, {settings.low_stock_threshold or 10}) as reorder_level
        FROM `tabItem` i
        LEFT JOIN `tabBin` bin_branch
            ON bin_branch.item_code = i.name AND bin_branch.warehouse = %(warehouse)s
        LEFT JOIN `tabBin` bin_central
            ON bin_central.item_code = i.name AND bin_central.warehouse = %(central_wh)s
        LEFT JOIN `tabItem Reorder` rl
            ON rl.parent = i.name AND rl.warehouse = %(warehouse)s
        WHERE 1=1 {item_filter} {conditions}
        ORDER BY i.item_name ASC
        LIMIT 500
    """, {"warehouse": warehouse, "central_wh": central_wh}, as_dict=True)

    return items


@frappe.whitelist()
def get_item_groups():
    """Get item groups based on store settings filter."""
    settings = _get_settings()

    if settings.item_filter == "Selected Groups":
        return [r.item_group for r in (settings.allowed_item_groups or [])]
    elif settings.item_filter == "Stock Items Only":
        return frappe.db.sql_list("""
            SELECT DISTINCT i.item_group
            FROM `tabItem` i
            WHERE i.disabled = 0 AND i.is_stock_item = 1
            ORDER BY i.item_group
        """)
    else:
        return frappe.db.sql_list("""
            SELECT DISTINCT i.item_group
            FROM `tabItem` i
            WHERE i.disabled = 0
            ORDER BY i.item_group
        """)


@frappe.whitelist()
def search_items(search, warehouse=None):
    """Search items for the request form."""
    settings = _get_settings()
    item_filter = _get_item_filters(settings)
    central_wh = settings.central_warehouse

    items = frappe.db.sql(f"""
        SELECT
            i.name as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            COALESCE(bin_branch.actual_qty, 0) as branch_stock,
            COALESCE(bin_central.actual_qty, 0) as central_stock
        FROM `tabItem` i
        LEFT JOIN `tabBin` bin_branch
            ON bin_branch.item_code = i.name AND bin_branch.warehouse = %(warehouse)s
        LEFT JOIN `tabBin` bin_central
            ON bin_central.item_code = i.name AND bin_central.warehouse = %(central_wh)s
        WHERE 1=1 {item_filter}
            AND (i.item_name LIKE %(search)s OR i.item_code LIKE %(search)s)
        ORDER BY i.item_name ASC
        LIMIT 20
    """, {
        "warehouse": warehouse or "",
        "central_wh": central_wh or "",
        "search": f"%{search}%",
    }, as_dict=True)

    return items


@frappe.whitelist()
def create_branch_request(branch, warehouse, required_by, items, notes=None):
    """Create a new Branch Request and submit it."""
    import json
    if isinstance(items, str):
        items = json.loads(items)

    doc = frappe.get_doc({
        "doctype": "ServePOS Branch Request",
        "branch": branch,
        "warehouse": warehouse,
        "request_date": today(),
        "required_by": required_by,
        "notes": notes or "",
        "items": [
            {
                "item_code": item["item_code"],
                "qty": item["qty"],
                "uom": item.get("uom") or frappe.db.get_value("Item", item["item_code"], "stock_uom"),
                "notes": item.get("notes", ""),
            }
            for item in items
        ],
    })
    doc.insert(ignore_permissions=True)
    doc.submit()

    return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def get_my_requests(branch=None, status=None):
    """Get requests for the current user's branch."""
    filters = {"docstatus": ["!=", 2]}
    if branch:
        filters["branch"] = branch
    if status:
        filters["status"] = status

    requests = frappe.get_all(
        "ServePOS Branch Request",
        filters=filters,
        fields=["name", "branch", "warehouse", "request_date", "required_by", "status", "notes", "processed_by", "processed_on", "creation", "owner"],
        order_by="creation desc",
        limit=100,
    )

    for req in requests:
        req["items"] = frappe.get_all(
            "ServePOS Branch Request Item",
            filters={"parent": req["name"]},
            fields=["item_code", "item_name", "qty", "uom", "status", "fulfilled_qty", "notes"],
        )
        req["item_count"] = len(req["items"])

    return requests


@frappe.whitelist()
def get_request_detail(name):
    """Get full details of a branch request."""
    doc = frappe.get_doc("ServePOS Branch Request", name)

    settings = _get_settings()
    central_wh = settings.central_warehouse

    items = []
    for item in doc.items:
        branch_stock = frappe.db.get_value("Bin", {"item_code": item.item_code, "warehouse": doc.warehouse}, "actual_qty") or 0
        central_stock = frappe.db.get_value("Bin", {"item_code": item.item_code, "warehouse": central_wh}, "actual_qty") or 0 if central_wh else 0

        items.append({
            "name": item.name,
            "item_code": item.item_code,
            "item_name": item.item_name,
            "item_group": item.item_group,
            "qty": item.qty,
            "uom": item.uom,
            "status": item.status,
            "fulfilled_qty": item.fulfilled_qty,
            "reference_type": item.reference_type,
            "reference_name": item.reference_name,
            "notes": item.notes,
            "current_stock": branch_stock,
            "central_stock": central_stock,
        })

    return {
        "name": doc.name,
        "branch": doc.branch,
        "warehouse": doc.warehouse,
        "request_date": doc.request_date,
        "required_by": doc.required_by,
        "status": doc.status,
        "notes": doc.notes,
        "docstatus": doc.docstatus,
        "processed_by": doc.processed_by,
        "processed_on": doc.processed_on,
        "owner": doc.owner,
        "creation": doc.creation,
        "items": items,
    }


@frappe.whitelist()
def get_all_pending_requests():
    """Manager view: all pending/partially fulfilled requests across branches."""
    requests = frappe.get_all(
        "ServePOS Branch Request",
        filters={"docstatus": 1, "status": ["in", ["Pending", "Partially Fulfilled"]]},
        fields=["name", "branch", "warehouse", "request_date", "required_by", "status", "notes", "owner", "creation"],
        order_by="required_by asc",
    )

    for req in requests:
        req["items"] = frappe.get_all(
            "ServePOS Branch Request Item",
            filters={"parent": req["name"]},
            fields=["name", "item_code", "item_name", "item_group", "qty", "uom", "status", "fulfilled_qty", "notes"],
        )
        req["item_count"] = len(req["items"])
        req["pending_count"] = sum(1 for i in req["items"] if i["status"] == "Pending")

    return requests


@frappe.whitelist()
def get_consolidated_items():
    """Manager view: all pending items consolidated across branches."""
    settings = _get_settings()
    central_wh = settings.central_warehouse

    items = frappe.db.sql("""
        SELECT
            bri.item_code,
            bri.item_name,
            bri.item_group,
            bri.uom,
            SUM(bri.qty) as total_qty,
            SUM(bri.fulfilled_qty) as total_fulfilled,
            COUNT(DISTINCT br.branch) as branch_count,
            GROUP_CONCAT(DISTINCT br.branch) as branches,
            GROUP_CONCAT(
                CONCAT(br.branch, ':', bri.qty, ':', bri.name, ':', br.name)
            ) as branch_details
        FROM `tabServePOS Branch Request Item` bri
        JOIN `tabServePOS Branch Request` br ON br.name = bri.parent
        WHERE br.docstatus = 1
            AND br.status IN ('Pending', 'Partially Fulfilled')
            AND bri.status = 'Pending'
        GROUP BY bri.item_code, bri.item_name, bri.item_group, bri.uom
        ORDER BY bri.item_name
    """, as_dict=True)

    # Add central stock info
    for item in items:
        item["central_stock"] = frappe.db.get_value(
            "Bin", {"item_code": item["item_code"], "warehouse": central_wh}, "actual_qty"
        ) or 0 if central_wh else 0

        # Parse branch details
        details = []
        if item.get("branch_details"):
            for part in item["branch_details"].split(","):
                segments = part.split(":")
                if len(segments) == 4:
                    details.append({
                        "branch": segments[0],
                        "qty": float(segments[1]),
                        "item_row": segments[2],
                        "request": segments[3],
                    })
        item["branch_breakdown"] = details

    return items


@frappe.whitelist()
def process_request_items(actions):
    """
    Process branch request items. Each action specifies what to do with an item.
    actions: [{"item_row": "...", "request": "...", "action": "transfer|purchase", "qty": N}]
    """
    import json
    if isinstance(actions, str):
        actions = json.loads(actions)

    settings = _get_settings()
    central_wh = settings.central_warehouse

    transfer_items = {}  # group by request (target warehouse)
    purchase_items = []

    for act in actions:
        item_row = frappe.get_doc("ServePOS Branch Request Item", act["item_row"])
        request = frappe.get_doc("ServePOS Branch Request", act["request"])
        qty = float(act.get("qty", item_row.qty))

        if act["action"] == "transfer":
            key = request.name
            if key not in transfer_items:
                transfer_items[key] = {
                    "target_warehouse": request.warehouse,
                    "branch": request.branch,
                    "items": [],
                }
            transfer_items[key]["items"].append({
                "item_code": item_row.item_code,
                "qty": qty,
                "uom": item_row.uom,
                "item_row": act["item_row"],
            })

            # Update item status
            frappe.db.set_value("ServePOS Branch Request Item", act["item_row"], {
                "status": "To Transfer",
                "fulfilled_qty": qty,
            })

        elif act["action"] == "purchase":
            purchase_items.append({
                "item_code": item_row.item_code,
                "qty": qty,
                "uom": item_row.uom,
                "warehouse": request.warehouse,
                "item_row": act["item_row"],
                "request": act["request"],
            })

            frappe.db.set_value("ServePOS Branch Request Item", act["item_row"], {
                "status": "To Purchase",
            })

    results = {"stock_entries": [], "material_requests": []}

    # Create Stock Entries for transfers
    for req_name, data in transfer_items.items():
        se = frappe.get_doc({
            "doctype": "Stock Entry",
            "stock_entry_type": "Material Transfer",
            "items": [
                {
                    "item_code": item["item_code"],
                    "qty": item["qty"],
                    "uom": item["uom"],
                    "s_warehouse": central_wh,
                    "t_warehouse": data["target_warehouse"],
                }
                for item in data["items"]
            ],
        })
        se.insert(ignore_permissions=True)
        results["stock_entries"].append(se.name)

        # Link SE back to branch request items
        for item in data["items"]:
            frappe.db.set_value("ServePOS Branch Request Item", item["item_row"], {
                "reference_type": "Stock Entry",
                "reference_name": se.name,
            })

    # Create Material Request for purchases
    if purchase_items:
        mr = frappe.get_doc({
            "doctype": "Material Request",
            "material_request_type": "Purchase",
            "transaction_date": today(),
            "schedule_date": add_days(today(), settings.default_required_days or 3),
            "items": [
                {
                    "item_code": item["item_code"],
                    "qty": item["qty"],
                    "uom": item["uom"],
                    "warehouse": item["warehouse"],
                    "schedule_date": add_days(today(), settings.default_required_days or 3),
                }
                for item in purchase_items
            ],
        })
        mr.insert(ignore_permissions=True)
        results["material_requests"].append(mr.name)

        for item in purchase_items:
            frappe.db.set_value("ServePOS Branch Request Item", item["item_row"], {
                "reference_type": "Material Request",
                "reference_name": mr.name,
            })

    # Update parent request statuses
    updated_requests = set()
    for act in actions:
        updated_requests.add(act["request"])

    for req_name in updated_requests:
        req = frappe.get_doc("ServePOS Branch Request", req_name)
        # Mark processed
        frappe.db.set_value("ServePOS Branch Request", req_name, {
            "processed_by": frappe.session.user,
            "processed_on": now(),
        })
        req.reload()
        req.update_status()

    frappe.db.commit()

    return results


@frappe.whitelist()
def cancel_request(name):
    """Cancel a branch request."""
    doc = frappe.get_doc("ServePOS Branch Request", name)
    doc.status = "Cancelled"
    doc.cancel()
    return {"name": doc.name, "status": "Cancelled"}
