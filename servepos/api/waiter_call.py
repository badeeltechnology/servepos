"""
ServePOS Waiter Call API
Authenticated endpoints for waiters to accept and attend guest calls.
"""
import frappe
from frappe import _
from frappe.utils import now_datetime


@frappe.whitelist()
def get_active_calls(pos_profile=None):
    """Get all Pending and Accepted calls, optionally filtered by POS Profile.
    Used by the waiter app Calls tab."""
    filters = {"status": ["in", ["Pending", "Accepted"]]}
    if pos_profile:
        filters["pos_profile"] = pos_profile

    calls = frappe.get_all(
        "ServePOS Waiter Call",
        filters=filters,
        fields=[
            "name", "table", "pos_profile", "status",
            "call_time", "guest_name", "notes",
            "accepted_by", "accepted_at",
        ],
        order_by="call_time desc",
        limit=50,
    )

    # Enrich with table display name and restaurant name
    for call in calls:
        call["table_name"] = frappe.db.get_value(
            "ServePOS Table", call["table"], "table_name"
        ) or call["table"]
        call["room"] = frappe.db.get_value(
            "ServePOS Table", call["table"], "room"
        ) or ""
        if call["room"]:
            call["room_name"] = frappe.db.get_value(
                "ServePOS Room", call["room"], "room_name"
            ) or call["room"]
        else:
            call["room_name"] = ""
        call["restaurant_name"] = frappe.db.get_value(
            "POS Profile", call["pos_profile"], "servepos_restaurant_display_name"
        ) or call["pos_profile"]
        if call.get("accepted_by"):
            call["accepted_by_name"] = frappe.db.get_value(
                "ServePOS Waiter", call["accepted_by"], "waiter_name"
            ) or call["accepted_by"]

    return calls


@frappe.whitelist()
def accept_waiter_call(call_name, waiter_name):
    """Atomic accept — first waiter wins.
    Uses a conditional update to prevent race conditions."""
    if not call_name or not waiter_name:
        frappe.throw(_("Call name and waiter name are required"))

    # Validate waiter exists and is active
    waiter = frappe.db.get_value(
        "ServePOS Waiter", {"waiter_name": waiter_name, "is_active": 1},
        "name",
    )
    if not waiter:
        frappe.throw(_("Waiter not found or inactive"))

    # Atomic update: only succeeds if status is still Pending
    now = now_datetime()
    updated = frappe.db.sql("""
        UPDATE `tabServePOS Waiter Call`
        SET status = 'Accepted',
            accepted_by = %(waiter)s,
            accepted_at = %(now)s,
            modified = %(now)s,
            modified_by = %(user)s
        WHERE name = %(call_name)s
          AND status = 'Pending'
    """, {
        "waiter": waiter_name,
        "now": now,
        "user": frappe.session.user,
        "call_name": call_name,
    })
    frappe.db.commit()

    # Check if we actually updated a row
    current_status = frappe.db.get_value("ServePOS Waiter Call", call_name, "status")
    if current_status != "Accepted" or frappe.db.get_value("ServePOS Waiter Call", call_name, "accepted_by") != waiter_name:
        # Someone else accepted first
        accepted_by = frappe.db.get_value("ServePOS Waiter Call", call_name, "accepted_by")
        return {
            "success": False,
            "error": _("Already accepted by {0}").format(accepted_by or "another waiter"),
        }

    # Get call details for notifications
    call = frappe.db.get_value(
        "ServePOS Waiter Call", call_name,
        ["table", "pos_profile", "guest_name"],
        as_dict=True,
    )
    table_name = frappe.db.get_value("ServePOS Table", call.table, "table_name") or call.table

    # Notify other waiters via FCM that this call is taken
    try:
        from servepos.api.fcm import send_call_accepted_push
        send_call_accepted_push(call_name, waiter_name, call.pos_profile)
    except Exception:
        pass

    # Notify via realtime (for web dashboard and guest page)
    frappe.publish_realtime(
        "servepos_waiter_call_update",
        {
            "call_name": call_name,
            "status": "Accepted",
            "accepted_by": waiter_name,
            "table": table_name,
        },
        doctype="ServePOS Waiter Call",
    )

    return {
        "success": True,
        "call_name": call_name,
        "status": "Accepted",
        "table": call.table,
        "table_name": table_name,
        "guest_name": call.guest_name or "",
    }


