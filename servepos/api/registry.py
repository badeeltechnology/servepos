"""
ServePOS Centralized API Registry
=================================
Single source of truth for all list/fetch APIs used by ServePOS clients
(web, Electron desktop, Flutter waiter app).

Design rules:
  1. Every endpoint REQUIRES a `pos_profile` parameter. Missing = error.
  2. All filtering happens here on the server. Clients never filter lists.
  3. Each filterable doctype uses a `servepos_visible_profiles` custom field
     (Small Text, comma-separated POS Profile names):
        empty       -> visible on every profile
        "A"         -> only on profile A
        "A,B,C"     -> visible on profiles A, B and C
  4. Doctypes that already carry a `branch` field (Tables, Rooms, Waiters)
     are additionally filtered by the POS Profile's branch when present.

To change a filtering rule for ANY client, change it here. Nothing else.
"""
import frappe
from frappe import _


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _assert_profile(pos_profile):
    """Validate and return the POS Profile doc. Throws if missing/invalid."""
    if not pos_profile:
        frappe.throw(_("pos_profile is required"))
    if not frappe.db.exists("POS Profile", pos_profile):
        frappe.throw(_("POS Profile {0} not found").format(pos_profile))
    return frappe.get_cached_doc("POS Profile", pos_profile)


def _visible_to_profile(visible_profiles, pos_profile):
    """
    Return True if a row with the given `servepos_visible_profiles` string
    should be visible on the given POS Profile.
    Empty string -> visible everywhere.
    """
    if not visible_profiles:
        return True
    profiles = [p.strip() for p in str(visible_profiles).split(",") if p.strip()]
    if not profiles:
        return True
    return pos_profile in profiles


def _filter_by_visible_profiles(rows, pos_profile, field="servepos_visible_profiles"):
    """Filter a list of dict rows by the visible_profiles whitelist field."""
    return [r for r in rows if _visible_to_profile(r.get(field), pos_profile)]


def _branch_filter(profile_doc):
    """
    Return a filter dict `{"branch": X}` if the POS Profile has a branch set,
    else an empty dict (no branch constraint).
    """
    branch = getattr(profile_doc, "branch", None)
    return {"branch": branch} if branch else {}


def _has_field(doctype, fieldname):
    """Check if a doctype has a given field (custom or standard)."""
    try:
        meta = frappe.get_meta(doctype)
        return bool(meta.get_field(fieldname))
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# Items & Item Groups
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_item_groups(pos_profile):
    """Menu item groups visible on the given POS Profile.

    A group is returned only if BOTH conditions are met:
      1. Its own servepos_visible_profiles whitelist allows this profile.
      2. It contains at least one item that is visible to this profile
         (so empty categories never show up on the POS / Waiter App).
    """
    _assert_profile(pos_profile)

    filters = {"is_group": 0}
    if _has_field("Item Group", "servepos_is_menu_group"):
        any_menu = frappe.db.count("Item Group", {"servepos_is_menu_group": 1})
        if any_menu:
            filters["servepos_is_menu_group"] = 1

    fields = ["name", "parent_item_group"]
    if _has_field("Item Group", "servepos_visible_profiles"):
        fields.append("servepos_visible_profiles")
    if _has_field("Item Group", "image"):
        fields.append("image")

    rows = frappe.get_all("Item Group", filters=filters, fields=fields, limit=0)
    rows = _filter_by_visible_profiles(rows, pos_profile)

    # Drop groups that have zero visible items for this profile.
    item_filters = [["disabled", "=", 0]]
    if _has_field("Item", "servepos_is_available"):
        item_filters.append(["servepos_is_available", "=", 1])
    item_fields = ["item_group"]
    if _has_field("Item", "servepos_visible_profiles"):
        item_fields.append("servepos_visible_profiles")
    items = frappe.get_all("Item", filters=item_filters, fields=item_fields, limit=0)
    groups_with_items = {
        it["item_group"]
        for it in items
        if _visible_to_profile(it.get("servepos_visible_profiles"), pos_profile)
    }
    return [r for r in rows if r["name"] in groups_with_items]


