"""Waiter app logins managed from the ServePOS web admin (/pos > Waiters).

Managers create, reset, disable and remove a waiter's app login without touching
Desk > User. The User gets a placeholder email (RFC 2606 ``.invalid``, never
delivered) unless the manager gives one; the waiter signs in with the username.
"""

import re
import secrets

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from servepos.api.mobile import security

MANAGER_ROLES = {"System Manager", "ServePOS Manager"}
# Roles a login may hold and still be managed by a ServePOS Manager (automatic roles + waiter).
WAITER_SAFE_ROLES = {security.WAITER_ROLE, "All", "Guest", "Desk User"}
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,30}$")
PLACEHOLDER_DOMAIN = "waiter.servepos.invalid"
MIN_PASSWORD = 6
MAX_PASSWORD = 128


# ---- guards -------------------------------------------------------------


def _is_system_manager():
	return frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles()


def _assert_manager():
	user = frappe.session.user
	if user == "Administrator":
		return
	if not MANAGER_ROLES & set(frappe.get_roles(user)):
		frappe.throw(_("Only a ServePOS Manager can manage waiter app logins"), frappe.PermissionError)


def _get_waiter(waiter):
	if not waiter or not isinstance(waiter, str) or not frappe.db.exists("ServePOS Waiter", waiter):
		frappe.throw(_("Waiter not found"), frappe.DoesNotExistError)
	return frappe.db.get_value(
		"ServePOS Waiter", waiter, ["name", "waiter_name", "user", "is_active"], as_dict=True
	)


def _linked_user(w, required=True):
	user = w.user if w.user and frappe.db.exists("User", w.user) else None
	if required and not user:
		frappe.throw(_("{0} has no app login yet").format(w.waiter_name))
	return user


def _assert_manageable(user):
	"""Never let this screen touch Administrator or a privileged account.

	A ServePOS Manager can change the Link on a waiter, so without this check they could
	point a waiter at a manager's User and reset its password.
	"""
	if user in ("Administrator", "Guest"):
		frappe.throw(_("This user cannot be managed here"), frappe.PermissionError)
	if _is_system_manager():
		return
	extra = set(frappe.get_roles(user)) - WAITER_SAFE_ROLES
	if extra:
		frappe.throw(
			_("User {0} has other roles ({1}); manage it from Desk > User").format(
				user, ", ".join(sorted(extra))
			),
			frappe.PermissionError,
		)


def _clean_password(password, username=None):
	if not isinstance(password, str) or not password:
		frappe.throw(_("Password is required"))
	if password != password.strip():
		frappe.throw(_("Password cannot start or end with a space"))
	if len(password) < MIN_PASSWORD:
		frappe.throw(_("Password must be at least {0} characters").format(MIN_PASSWORD))
	if len(password) > MAX_PASSWORD:
		frappe.throw(_("Password is too long"))
	if username and password.lower() == username.lower():
		frappe.throw(_("Password cannot be the same as the username"))
	return password


def _clean_username(username):
	if not isinstance(username, str):
		frappe.throw(_("Username is required"))
	username = username.strip().lower()
	if not USERNAME_RE.match(username):
		frappe.throw(
			_("Username must be 3 to 30 characters: lowercase letters, digits, dot, dash or underscore")
		)
	if frappe.db.exists("User", {"username": username}) or frappe.db.exists("User", username):
		frappe.throw(_("Username {0} is already taken").format(username), frappe.DuplicateEntryError)
	return username


def _revoke_devices(w, user, reason):
	or_filters = {"waiter": w.name}
	if user:
		or_filters["user"] = user
	names = frappe.get_all(security.DEVICE_SESSION, filters={"revoked": 0}, or_filters=or_filters, pluck="name")
	for n in names:
		security.revoke(n, reason)
	return len(names)


def _devices(w, user):
	or_filters = {"waiter": w.name}
	if user:
		or_filters["user"] = user
	return frappe.get_all(
		security.DEVICE_SESSION,
		or_filters=or_filters,
		filters={"revoked": 0, "expires_on": [">", now_datetime()]},
		fields=["name", "device_name", "platform", "app_version", "last_seen", "created_on", "revoked"],
		order_by="last_seen desc",
		limit=50,
	)


def _status(w):
	user = _linked_user(w, required=False)
	if not user:
		return {"has_login": False, "waiter": w.name, "username": None, "user": None, "devices": []}
	info = frappe.db.get_value("User", user, ["username", "enabled", "last_login", "email"], as_dict=True)
	return {
		"has_login": True,
		"waiter": w.name,
		"user": user,
		"username": info.username or user,
		"email": None if (info.email or "").endswith("@" + PLACEHOLDER_DOMAIN) else info.email,
		"user_enabled": cint(info.enabled),
		"has_role": security.WAITER_ROLE in frappe.get_roles(user),
		"last_login": info.last_login,
		"devices": _devices(w, user),
	}


# ---- endpoints ------------------------------------------------------------


@frappe.whitelist(methods=["GET", "POST"])
def app_login_overview():
	"""One row per waiter with a login: username, enabled, active device count (for the list)."""
	_assert_manager()
	rows = frappe.get_all(
		"ServePOS Waiter", filters={"user": ["is", "set"]}, fields=["name", "user"], limit=0
	)
	users = [r.user for r in rows]
	info = {
		u.name: u
		for u in frappe.get_all(
			"User", filters={"name": ["in", users or [""]]}, fields=["name", "username", "enabled", "last_login"]
		)
	}
	counts = {}
	for d in frappe.get_all(
		security.DEVICE_SESSION,
		filters={"revoked": 0, "expires_on": [">", now_datetime()], "waiter": ["in", [r.name for r in rows] or [""]]},
		fields=["waiter"],
		limit=0,
	):
		counts[d.waiter] = counts.get(d.waiter, 0) + 1
	out = {}
	for r in rows:
		u = info.get(r.user)
		if not u:
			continue
		out[r.name] = {
			"user": r.user,
			"username": u.username or r.user,
			"user_enabled": cint(u.enabled),
			"last_login": u.last_login,
			"devices": counts.get(r.name, 0),
		}
	return out


