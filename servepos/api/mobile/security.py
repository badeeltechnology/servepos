"""Device-token security for the ServePOS Waiter App (Mobile API v2).

Phones never hold an API key. A password login returns a random device token;
only its sha256 is stored in **ServePOS Device Session**. Every later request
sends ``Authorization: Bearer spw_...`` and :func:`validate_bearer` (registered
in ``auth_hooks``) turns it into ``frappe.session.user``.
"""

import hashlib
import secrets

import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, now_datetime

TOKEN_PREFIX = "spw_"
DEVICE_SESSION = "ServePOS Device Session"
SETTINGS = "ServePOS Mobile Settings"
WAITER_ROLE = "ServePOS Waiter"

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 5 * 60
TOUCH_EVERY_SECONDS = 60

DEFAULT_SESSION_DAYS = 30
DEFAULT_MAX_SESSION_DAYS = 180


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #


def get_settings():
	"""Mobile settings with defaults (works before the doctype is migrated)."""
	out = frappe._dict(
		session_days=DEFAULT_SESSION_DAYS,
		max_session_days=DEFAULT_MAX_SESSION_DAYS,
		disable_legacy_waiter_api=0,
		allow_cancel_pending=1,
		order_start_time=None,
		order_end_time=None,
	)
	try:
		if frappe.db.exists("DocType", SETTINGS):
			doc = frappe.get_cached_doc(SETTINGS)
			for key in out:
				val = doc.get(key)
				if val is not None and val != "":
					out[key] = val
	except Exception:
		pass
	out.session_days = cint(out.session_days) or DEFAULT_SESSION_DAYS
	out.max_session_days = cint(out.max_session_days) or DEFAULT_MAX_SESSION_DAYS
	return out


def legacy_api_guard():
	"""Call at the top of the old (shared-key) waiter-app endpoints."""
	if cint(get_settings().disable_legacy_waiter_api):
		frappe.throw(
			_("This version of the waiter app is no longer supported. Please update the app."),
			frappe.PermissionError,
		)


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #


def generate_token():
	return TOKEN_PREFIX + secrets.token_urlsafe(48)


def hash_token(token):
	return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _session_expired():
	frappe.throw(_("Your session has ended. Please log in again."), frappe.AuthenticationError)


def compute_expiry(created_on, now=None, settings=None):
	"""Sliding expiry: now + session_days, capped at created_on + max_session_days."""
	settings = settings or get_settings()
	now = now or now_datetime()
	sliding = add_days(now, settings.session_days)
	hard = add_days(get_datetime(created_on), settings.max_session_days)
	return min(get_datetime(sliding), get_datetime(hard))


def validate_token(token, ip=None, touch=True):
	"""Return the device session (dict) for a valid token or raise AuthenticationError.

	Pure validation, no request objects involved, so it can be unit-tested.
	When ``touch`` is set, last_seen/expires_on (sliding) are refreshed at most
	once per TOUCH_EVERY_SECONDS.
	"""
	if not token or not isinstance(token, str) or not token.startswith(TOKEN_PREFIX) or len(token) > 200:
		_session_expired()

	try:
		sess = frappe.db.get_value(
			DEVICE_SESSION,
			{"token_hash": hash_token(token)},
			["name", "user", "waiter", "revoked", "expires_on", "created_on", "last_seen", "last_ip"],
			as_dict=True,
		)
	except Exception as e:
		# before `bench migrate` the table does not exist yet: treat as logged out, not 500
		if frappe.db.is_table_missing(e) or frappe.db.is_missing_column(e):
			frappe.clear_messages()
			_session_expired()
		raise
	if not sess or cint(sess.revoked):
		_session_expired()

	now = now_datetime()
	settings = get_settings()
	if not sess.expires_on or get_datetime(sess.expires_on) <= now:
		_session_expired()
	if get_datetime(add_days(sess.created_on, settings.max_session_days)) <= now:
		_session_expired()

	enabled = frappe.db.get_value("User", sess.user, "enabled")
	if not cint(enabled):
		revoke(sess.name, "User disabled")
		_session_expired()

	waiter = frappe.db.get_value("ServePOS Waiter", {"user": sess.user}, ["name", "is_active"], as_dict=True)
	if not waiter or not cint(waiter.is_active) or WAITER_ROLE not in frappe.get_roles(sess.user):
		revoke(sess.name, "Waiter access removed")
		_session_expired()

	if touch:
		last = get_datetime(sess.last_seen) if sess.last_seen else None
		if not last or (now - last).total_seconds() >= TOUCH_EVERY_SECONDS or (ip and ip != sess.last_ip):
			new_exp = compute_expiry(sess.created_on, now, settings)
			frappe.db.set_value(
				DEVICE_SESSION,
				sess.name,
				{"last_seen": now, "expires_on": new_exp, "last_ip": ip or sess.last_ip},
				update_modified=False,
			)
			sess.expires_on = new_exp
			sess.last_seen = now
			sess.touched = True
	sess.waiter = waiter.name
	return sess


