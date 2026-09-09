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


# --- Guest Menu & Ordering ---

@frappe.whitelist(allow_guest=True)
def get_guest_menu(seat_code, pos_profile):
    """Return item groups and items for a restaurant, visible to guests.
    No auth required — only returns publicly safe data (name, price, image)."""
    if not seat_code or not pos_profile:
        frappe.throw(_("Seat code and restaurant are required"), frappe.ValidationError)

    if not frappe.db.exists("ServePOS Table", seat_code):
        frappe.throw(_("Invalid seat code"), frappe.ValidationError)

    # Verify restaurant has guest calling enabled (same gate as call-waiter)
    enabled = frappe.db.get_value("POS Profile", pos_profile, "servepos_enable_guest_calling")
    if not enabled:
        frappe.throw(_("Menu not available for this restaurant"), frappe.ValidationError)

    # Fetch item groups (only menu groups with visible items)
    from servepos.api.registry import _visible_to_profile, _has_field

    group_filters = {"is_group": 0}
    if _has_field("Item Group", "servepos_is_menu_group"):
        any_menu = frappe.db.count("Item Group", {"servepos_is_menu_group": 1})
        if any_menu:
            group_filters["servepos_is_menu_group"] = 1

    group_fields = ["name", "image"]
    if _has_field("Item Group", "servepos_visible_profiles"):
        group_fields.append("servepos_visible_profiles")

    groups = frappe.get_all("Item Group", filters=group_filters, fields=group_fields, limit=0)
    groups = [g for g in groups if _visible_to_profile(g.get("servepos_visible_profiles"), pos_profile)]

    # Fetch items
    item_filters = [["disabled", "=", 0]]
    if _has_field("Item", "servepos_is_available"):
        item_filters.append(["servepos_is_available", "=", 1])

    item_fields = [
        "name", "item_name", "item_code", "item_group", "standard_rate",
        "description", "image",
    ]
    for f in ("servepos_item_name_ar", "servepos_description_ar", "servepos_visible_profiles"):
        if _has_field("Item", f):
            item_fields.append(f)

    items = frappe.get_all("Item", filters=item_filters, fields=item_fields, limit=0, order_by="item_name asc")
    items = [it for it in items if _visible_to_profile(it.get("servepos_visible_profiles"), pos_profile)]

    # Drop groups with no items
    groups_with_items = {it["item_group"] for it in items}
    groups = [g for g in groups if g["name"] in groups_with_items]

    # Strip internal fields from response
    for it in items:
        it.pop("servepos_visible_profiles", None)
    for g in groups:
        g.pop("servepos_visible_profiles", None)

    # Fetch modifier groups
    modifier_groups = []
    try:
        mg_fields = ["name", "group_name", "selection_type", "is_required", "max_selections"]
        mgs = frappe.get_all("ServePOS Modifier Group", fields=mg_fields, limit=0)
        for mg in mgs:
            mg["modifiers"] = frappe.get_all(
                "ServePOS Modifier",
                filters={"parent": mg["name"]},
                fields=["modifier_name", "price", "is_default"],
            )
        modifier_groups = mgs
    except Exception:
        pass

    # Fetch item-modifier-group links
    item_modifier_map = {}
    try:
        links = frappe.get_all(
            "ServePOS Item Modifier Group",
            fields=["parent", "modifier_group"],
            limit=0,
        )
        for link in links:
            item_modifier_map.setdefault(link["parent"], []).append(link["modifier_group"])
    except Exception:
        pass

    # Check if payment gateway is configured
    has_payment_gateway = False
    try:
        qib_account = frappe.db.get_value("POS Profile", pos_profile, "qib_payment_account")
        if qib_account:
            has_payment_gateway = bool(frappe.db.get_value("QIB Settings", qib_account, "enabled"))
    except Exception:
        pass

    return {
        "item_groups": groups,
        "items": items,
        "modifier_groups": modifier_groups,
        "item_modifier_map": item_modifier_map,
        "has_payment_gateway": has_payment_gateway,
    }


