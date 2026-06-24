"""
ServePOS Guest API
Public endpoints (allow_guest=True) for the QR call-waiter flow.
Guests scan a QR code on their seat, view restaurant menus, and call a waiter.
"""
import frappe
from frappe import _
from frappe.utils import now_datetime, add_to_date, time_diff_in_seconds
import uuid


# --- Configuration ---
SESSION_TOKEN_EXPIRY_HOURS = 2
COOLDOWN_SECONDS = 300  # 5 minutes after Attended before same seat can call again
MAX_CALLS_PER_SEAT_PER_HOUR = 3
CALL_EXPIRY_MINUTES = 10  # Pending calls auto-expire after this


@frappe.whitelist(allow_guest=True)
def get_guest_session(seat_code):
    """Create or return a session token for this seat.
    Token is valid for SESSION_TOKEN_EXPIRY_HOURS hours.
    Returns seat info + available restaurants."""
    if not seat_code:
        frappe.throw(_("Seat code is required"), frappe.ValidationError)

    # Validate seat exists
    if not frappe.db.exists("ServePOS Table", seat_code):
        frappe.throw(_("Invalid seat code"), frappe.ValidationError)

    table = frappe.db.get_value(
        "ServePOS Table", seat_code,
        ["table_name", "room", "is_active"], as_dict=True
    )
    if not table or not table.is_active:
        frappe.throw(_("This seat is currently not available"), frappe.ValidationError)

    room_name = ""
    if table.room:
        room_name = frappe.db.get_value("ServePOS Room", table.room, "room_name") or ""

    # Generate session token
    token = str(uuid.uuid4())
    expires_at = add_to_date(now_datetime(), hours=SESSION_TOKEN_EXPIRY_HOURS)

    # Store token in cache (lightweight, no doctype needed)
    cache_key = f"servepos_guest_token:{token}"
    frappe.cache.set_value(cache_key, {
        "seat_code": seat_code,
        "expires_at": str(expires_at),
    }, expires_in_sec=SESSION_TOKEN_EXPIRY_HOURS * 3600)

    # Get restaurants
    restaurants = _get_restaurants_for_guest()

    return {
        "token": token,
        "seat": {
            "name": seat_code,
            "table_name": table.table_name,
            "room": room_name,
        },
        "restaurants": restaurants,
    }


@frappe.whitelist(allow_guest=True)
def get_restaurants_for_seat(seat_code):
    """Get all restaurants (POS Profiles) with guest calling enabled.
    Returns restaurant name, logo, description, and menu images."""
    if not seat_code:
        frappe.throw(_("Seat code is required"), frappe.ValidationError)

    if not frappe.db.exists("ServePOS Table", seat_code):
        frappe.throw(_("Invalid seat code"), frappe.ValidationError)

    return _get_restaurants_for_guest()


def _get_restaurants_for_guest():
    """Internal helper to fetch restaurants with guest calling enabled."""
    profiles = frappe.get_all(
        "POS Profile",
        filters={"disabled": 0},
        fields=[
            "name",
            "servepos_enable_guest_calling",
            "servepos_restaurant_display_name",
            "servepos_restaurant_description",
            "servepos_restaurant_logo",
            "servepos_venue_name",
            "servepos_venue_logo",
        ],
    )

    restaurants = []
    for p in profiles:
        if not p.get("servepos_enable_guest_calling"):
            continue

        # Fetch menu images
        menu_images = frappe.get_all(
            "ServePOS Menu Image",
            filters={"parenttype": "POS Profile", "parent": p.name},
            fields=["image", "caption", "display_order"],
            order_by="display_order asc",
        )

        restaurants.append({
            "pos_profile": p.name,
            "display_name": p.servepos_restaurant_display_name or p.name,
            "description": p.servepos_restaurant_description or "",
            "logo": p.servepos_restaurant_logo or "",
            "venue_name": p.servepos_venue_name or "",
            "venue_logo": p.servepos_venue_logo or "",
            "menu_images": menu_images,
        })

    return restaurants