def revoke(session_name, reason):
	frappe.db.set_value(
		DEVICE_SESSION,
		session_name,
		{"revoked": 1, "revoked_reason": (reason or "")[:140], "fcm_token": None},
		update_modified=False,
	)


def validate_bearer():
	"""auth_hooks entry. Acts only on ``Authorization: Bearer spw_...``."""
	header = frappe.get_request_header("Authorization", "") or ""
	parts = header.split(" ")
	if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].startswith(TOKEN_PREFIX):
		return

	try:
		sess = validate_token(parts[1], ip=getattr(frappe.local, "request_ip", None))
	except frappe.AuthenticationError:
		# Persist a revoke done during validation, then fail the request.
		_commit_quietly()
		raise
	if sess.get("touched"):
		# GET requests are not committed by Frappe; this is the only write so far.
		_commit_quietly()

	form_dict = frappe.local.form_dict  # frappe.set_user() clears it
	frappe.set_user(sess.user)
	frappe.local.form_dict = form_dict
	frappe.local.servepos_device_session = sess.name


def _commit_quietly():
	try:
		frappe.db.commit()
	except Exception:
		pass


# --------------------------------------------------------------------------- #
# Who is calling
# --------------------------------------------------------------------------- #


def current_device_session():
	return getattr(frappe.local, "servepos_device_session", None)


def current_waiter():
	"""ServePOS Waiter doc (as dict) linked to frappe.session.user, or raise."""
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("Please log in"), frappe.AuthenticationError)
	if WAITER_ROLE not in frappe.get_roles(user):
		frappe.throw(_("Your user does not have the ServePOS Waiter role"), frappe.PermissionError)
	waiter = frappe.db.get_value(
		"ServePOS Waiter",
		{"user": user},
		["name", "waiter_name", "branch", "is_active", "servepos_visible_profiles"],
		as_dict=True,
	)
	if not waiter:
		frappe.throw(_("No waiter is linked to your user"), frappe.PermissionError)
	if not cint(waiter.is_active):
		frappe.throw(_("Your waiter profile is inactive"), frappe.PermissionError)
	return waiter


def waiter_profiles(waiter):
	"""POS Profiles the waiter may use.

	Waiter `servepos_visible_profiles` set -> exactly those profiles.
	Else waiter branch set -> enabled profiles of that branch.
	Else -> every enabled profile (same rule as registry.get_waiters).
	"""
	fields = ["name", "branch", "currency"]
	if frappe.get_meta("POS Profile").has_field("servepos_restaurant_display_name"):
		fields.append("servepos_restaurant_display_name")
	profiles = frappe.get_all("POS Profile", filters={"disabled": 0}, fields=fields, order_by="name asc")
	visible = [p.strip() for p in (waiter.get("servepos_visible_profiles") or "").split(",") if p.strip()]
	if visible:
		return [p for p in profiles if p.name in visible]
	if waiter.get("branch"):
		return [p for p in profiles if p.branch == waiter.branch]
	return profiles


def assert_profile_access(waiter, pos_profile):
	if not pos_profile or not isinstance(pos_profile, str):
		frappe.throw(_("pos_profile is required"))
	for p in waiter_profiles(waiter):
		if p.name == pos_profile:
			return p
	frappe.throw(_("You are not allowed to use POS Profile {0}").format(pos_profile), frappe.PermissionError)


# --------------------------------------------------------------------------- #
# Login rate limit (per username + IP)
# --------------------------------------------------------------------------- #


def _rate_key(usr, ip):
	return frappe.cache.make_key(f"servepos_mobile_login:{(usr or '').strip().lower()}:{ip or '-'}")


def check_login_rate(usr, ip):
	"""Count this attempt; raise once more than LOGIN_MAX_ATTEMPTS in the window."""
	key = _rate_key(usr, ip)
	count = cint(frappe.cache.incrby(key, 1))
	if count == 1:
		frappe.cache.expire(key, LOGIN_WINDOW_SECONDS)
	if count > LOGIN_MAX_ATTEMPTS:
		frappe.throw(
			_("Too many login attempts. Please wait a few minutes and try again."),
			frappe.TooManyRequestsError,
		)


def reset_login_rate(usr, ip):
	frappe.cache.delete(_rate_key(usr, ip))
