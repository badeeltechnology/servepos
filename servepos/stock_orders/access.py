"""Login landing page and Desk guard per role (set in ServePOS Stock Settings)."""
import frappe

ALWAYS_DESK = {"System Manager", "Administrator"}


def _rules(user):
	if not user or user in ("Guest", "Administrator"):
		return None, True
	roles = set(frappe.get_roles(user))
	if roles & ALWAYS_DESK:
		return None, True
	from servepos.stock_orders.utils import implied_roles
	roles |= implied_roles(user)
	try:
		rows = frappe.get_cached_doc("ServePOS Stock Settings").role_access or []
	except Exception:
		return None, True
	matched = [r for r in rows if r.role in roles]
	if not matched:
		return None, True
	landing = matched[0].landing_page or "/stock"
	desk = any(r.allow_desk for r in matched)
	return landing, desk


def on_session_creation(login_manager=None):
	landing, _desk = _rules(frappe.session.user)
	if landing:
		frappe.local.response["home_page"] = landing


def extend_bootinfo(bootinfo):
	landing, desk = _rules(frappe.session.user)
	if landing and not desk:
		bootinfo.servepos_stock_redirect = landing


def _role_for_warehouse(warehouse):
	loc = frappe.db.get_value("ServePOS Stock Location", {"warehouse": warehouse, "enabled": 1},
		["location_type", "ship_role"], as_dict=True)
	if not loc:
		return None
	if loc.location_type == "Outlet":
		return "ServePOS Outlet User"
	# a provider's ship role; Stock Manager is never granted automatically
	return loc.ship_role if loc.ship_role and loc.ship_role != "Stock Manager" else None


def grant_role_for_permission(user, warehouse):
	role = _role_for_warehouse(warehouse)
	if not role or not frappe.db.exists("Role", role) or user in ("Administrator", "Guest"):
		return None
	if frappe.db.get_value("User", user, "user_type") != "System User":
		return None
	if frappe.get_all("User Role Profile", filters={"parent": user}, limit=1):
		# roles come from the profile and would be reset on the next save; access is implied instead
		return None
	if role in frappe.get_roles(user):
		return None
	u = frappe.get_doc("User", user)
	u.flags.ignore_permissions = True
	u.add_roles(role)
	return role


def on_user_permission(doc, method=None):
	"""A User Permission on an outlet or provider warehouse gives the matching Stock Orders role."""
	if doc.allow == "Warehouse":
		grant_role_for_permission(doc.user, doc.for_value)


def sync_roles():
	"""Back-fill roles for everyone who already has warehouse permissions (run by setup)."""
	done = []
	for up in frappe.get_all("User Permission", filters={"allow": "Warehouse"}, fields=["user", "for_value"]):
		role = grant_role_for_permission(up.user, up.for_value)
		if role:
			done.append((up.user, role))
	return done
