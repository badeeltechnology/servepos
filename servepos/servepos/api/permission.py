import frappe


def has_app_permission():
    """Check if user has permission to access ServePOS app"""
    if frappe.session.user == "Guest":
        return False

    # Check if user has any of the ServePOS roles
    user_roles = frappe.get_roles(frappe.session.user)
    allowed_roles = [
        "System Manager",
        "ServePOS Manager",
        "ServePOS Cashier",
        "ServePOS Waiter",
        "ServePOS Kitchen",
        "ServePOS Reporter",
        "POS User",
        "Sales User",
    ]

    return any(role in user_roles for role in allowed_roles)