@frappe.whitelist()
def get_items(pos_profile, item_group=None, search=None, limit=0, modified_after=None):
    """
    Items visible on the given POS Profile.
    Optional: filter by item_group, search text, or incremental sync via
    `modified_after` timestamp.
    """
    _assert_profile(pos_profile)

    filters = [["disabled", "=", 0]]
    if _has_field("Item", "servepos_is_available"):
        filters.append(["servepos_is_available", "=", 1])
    if item_group:
        filters.append(["item_group", "=", item_group])
    if search:
        filters.append(["item_name", "like", f"%{search}%"])
    if modified_after:
        filters.append(["modified", ">", modified_after])

    fields = [
        "name", "item_name", "item_code", "item_group", "standard_rate",
        "description", "image", "stock_uom", "has_variants", "modified",
    ]
    for f in (
        "servepos_item_name_ar",
        "servepos_description_ar",
        "servepos_visible_profiles",
        "servepos_is_available",
        "servepos_kitchen_station",
        "servepos_preparation_time",
    ):
        if _has_field("Item", f):
            fields.append(f)

    rows = frappe.get_all(
        "Item",
        filters=filters,
        fields=fields,
        limit=int(limit) or 0,
        order_by="item_name asc",
    )
    return _filter_by_visible_profiles(rows, pos_profile)


# --------------------------------------------------------------------------- #
# Modifier Groups
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_modifier_groups(pos_profile):
    """Modifier groups (with their child modifiers) visible on the given POS Profile."""
    _assert_profile(pos_profile)

    meta = frappe.get_meta("ServePOS Modifier Group")
    fields = ["name", "group_name"]
    for f in ("selection_type", "is_required", "max_selections", "servepos_visible_profiles"):
        if meta.get_field(f):
            fields.append(f)

    groups = frappe.get_all("ServePOS Modifier Group", fields=fields, limit=0)
    groups = _filter_by_visible_profiles(groups, pos_profile)

    # Attach child modifiers for each visible group.
    for g in groups:
        g["modifiers"] = frappe.get_all(
            "ServePOS Modifier",
            filters={"parent": g["name"]},
            fields=["modifier_name", "price", "is_default"],
        )
    return groups


# --------------------------------------------------------------------------- #
# Waiters
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_waiters(pos_profile):
    """Active waiters visible on the given POS Profile."""
    profile = _assert_profile(pos_profile)

    filters = {"is_active": 1}
    # Branch match when both sides define it.
    if _has_field("ServePOS Waiter", "branch"):
        filters.update(_branch_filter(profile))

    fields = ["name", "waiter_name", "is_active"]
    if _has_field("ServePOS Waiter", "branch"):
        fields.append("branch")
    if _has_field("ServePOS Waiter", "servepos_visible_profiles"):
        fields.append("servepos_visible_profiles")

    rows = frappe.get_all("ServePOS Waiter", filters=filters, fields=fields, limit=0)
    return _filter_by_visible_profiles(rows, pos_profile)


# --------------------------------------------------------------------------- #
# Tables & Rooms
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_tables(pos_profile):
    profile = _assert_profile(pos_profile)

    filters = {}
    if _has_field("ServePOS Table", "branch"):
        filters.update(_branch_filter(profile))

    fields = ["name", "table_name"]
    for f in ("room", "seats", "capacity", "is_active", "branch", "servepos_visible_profiles"):
        if _has_field("ServePOS Table", f):
            fields.append(f)

    rows = frappe.get_all("ServePOS Table", filters=filters, fields=fields, limit=0)
    return _filter_by_visible_profiles(rows, pos_profile)


@frappe.whitelist()
def get_rooms(pos_profile):
    profile = _assert_profile(pos_profile)

    filters = {}
    if _has_field("ServePOS Room", "branch"):
        filters.update(_branch_filter(profile))

    fields = ["name", "room_name"]
    for f in ("description", "is_active", "branch", "servepos_visible_profiles"):
        if _has_field("ServePOS Room", f):
            fields.append(f)

    rows = frappe.get_all("ServePOS Room", filters=filters, fields=fields, limit=0)
    return _filter_by_visible_profiles(rows, pos_profile)


# --------------------------------------------------------------------------- #
# Kitchen Stations
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_kitchen_stations(pos_profile):
    profile = _assert_profile(pos_profile)

    filters = {"is_active": 1}
    if _has_field("ServePOS Kitchen Station", "branch"):
        filters.update(_branch_filter(profile))

    fields = ["name", "station_name", "display_order"]
    for f in ("branch", "servepos_visible_profiles"):
        if _has_field("ServePOS Kitchen Station", f):
            fields.append(f)

    rows = frappe.get_all(
        "ServePOS Kitchen Station",
        filters=filters,
        fields=fields,
        order_by="display_order asc",
        limit=0,
    )
    return _filter_by_visible_profiles(rows, pos_profile)