@frappe.whitelist(allow_guest=True)
def place_guest_order(seat_code, pos_profile, token, items, notes=None):
    """Place an order as a guest (no auth). Creates a ServePOS Waiter Order
    with is_guest_order=1. Payment will be handled separately."""
    if not seat_code or not pos_profile or not token or not items:
        frappe.throw(_("Seat code, restaurant, token, and items are required"), frappe.ValidationError)

    import json as _json
    from frappe.utils import flt, cint

    if isinstance(items, str):
        items = _json.loads(items)

    if not items:
        frappe.throw(_("At least one item is required"), frappe.ValidationError)

    # Validate token
    _validate_token(token, seat_code)

    # Validate seat
    if not frappe.db.exists("ServePOS Table", seat_code):
        frappe.throw(_("Invalid seat"), frappe.ValidationError)

    table = frappe.db.get_value("ServePOS Table", seat_code, ["table_name", "room", "is_active"], as_dict=True)
    if not table or not table.is_active:
        frappe.throw(_("This seat is currently not available"), frappe.ValidationError)

    # Validate restaurant
    profile_fields = ["servepos_enable_guest_calling", "servepos_guest_order_start_time", "servepos_guest_order_end_time"]
    # These fields may not exist if migrate hasn't been run yet
    for optional_field in ["servepos_online_waiter"]:
        try:
            if frappe.get_meta("POS Profile").get_field(optional_field):
                profile_fields.append(optional_field)
        except Exception:
            pass
    profile_data = frappe.db.get_value("POS Profile", pos_profile, profile_fields, as_dict=True)

    if not profile_data or not profile_data.servepos_enable_guest_calling:
        frappe.throw(_("Ordering is not available for this restaurant"), frappe.ValidationError)

    # Check operating hours
    start_time = profile_data.servepos_guest_order_start_time
    end_time = profile_data.servepos_guest_order_end_time
    if start_time and end_time:
        from datetime import datetime
        now_time = datetime.now().time()
        # Convert frappe timedelta to time if needed
        if hasattr(start_time, "seconds"):
            start_time = (datetime.min + start_time).time()
        if hasattr(end_time, "seconds"):
            end_time = (datetime.min + end_time).time()

        if start_time <= end_time:
            # Normal range: e.g. 09:00 - 23:00
            if not (start_time <= now_time <= end_time):
                frappe.throw(_("Online ordering is available from {0} to {1}").format(
                    start_time.strftime("%I:%M %p"), end_time.strftime("%I:%M %p")
                ), frappe.ValidationError)
        else:
            # Overnight range: e.g. 18:00 - 02:00
            if end_time < now_time < start_time:
                frappe.throw(_("Online ordering is available from {0} to {1}").format(
                    start_time.strftime("%I:%M %p"), end_time.strftime("%I:%M %p")
                ), frappe.ValidationError)

    # Rate limit: max 10 guest orders per seat per hour
    one_hour_ago = add_to_date(now_datetime(), hours=-1)
    recent_orders = frappe.db.count("ServePOS Waiter Order", {
        "table": seat_code,
        "is_guest_order": 1,
        "creation": [">=", one_hour_ago],
    })
    if recent_orders >= 10:
        frappe.throw(_("Too many orders from this seat. Please try again later."), frappe.ValidationError)

    # Validate items exist and get prices from server (never trust client prices)
    validated_items = []
    for item in items:
        item_code = item.get("item_code")
        if not item_code:
            continue

        item_data = frappe.db.get_value("Item", item_code, ["item_name", "standard_rate", "disabled"], as_dict=True)
        if not item_data or item_data.disabled:
            frappe.throw(_("Item {0} is not available").format(item_code), frappe.ValidationError)

        # Validate and recalculate modifier_total from the JSON modifiers
        modifiers_str = item.get("modifiers") or ""
        modifier_total = 0
        if modifiers_str:
            try:
                import json as _json3
                mod_list = _json3.loads(modifiers_str) if isinstance(modifiers_str, str) else modifiers_str
                modifier_total = sum(flt(m.get("price", 0)) for m in mod_list)
                # Re-serialize to ensure clean format
                modifiers_str = _json3.dumps(mod_list)
            except (ValueError, TypeError):
                modifiers_str = ""
                modifier_total = 0

        validated_items.append({
            "item_code": item_code,
            "item_name": item_data.item_name,
            "qty": max(1, cint(item.get("qty", 1))),
            "rate": flt(item_data.standard_rate),
            "modifiers": modifiers_str,
            "modifier_total": flt(modifier_total),
            "special_instructions": (item.get("special_instructions") or "")[:200],
        })

    if not validated_items:
        frappe.throw(_("No valid items in order"), frappe.ValidationError)

    # Check if POS Profile has QIB payment gateway configured
    qib_account = None
    try:
        qib_account = frappe.db.get_value("POS Profile", pos_profile, "qib_payment_account")
    except Exception:
        pass

    if qib_account:
        # --- PAYMENT REQUIRED ---
        # Don't create Waiter Order yet. Store cart in cache, initiate payment.
        # Order will be created only after payment succeeds (in confirm_paid_order).
        import json as _json2
        order_total = sum((vi["rate"] + vi.get("modifier_total", 0)) * vi["qty"] for vi in validated_items)
        site_url = frappe.utils.get_url()

        # Store order data in cache (expires in 1 hour)
        cache_key = None
        try:
            from frappe_qib.api import initiate_payment
            payment_result = initiate_payment(
                amount=order_total,
                qib_account=qib_account,
                description=f"Order from {table.table_name or seat_code}",
                redirect_after=f"{site_url}/call-waiter/{seat_code}/orders",
            )
            ref_id = payment_result.get("reference_id")

            # Store order data keyed by payment reference_id
            frappe.cache.set_value(f"servepos_pending_order:{ref_id}", {
                "seat_code": seat_code,
                "pos_profile": pos_profile,
                "token": token,
                "items": validated_items,
                "notes": (notes or "")[:500],
                "table_name": table.table_name,
                "room": table.room,
            }, expires_in_sec=3600)

            return {
                "success": True,
                "order_name": None,
                "status": "Pending Payment",
                "requires_payment": True,
                "checkout_url": f"{site_url}/qib_checkout?reference_id={ref_id}",
                "message": _("Redirecting to payment..."),
            }
        except Exception as e:
            frappe.log_error(title="QIB Payment Initiation Failed", message=str(e))
            # Fall through — create order without payment

    # --- NO PAYMENT or PAYMENT FAILED ---
    # Create Waiter Order directly with status Pending
    profile_branch = frappe.db.get_value("POS Profile", pos_profile, "branch")

    online_waiter = profile_data.get("servepos_online_waiter") or ""
    online_waiter_name = "Guest Order"
    if online_waiter:
        online_waiter_name = frappe.db.get_value("ServePOS Waiter", online_waiter, "waiter_name") or "Online"

    guest_notes = (notes or "")[:500]

    doc = frappe.new_doc("ServePOS Waiter Order")
    doc.waiter = ""
    doc.waiter_name = online_waiter_name
    doc.order_type = "Dine In"
    doc.table = seat_code
    doc.room = table.room or ""
    doc.guests = 1
    doc.pos_profile = pos_profile
    doc.branch = profile_branch
    doc.status = "Pending"
    doc.is_guest_order = 1
    doc.guest_token = token
    doc.payment_status = "Pay at Table"
    doc.notes = f"{guest_notes}\n[GUEST ORDER - PAY AT TABLE]".strip() if guest_notes else "[GUEST ORDER - PAY AT TABLE]"

    for vi in validated_items:
        doc.append("items", vi)

    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    # Notify waiters directly
    table_name = table.table_name or seat_code
    frappe.publish_realtime(
        "servepos_new_order",
        {
            "order_name": doc.name,
            "table": table_name,
            "pos_profile": pos_profile,
            "is_guest_order": 1,
            "payment_status": "Pay at Table",
            "item_count": len(validated_items),
        },
        doctype="ServePOS Waiter Order",
    )

    # Try FCM push
    try:
        from servepos.api.fcm import send_push_to_waiters
        send_push_to_waiters(pos_profile, {
            "name": doc.name,
            "table": table_name,
            "type": "guest_order",
        })
    except Exception:
        pass

    return {
        "success": True,
        "order_name": doc.name,
        "status": "Pending",
        "requires_payment": False,
        "message": _("Order placed successfully! A waiter will attend to you shortly."),
    }


