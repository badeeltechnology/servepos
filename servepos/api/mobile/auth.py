"""ServePOS Mobile API v2: waiter login with per-device tokens.

See docs/WAITER_API_V2.md (contract shared with the Flutter waiter app).
"""

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from servepos.api.mobile import security

MAX_PASSWORD_SIZE = 512


def _clean(value, max_len, label, required=False):
	if value is None:
		value = ""
	if not isinstance(value, str | int | float):
		frappe.throw(_("Invalid {0}").format(label))
	value = str(value).strip()
	if required and not value:
		frappe.throw(_("{0} is required").format(label))
	return value[:max_len]


def _fail(message, user):
	"""Record a failed login (Activity Log) and raise AuthenticationError."""
	try:
		from frappe.core.doctype.activity_log.activity_log import add_authentication_log

		add_authentication_log(f"Waiter App: {message}", user or _("Unknown User"), status="Failed")
		if not frappe.flags.servepos_mobile_test:
			frappe.db.commit()
	except Exception:
		pass
	frappe.throw(_(message), frappe.AuthenticationError)


def _user_payload(user, waiter):
	info = frappe.db.get_value("User", user, ["full_name", "user_image"], as_dict=True) or {}
	profiles = security.waiter_profiles(waiter)
	names = [p.name for p in profiles]

	default = frappe.db.get_value(
		"POS Profile User", {"user": user, "default": 1, "parent": ["in", names or [""]]}, "parent"
	)
	if not default and names:
		default = names[0]

	try:
		from servepos import __version__ as servepos_version
	except Exception:
		servepos_version = ""

	return {
		"user": {
			"user": user,
			"full_name": info.get("full_name") or user,
			"waiter": waiter.name,
			"image": info.get("user_image") or None,
		},
		"pos_profiles": [
			{
				"name": p.name,
				"restaurant_name": p.get("servepos_restaurant_display_name") or p.name,
				"branch": p.branch,
				"currency": p.currency,
			}
			for p in profiles
		],
		"default_pos_profile": default,
		"server": {
			"site": frappe.local.site,
			"servepos_version": servepos_version,
			"time": str(now_datetime().replace(microsecond=0)),
		},
	}


def resolve_login_name(usr):
	"""Map what the waiter typed (email, User name or plain username) to the User name.

	Waiter logins created from the /pos admin have a placeholder email, so the waiter
	types the username. This works without System Settings > allow_login_using_user_name.
	"""
	if frappe.db.exists("User", usr):
		return usr
	name = frappe.db.get_value("User", {"username": usr}, "name")
	if not name and usr != usr.lower():
		name = frappe.db.get_value("User", {"username": usr.lower()}, "name")
	return name or usr


@frappe.whitelist(allow_guest=True, methods=["POST"])
def login(usr=None, pwd=None, device_id=None, device_name=None, platform=None, app_version=None):
	"""Password login from the waiter app. Returns a device token (shown once)."""
	from frappe.auth import get_login_attempt_tracker
	from frappe.core.doctype.user.user import User

	usr = _clean(usr, 140, _("Username"), required=True)
	if not isinstance(pwd, str) or not pwd:
		frappe.throw(_("Password is required"), frappe.AuthenticationError)
	if len(pwd) > MAX_PASSWORD_SIZE:
		frappe.throw(_("Password size exceeded the maximum allowed size"), frappe.AuthenticationError)
	device_id = _clean(device_id, 140, _("Device ID"), required=True)
	device_name = _clean(device_name, 140, _("Device name")) or device_id[:40]
	platform = _clean(platform, 40, _("Platform"))
	app_version = _clean(app_version, 40, _("App version"))
	ip = getattr(frappe.local, "request_ip", None)

	# 5 attempts / 5 minutes per username + IP
	security.check_login_rate(usr, ip)

	# Frappe's own lockout (System Settings > allow_consecutive_login_attempts)
	ip_tracker = get_login_attempt_tracker(ip) if ip else None
	found = User.find_by_credentials(resolve_login_name(usr), pwd)
	if not found:
		ip_tracker and ip_tracker.add_failure_attempt()
		_fail("Invalid login credentials", usr)

	user = found.name
	user_tracker = get_login_attempt_tracker(user)
	if not found.is_authenticated:
		user_tracker.add_failure_attempt()
		ip_tracker and ip_tracker.add_failure_attempt()
		_fail("Invalid login credentials", user)
	if not cint(found.enabled):
		user_tracker.add_failure_attempt()
		ip_tracker and ip_tracker.add_failure_attempt()
		_fail("User disabled or missing", user)

	user_tracker.add_success_attempt()
	ip_tracker and ip_tracker.add_success_attempt()

	# Authorization checks (password was right)
	if user in ("Administrator", "Guest"):
		frappe.throw(_("This user cannot log in to the waiter app"), frappe.PermissionError)
	if security.WAITER_ROLE not in frappe.get_roles(user):
		frappe.throw(_("Your user does not have the ServePOS Waiter role"), frappe.PermissionError)
	waiter = frappe.db.get_value(
		"ServePOS Waiter",
		{"user": user},
		["name", "waiter_name", "branch", "is_active", "servepos_visible_profiles"],
		as_dict=True,
	)
	if not waiter:
		frappe.throw(_("No waiter is linked to your user. Ask your manager."), frappe.PermissionError)
	if not cint(waiter.is_active):
		frappe.throw(_("Your waiter profile is inactive"), frappe.PermissionError)
	payload = _user_payload(user, waiter)
	if not payload["pos_profiles"]:
		frappe.throw(_("No POS Profile is available to you. Ask your manager."), frappe.PermissionError)

	security.reset_login_rate(usr, ip)

	# One active session per user + device: re-login replaces the old one.
	for old in frappe.get_all(
		security.DEVICE_SESSION, filters={"user": user, "device_id": device_id, "revoked": 0}, pluck="name"
	):
		security.revoke(old, "Replaced by a new login on the same device")

	token = security.generate_token()
	now = now_datetime()
	settings = security.get_settings()
	expires_on = security.compute_expiry(now, now, settings)
	doc = frappe.get_doc(
		{
			"doctype": security.DEVICE_SESSION,
			"user": user,
			"waiter": waiter.name,
			"device_id": device_id,
			"device_name": device_name,
			"platform": platform,
			"app_version": app_version,
			"token_hash": security.hash_token(token),
			"created_on": now,
			"last_seen": now,
			"expires_on": expires_on,
			"last_ip": ip,
		}
	)
	doc.insert(ignore_permissions=True)
	# owner = the waiter, so the "read own devices" permission works in Desk
	frappe.db.set_value(security.DEVICE_SESSION, doc.name, "owner", user, update_modified=False)

	try:
		from frappe.core.doctype.activity_log.activity_log import add_authentication_log

		add_authentication_log(f"Waiter App login ({device_name})", user, status="Success")
	except Exception:
		pass

	out = {"token": token, "expires_on": str(expires_on.replace(microsecond=0))}
	out.update(payload)
	return out