@frappe.whitelist(methods=["GET", "POST"])
def app_login_status(waiter=None):
	_assert_manager()
	return _status(_get_waiter(waiter))


@frappe.whitelist(methods=["POST"])
def create_app_login(waiter=None, username=None, password=None, email=None):
	"""Create the User the waiter signs in with and link it to the waiter."""
	_assert_manager()
	w = _get_waiter(waiter)
	if _linked_user(w, required=False):
		frappe.throw(_("{0} already has an app login").format(w.waiter_name))
	username = _clean_username(username)
	password = _clean_password(password, username)

	email = (email or "").strip().lower() if isinstance(email, str) else ""
	if email:
		from frappe.utils import validate_email_address

		if not validate_email_address(email):
			frappe.throw(_("Invalid email address"))
		if frappe.db.exists("User", email):
			frappe.throw(_("A user with email {0} already exists").format(email), frappe.DuplicateEntryError)
	else:
		email = f"{username}.{secrets.token_hex(2)}@{PLACEHOLDER_DOMAIN}"
		while frappe.db.exists("User", email):
			email = f"{username}.{secrets.token_hex(2)}@{PLACEHOLDER_DOMAIN}"

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"username": username,
			"first_name": (w.waiter_name or username)[:140],
			"send_welcome_email": 0,
			"new_password": password,
			"roles": [{"role": security.WAITER_ROLE}],
		}
	)
	user.flags.ignore_password_policy = True
	user.flags.servepos_waiter_login = True
	user.insert(ignore_permissions=True)
	if user.username != username:
		# Frappe silently clears a clashing username; never hand out a login that cannot work.
		frappe.throw(_("Username {0} is already taken").format(username), frappe.DuplicateEntryError)

	doc = frappe.get_doc("ServePOS Waiter", w.name)
	doc.user = user.name
	doc.save(ignore_permissions=True)
	frappe.clear_messages()

	out = _status(frappe._dict(w, user=user.name))
	out["site_url"] = frappe.utils.get_url()
	return out


@frappe.whitelist(methods=["POST"])
def reset_app_password(waiter=None, password=None, sign_out_devices=1):
	_assert_manager()
	w = _get_waiter(waiter)
	user = _linked_user(w)
	_assert_manageable(user)
	username = frappe.db.get_value("User", user, "username")
	password = _clean_password(password, username)

	from frappe.utils.password import update_password

	update_password(user, password)
	revoked = 0
	if cint(sign_out_devices):
		revoked = _revoke_devices(w, user, f"Password reset by {frappe.session.user}")
	_clear_lockout(user, username)
	return {"ok": True, "revoked": revoked, "username": username or user}


@frappe.whitelist(methods=["POST"])
def set_app_login_enabled(waiter=None, enabled=1):
	_assert_manager()
	w = _get_waiter(waiter)
	user = _linked_user(w)
	_assert_manageable(user)
	enabled = 1 if cint(enabled) else 0
	frappe.db.set_value("User", user, "enabled", enabled)
	revoked = 0
	if not enabled:
		revoked = _revoke_devices(w, user, f"App login disabled by {frappe.session.user}")
		frappe.sessions.clear_sessions(user, force=True)
	return {"ok": True, "enabled": enabled, "revoked": revoked}


@frappe.whitelist(methods=["POST"])
def revoke_app_devices(waiter=None):
	_assert_manager()
	w = _get_waiter(waiter)
	user = _linked_user(w, required=False)
	if user:
		_assert_manageable(user)
	return {"ok": True, "revoked": _revoke_devices(w, user, f"All devices revoked by {frappe.session.user}")}


@frappe.whitelist(methods=["POST"])
def remove_app_login(waiter=None):
	"""Unlink and disable the User (kept for the audit trail) and sign out its phones.

	The username is released (renamed to removed.<name>.<rand>) so it can be reused.
	"""
	_assert_manager()
	w = _get_waiter(waiter)
	user = _linked_user(w)
	_assert_manageable(user)
	revoked = _revoke_devices(w, user, f"App login removed by {frappe.session.user}")
	username = frappe.db.get_value("User", user, "username")
	values = {"enabled": 0}
	if username:
		values["username"] = f"removed.{username}.{secrets.token_hex(2)}"
	frappe.db.set_value("User", user, values)
	frappe.sessions.clear_sessions(user, force=True)
	doc = frappe.get_doc("ServePOS Waiter", w.name)
	doc.user = None
	doc.save(ignore_permissions=True)
	return {"ok": True, "revoked": revoked, "user": user}


def _clear_lockout(user, username):
	"""After a reset, let the waiter try again straight away."""
	try:
		from frappe.auth import get_login_attempt_tracker

		ip = getattr(frappe.local, "request_ip", None)
		get_login_attempt_tracker(user, raise_locked_exception=False).add_success_attempt()
		for key in {user, username}:
			if key:
				security.reset_login_rate(key, None)
				if ip:
					security.reset_login_rate(key, ip)
	except Exception:
		pass