@frappe.whitelist(allow_guest=True)
def get_guest_order_status(order_name, token):
    """Guest polls this to check their order status."""
    if not order_name or not token:
        frappe.throw(_("Order name and token are required"), frappe.ValidationError)

    order = frappe.db.get_value(
        "ServePOS Waiter Order", order_name,
        ["status", "guest_token", "is_guest_order"],
        as_dict=True,
    )
    if not order or not order.is_guest_order:
        frappe.throw(_("Order not found"), frappe.DoesNotExistError)

    if order.guest_token != token:
        frappe.throw(_("Invalid token"), frappe.ValidationError)

    return {
        "order_name": order_name,
        "status": order.status,
    }


@frappe.whitelist(allow_guest=True)
def get_guest_orders(seat_code, token):
    """Get all guest orders for this seat/session."""
    if not seat_code or not token:
        frappe.throw(_("Seat code and token are required"), frappe.ValidationError)

    _validate_token(token, seat_code)

    orders = frappe.get_all(
        "ServePOS Waiter Order",
        filters={
            "table": seat_code,
            "is_guest_order": 1,
            "guest_token": token,
        },
        fields=["name", "status", "creation", "notes"],
        order_by="creation desc",
        limit=20,
    )

    for order in orders:
        order["items"] = frappe.get_all(
            "ServePOS Waiter Order Item",
            filters={"parent": order["name"]},
            fields=["item_code", "item_name", "qty", "rate", "modifiers", "special_instructions"],
        )

    return orders