@frappe.whitelist(allow_guest=True)
def create_waiter_call(seat_code, pos_profile, token, guest_name=None, notes=None):
    """Create a waiter call request from a guest.
    Validates token, checks for active calls, enforces cooldown and rate limits."""
    if not seat_code or not pos_profile or not token:
        frappe.throw(_("Seat code, restaurant, and token are required"), frappe.ValidationError)

    # 1. Validate token
    _validate_token(token, seat_code)

    # 2. Validate seat exists and is active
    if not frappe.db.exists("ServePOS Table", seat_code):
        frappe.throw(_("Invalid seat"), frappe.ValidationError)

    table_active = frappe.db.get_value("ServePOS Table", seat_code, "is_active")
    if not table_active:
        frappe.throw(_("This seat is currently not available"), frappe.ValidationError)

    # 3. Validate restaurant has guest calling enabled
    enabled = frappe.db.get_value("POS Profile", pos_profile, "servepos_enable_guest_calling")
    if not enabled:
        frappe.throw(_("This restaurant does not support guest calling"), frappe.ValidationError)

    # 4. Check no active call for this seat + restaurant
    active_call = frappe.db.exists("ServePOS Waiter Call", {
        "table": seat_code,
        "pos_profile": pos_profile,
        "status": ["in", ["Pending", "Accepted"]],
    })
    if active_call:
        frappe.throw(_("There is already an active call for this seat. Please wait for the waiter."), frappe.ValidationError)

    # 5. Check cooldown — last Attended call for this seat
    last_attended = frappe.get_all(
        "ServePOS Waiter Call",
        filters={
            "table": seat_code,
            "pos_profile": pos_profile,
            "status": "Attended",
        },
        fields=["attended_at"],
        order_by="attended_at desc",
        limit=1,
    )
    if last_attended and last_attended[0].attended_at:
        elapsed = time_diff_in_seconds(now_datetime(), last_attended[0].attended_at)
        if elapsed < COOLDOWN_SECONDS:
            remaining = int(COOLDOWN_SECONDS - elapsed)
            frappe.throw(
                _("Please wait {0} seconds before calling again").format(remaining),
                frappe.ValidationError,
            )

    # 6. Rate limit — max calls per seat per hour
    one_hour_ago = add_to_date(now_datetime(), hours=-1)
    recent_count = frappe.db.count("ServePOS Waiter Call", {
        "table": seat_code,
        "call_time": [">=", one_hour_ago],
    })
    if recent_count >= MAX_CALLS_PER_SEAT_PER_HOUR:
        frappe.throw(_("Too many calls from this seat. Please try again later."), frappe.ValidationError)

    # 7. Create the call
    call = frappe.new_doc("ServePOS Waiter Call")
    call.table = seat_code
    call.pos_profile = pos_profile
    call.status = "Pending"
    call.call_time = now_datetime()
    call.guest_name = guest_name or ""
    call.guest_token = token
    call.notes = notes or ""
    call.insert(ignore_permissions=True)
    frappe.db.commit()

    # 8. Send FCM push notification to waiters
    try:
        from servepos.api.fcm import send_push_to_waiters
        send_push_to_waiters(pos_profile, {
            "name": call.name,
            "table": seat_code,
            "guest_name": guest_name or "",
        })
    except Exception:
        frappe.logger().warning("FCM push failed, continuing without push notification")

    # 9. Trigger real-time notification for web dashboard
    table_name = frappe.db.get_value("ServePOS Table", seat_code, "table_name") or seat_code
    frappe.publish_realtime(
        "servepos_waiter_call",
        {
            "call_name": call.name,
            "seat": table_name,
            "pos_profile": pos_profile,
            "guest_name": guest_name or "",
            "status": "Pending",
        },
        doctype="ServePOS Waiter Call",
    )

    return {
        "success": True,
        "call_name": call.name,
        "status": "Pending",
        "message": _("Waiter has been called. Please wait."),
    }


@frappe.whitelist(allow_guest=True)
def get_call_status(call_name, token):
    """Guest polls this to check if a waiter has accepted their call."""
    if not call_name or not token:
        frappe.throw(_("Call name and token are required"), frappe.ValidationError)

    call = frappe.db.get_value(
        "ServePOS Waiter Call", call_name,
        ["status", "accepted_by", "guest_token", "table"],
        as_dict=True,
    )
    if not call:
        frappe.throw(_("Call not found"), frappe.DoesNotExistError)

    # Verify token matches
    if call.guest_token != token:
        frappe.throw(_("Invalid token"), frappe.ValidationError)

    result = {
        "status": call.status,
        "call_name": call_name,
    }

    if call.accepted_by:
        waiter_name = frappe.db.get_value("ServePOS Waiter", call.accepted_by, "waiter_name")
        result["waiter_name"] = waiter_name or call.accepted_by

    return result


@frappe.whitelist(allow_guest=True)
def cancel_waiter_call(call_name, token):
    """Guest cancels their own call."""
    if not call_name or not token:
        frappe.throw(_("Call name and token are required"), frappe.ValidationError)

    call = frappe.db.get_value(
        "ServePOS Waiter Call", call_name,
        ["status", "guest_token"],
        as_dict=True,
    )
    if not call:
        frappe.throw(_("Call not found"), frappe.DoesNotExistError)

    if call.guest_token != token:
        frappe.throw(_("Invalid token"), frappe.ValidationError)

    if call.status not in ("Pending",):
        frappe.throw(_("Only pending calls can be cancelled"), frappe.ValidationError)

    frappe.db.set_value("ServePOS Waiter Call", call_name, "status", "Cancelled")
    frappe.db.commit()

    frappe.publish_realtime(
        "servepos_waiter_call_update",
        {"call_name": call_name, "status": "Cancelled"},
        doctype="ServePOS Waiter Call",
    )

    return {"success": True, "status": "Cancelled"}


def _validate_token(token, seat_code):
    """Validate guest session token."""
    cache_key = f"servepos_guest_token:{token}"
    session = frappe.cache.get_value(cache_key)

    if not session:
        frappe.throw(
            _("Your session has expired. Please scan the QR code again."),
            frappe.ValidationError,
        )

    if session.get("seat_code") != seat_code:
        frappe.throw(_("Invalid session for this seat"), frappe.ValidationError)


def expire_stale_calls():
    """Scheduled task: expire Pending calls older than CALL_EXPIRY_MINUTES.
    Called by scheduler via hooks.py."""
    cutoff = add_to_date(now_datetime(), minutes=-CALL_EXPIRY_MINUTES)
    stale_calls = frappe.get_all(
        "ServePOS Waiter Call",
        filters={
            "status": "Pending",
            "call_time": ["<", cutoff],
        },
        pluck="name",
    )
    for call_name in stale_calls:
        frappe.db.set_value("ServePOS Waiter Call", call_name, "status", "Expired")

    if stale_calls:
        frappe.db.commit()
        frappe.logger().info(f"Expired {len(stale_calls)} stale waiter calls")