@frappe.whitelist()
def mark_call_attended(call_name, waiter_name):
    """Mark that the waiter has met the guest at the seat."""
    if not call_name or not waiter_name:
        frappe.throw(_("Call name and waiter name are required"))

    call = frappe.db.get_value(
        "ServePOS Waiter Call", call_name,
        ["status", "accepted_by"],
        as_dict=True,
    )
    if not call:
        frappe.throw(_("Call not found"), frappe.DoesNotExistError)

    if call.status != "Accepted":
        frappe.throw(_("Only accepted calls can be marked as attended"))

    if call.accepted_by != waiter_name:
        frappe.throw(_("Only the waiter who accepted can mark this call as attended"))

    now = now_datetime()
    frappe.db.set_value("ServePOS Waiter Call", call_name, {
        "status": "Attended",
        "attended_at": now,
    })
    frappe.db.commit()

    # Notify via realtime
    frappe.publish_realtime(
        "servepos_waiter_call_update",
        {"call_name": call_name, "status": "Attended"},
        doctype="ServePOS Waiter Call",
    )

    return {"success": True, "status": "Attended"}


@frappe.whitelist()
def register_fcm_token(waiter_name, fcm_token):
    """Store or update the FCM device token for push notifications."""
    if not waiter_name or not fcm_token:
        frappe.throw(_("Waiter name and FCM token are required"))

    if not frappe.db.exists("ServePOS Waiter", waiter_name):
        frappe.throw(_("Waiter not found"), frappe.DoesNotExistError)

    frappe.db.set_value("ServePOS Waiter", waiter_name, "fcm_token", fcm_token)
    frappe.db.commit()

    return {"success": True}


@frappe.whitelist()
def get_my_active_calls(waiter_name):
    """Get calls accepted by this waiter that are still active (Accepted status)."""
    if not waiter_name:
        frappe.throw(_("Waiter name is required"))

    calls = frappe.get_all(
        "ServePOS Waiter Call",
        filters={
            "accepted_by": waiter_name,
            "status": "Accepted",
        },
        fields=[
            "name", "table", "pos_profile", "status",
            "call_time", "guest_name", "notes", "accepted_at",
        ],
        order_by="accepted_at desc",
    )

    for call in calls:
        call["table_name"] = frappe.db.get_value(
            "ServePOS Table", call["table"], "table_name"
        ) or call["table"]
        call["room"] = frappe.db.get_value(
            "ServePOS Table", call["table"], "room"
        ) or ""
        if call["room"]:
            call["room_name"] = frappe.db.get_value(
                "ServePOS Room", call["room"], "room_name"
            ) or call["room"]
        else:
            call["room_name"] = ""
        call["restaurant_name"] = frappe.db.get_value(
            "POS Profile", call["pos_profile"], "servepos_restaurant_display_name"
        ) or call["pos_profile"]

    return calls


@frappe.whitelist()
def get_call_history(waiter_name=None, pos_profile=None, days=1):
    """Get recent call history for reporting / waiter's past calls."""
    filters = {"status": ["in", ["Attended", "Expired", "Cancelled"]]}

    if waiter_name:
        filters["accepted_by"] = waiter_name
    if pos_profile:
        filters["pos_profile"] = pos_profile

    if days:
        from frappe.utils import add_days, today
        try:
            days_int = int(days)
        except (TypeError, ValueError):
            days_int = 1
        if days_int > 0:
            cutoff = add_days(today(), -(days_int - 1))
            filters["call_time"] = [">=", cutoff]

    calls = frappe.get_all(
        "ServePOS Waiter Call",
        filters=filters,
        fields=[
            "name", "table", "pos_profile", "status",
            "call_time", "guest_name", "accepted_by",
            "accepted_at", "attended_at",
        ],
        order_by="call_time desc",
        limit=100,
    )

    for call in calls:
        call["table_name"] = frappe.db.get_value(
            "ServePOS Table", call["table"], "table_name"
        ) or call["table"]
        call["restaurant_name"] = frappe.db.get_value(
            "POS Profile", call["pos_profile"], "servepos_restaurant_display_name"
        ) or call["pos_profile"]
        if call.get("accepted_by"):
            call["accepted_by_name"] = frappe.db.get_value(
                "ServePOS Waiter", call["accepted_by"], "waiter_name"
            ) or call["accepted_by"]

    return calls