@frappe.whitelist(allow_guest=True)
def confirm_paid_order(reference_id):
    """Called after QIB payment success. Creates the Waiter Order from cached
    cart data only after verifying payment was successful.
    No order exists in the system until this point."""
    if not reference_id:
        frappe.throw(_("Reference ID is required"), frappe.ValidationError)

    from frappe.utils import flt

    # Look up the QIB transaction
    try:
        txn_data = frappe.db.get_value(
            "QIB Payment Transaction",
            {"reference_id": reference_id},
            ["name", "status", "amount", "currency", "transaction_id", "transaction_datetime"],
            as_dict=True,
        )
    except Exception:
        frappe.throw(_("Payment system not available"), frappe.ValidationError)

    if not txn_data:
        frappe.throw(_("Payment transaction not found"), frappe.DoesNotExistError)

    if txn_data.status != "Success":
        return {"confirmed": False, "status": txn_data.status}

    # Get cached order data
    cache_key = f"servepos_pending_order:{reference_id}"
    order_data = frappe.cache.get_value(cache_key)

    if not order_data:
        # Already processed or expired
        # Check if order was already created for this reference
        existing = frappe.db.get_value("ServePOS Waiter Order", {"guest_token": reference_id}, "name")
        if existing:
            return {"confirmed": True, "order_name": existing, "status": "Already created"}
        return {"confirmed": False, "error": "Order data expired. Please contact staff."}

    # Build payment details for notes
    amount_str = f"{txn_data.currency or 'QAR'} {flt(txn_data.amount):.2f}"
    parts = ["[PAID ONLINE]", f"Amount: {amount_str}"]
    if txn_data.transaction_id:
        parts.append(f"QIB Txn: {txn_data.transaction_id}")
    if txn_data.transaction_datetime:
        parts.append(f"Date: {txn_data.transaction_datetime}")
    payment_note = " | ".join(parts)

    guest_notes = order_data.get("notes") or ""
    full_notes = f"{guest_notes}\n{payment_note}".strip() if guest_notes else payment_note

    # Resolve waiter and branch
    pos_profile = order_data["pos_profile"]
    profile_data = frappe.db.get_value("POS Profile", pos_profile,
        ["branch", "servepos_online_waiter"], as_dict=True) or {}

    online_waiter = profile_data.get("servepos_online_waiter") or ""
    online_waiter_name = "Online"
    if online_waiter:
        online_waiter_name = frappe.db.get_value("ServePOS Waiter", online_waiter, "waiter_name") or "Online"

    # Create the Waiter Order NOW (payment confirmed)
    doc = frappe.new_doc("ServePOS Waiter Order")
    doc.waiter = ""
    doc.waiter_name = online_waiter_name
    doc.order_type = "Dine In"
    doc.table = order_data["seat_code"]
    doc.room = order_data.get("room") or ""
    doc.guests = 1
    doc.pos_profile = pos_profile
    doc.branch = profile_data.get("branch") or ""
    doc.status = "Pending"
    doc.is_guest_order = 1
    doc.guest_token = reference_id  # use payment ref as token for lookup
    doc.payment_status = "Paid Online"
    doc.notes = full_notes

    for item in order_data["items"]:
        doc.append("items", item)

    doc.insert(ignore_permissions=True)

    # Link the QIB transaction to this order
    try:
        frappe.db.set_value("QIB Payment Transaction", txn_data.name, {
            "reference_doctype": "ServePOS Waiter Order",
            "reference_docname": doc.name,
        })
    except Exception:
        pass

    frappe.db.commit()

    # Clear cached order data
    frappe.cache.delete_value(cache_key)

    # Notify waiters
    table_name = order_data.get("table_name") or order_data["seat_code"]

    frappe.publish_realtime(
        "servepos_new_order",
        {
            "order_name": doc.name,
            "table": table_name,
            "pos_profile": pos_profile,
            "is_guest_order": 1,
            "payment_status": "Paid Online",
            "item_count": len(order_data["items"]),
        },
        doctype="ServePOS Waiter Order",
    )

    try:
        from servepos.api.fcm import send_push_to_waiters
        send_push_to_waiters(pos_profile, {
            "name": doc.name,
            "table": table_name,
            "type": "guest_order_paid",
        })
    except Exception:
        pass

    return {"confirmed": True, "order_name": doc.name, "status": "Pending"}


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