# --------------------------------------------------------------------------- #
# Promos
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_promos(pos_profile):
    _assert_profile(pos_profile)

    filters = {"enabled": 1} if _has_field("ServePOS Promo", "enabled") else {}

    fields = ["name"]
    meta = frappe.get_meta("ServePOS Promo")
    for f in (
        "promo_name", "discount_type", "discount_value", "description",
        "valid_from", "valid_to", "enabled",
        "pos_profile",  # legacy single-profile link
        "servepos_visible_profiles",  # new multi-profile whitelist
    ):
        if meta.get_field(f):
            fields.append(f)

    rows = frappe.get_all("ServePOS Promo", filters=filters, fields=fields, limit=0)
    # Apply both the legacy pos_profile link and the new whitelist.
    has_legacy = meta.get_field("pos_profile") is not None
    result = []
    for r in rows:
        if has_legacy and r.get("pos_profile") and r["pos_profile"] != pos_profile:
            continue
        if not _visible_to_profile(r.get("servepos_visible_profiles"), pos_profile):
            continue
        result.append(r)
    return result


# --------------------------------------------------------------------------- #
# Payment Methods & Taxes (derived from POS Profile itself)
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_payment_methods(pos_profile):
    profile = _assert_profile(pos_profile)
    return [
        {
            "mode_of_payment": p.mode_of_payment,
            "default": p.default,
            "allow_in_returns": getattr(p, "allow_in_returns", 0),
        }
        for p in (profile.payments or [])
    ]


@frappe.whitelist()
def get_taxes(pos_profile):
    profile = _assert_profile(pos_profile)
    template = getattr(profile, "taxes_and_charges", None)
    if not template:
        return []
    doc = frappe.get_cached_doc("Sales Taxes and Charges Template", template)
    return [
        {
            "charge_type": t.charge_type,
            "account_head": t.account_head,
            "description": t.description,
            "rate": t.rate,
            "included_in_print_rate": t.included_in_print_rate,
        }
        for t in (doc.taxes or [])
    ]


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_active_orders(pos_profile, statuses=None, days=1):
    """
    Waiter orders for the given profile. `statuses` is an optional list
    (or comma-separated string). Defaults to all non-final states.
    `days` limits results to orders created within the last N days (default: 1 = today).
    Pass days=0 to disable the date filter.
    """
    profile = _assert_profile(pos_profile)

    if isinstance(statuses, str):
        statuses = [s.strip() for s in statuses.split(",") if s.strip()]
    if not statuses:
        statuses = ["Pending", "Accepted", "In Kitchen", "Ready"]

    filters = {"status": ["in", statuses], "pos_profile": pos_profile}
    if getattr(profile, "branch", None) and _has_field("ServePOS Waiter Order", "branch"):
        filters["branch"] = profile.branch

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
        fields=[
            "name", "status", "waiter", "waiter_name", "table", "room",
            "order_type", "guests", "notes", "pos_profile", "branch",
            "creation", "modified", "pos_order_id",
        ],
        order_by="creation desc",
        limit=0,
    )
    for o in orders:
        o["items"] = frappe.get_all(
            "ServePOS Waiter Order Item",
            filters={"parent": o["name"]},
            fields=[
                "item_code", "item_name", "qty", "rate",
                "modifiers", "modifier_total", "special_instructions",
            ],
        )
    return orders


# --------------------------------------------------------------------------- #
# One-shot bundle (used by clients at startup / full sync)
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_pos_bundle(pos_profile):
    """
    Returns everything a client needs to operate the given POS Profile in
    a single call. Use this for initial sync or refresh-all.
    """
    _assert_profile(pos_profile)
    return {
        "pos_profile": pos_profile,
        "item_groups": get_item_groups(pos_profile),
        "items": get_items(pos_profile),
        "modifier_groups": get_modifier_groups(pos_profile),
        "waiters": get_waiters(pos_profile),
        "tables": get_tables(pos_profile),
        "rooms": get_rooms(pos_profile),
        "kitchen_stations": get_kitchen_stations(pos_profile),
        "promos": get_promos(pos_profile),
        "payment_methods": get_payment_methods(pos_profile),
        "taxes": get_taxes(pos_profile),
    }