def _session_or_none():
	name = security.current_device_session()
	if not name:
		return None
	return frappe.db.get_value(security.DEVICE_SESSION, name, ["name", "expires_on", "user"], as_dict=True)


@frappe.whitelist(methods=["GET", "POST"])
def me():
	"""Same as login without the token; used on app start to check the token."""
	waiter = security.current_waiter()
	sess = _session_or_none()
	out = {"expires_on": str(sess.expires_on) if sess and sess.expires_on else None}
	out.update(_user_payload(frappe.session.user, waiter))
	return out


@frappe.whitelist(methods=["POST"])
def logout():
	"""Revoke the calling device session."""
	name = security.current_device_session()
	if name:
		owner = frappe.db.get_value(security.DEVICE_SESSION, name, "user")
		if owner == frappe.session.user:
			security.revoke(name, "Logged out")
	return {"ok": True}


@frappe.whitelist(methods=["GET", "POST"])
def sessions():
	"""The calling waiter's active devices."""
	security.current_waiter()
	current = security.current_device_session()
	rows = frappe.get_all(
		security.DEVICE_SESSION,
		filters={"user": frappe.session.user, "revoked": 0, "expires_on": [">", now_datetime()]},
		fields=["name", "device_name", "platform", "app_version", "last_seen", "created_on"],
		order_by="last_seen desc",
		limit=50,
	)
	for r in rows:
		r["current"] = r.name == current
	return rows


@frappe.whitelist(methods=["POST"])
def revoke_session(name=None):
	"""Revoke one of the calling waiter's own devices."""
	security.current_waiter()
	if not name or not isinstance(name, str):
		frappe.throw(_("name is required"))
	owner = frappe.db.get_value(security.DEVICE_SESSION, name, "user")
	if owner != frappe.session.user:
		frappe.throw(_("Device session not found"), frappe.DoesNotExistError)
	security.revoke(name, "Revoked from the waiter app")
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def revoke_all_for_waiter(waiter=None):
	"""Desk button on ServePOS Waiter: log every phone of this waiter out."""
	frappe.only_for("System Manager")
	if not waiter or not frappe.db.exists("ServePOS Waiter", waiter):
		frappe.throw(_("Waiter not found"), frappe.DoesNotExistError)
	user = frappe.db.get_value("ServePOS Waiter", waiter, "user")
	or_filters = {"waiter": waiter}
	if user:
		or_filters["user"] = user
	names = frappe.get_all(
		security.DEVICE_SESSION, filters={"revoked": 0}, or_filters=or_filters, pluck="name"
	)
	for n in names:
		security.revoke(n, f"All devices revoked by {frappe.session.user}")
	return {"ok": True, "revoked": len(names)}
