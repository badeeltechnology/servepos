"""ServePOS Mobile API v2: FCM push to waiter devices.

Tokens live on the waiter's ServePOS Device Session (bound at register, cleared
on logout/revoke). Sending is always queued and never fails the caller; if
Firebase is not configured nothing is sent.

Data payload: type (waiter_call | order_ready | order_accepted | order_rejected |
call_taken), name, table, title, body, plus channel (calls | orders | general).
"""

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from servepos.api.mobile import security

CHANNELS = {
	"waiter_call": "calls",
	"call_taken": "general",
	"order_ready": "orders",
	"order_accepted": "orders",
	"order_rejected": "orders",
}


@frappe.whitelist(methods=["POST"])
def register(token=None, platform=None):
	"""Bind the phone's FCM token to the calling device session."""
	security.current_waiter()
	name = security.current_device_session()
	if not name:
		frappe.throw(_("Push registration needs a waiter app login"), frappe.PermissionError)
	if not token or not isinstance(token, str) or len(token) > 4096:
		frappe.throw(_("Invalid push token"))
	# the same phone token must not stay on another (older) session
	for other in frappe.get_all(
		security.DEVICE_SESSION, filters={"fcm_token": token, "name": ["!=", name]}, pluck="name"
	):
		frappe.db.set_value(security.DEVICE_SESSION, other, "fcm_token", None, update_modified=False)
	values = {"fcm_token": token}
	if platform and isinstance(platform, str):
		values["platform"] = platform.strip()[:40]
	frappe.db.set_value(security.DEVICE_SESSION, name, values, update_modified=False)
	return {"ok": True}


def fcm_configured():
	return bool(
		frappe.conf.get("servepos_fcm_credentials_file") or frappe.conf.get("servepos_fcm_credentials")
	)


# --------------------------------------------------------------------------- #
# Recipients
# --------------------------------------------------------------------------- #


def _active_sessions(filters):
	filters = dict(filters)
	filters.update({"revoked": 0, "expires_on": [">", now_datetime()], "fcm_token": ["is", "set"]})
	return frappe.get_all(
		security.DEVICE_SESSION, filters=filters, fields=["name", "user", "waiter", "fcm_token"], limit=0
	)


def tokens_for_profile(pos_profile, exclude_waiter=None):
	"""FCM tokens of active device sessions whose waiter may use this profile."""
	out = []
	waiters = {}
	for s in _active_sessions({}):
		if exclude_waiter and s.waiter == exclude_waiter:
			continue
		if s.waiter not in waiters:
			w = frappe.db.get_value(
				"ServePOS Waiter",
				s.waiter,
				["name", "branch", "is_active", "servepos_visible_profiles"],
				as_dict=True,
			)
			waiters[s.waiter] = bool(
				w and cint(w.is_active) and any(p.name == pos_profile for p in security.waiter_profiles(w))
			)
		if waiters[s.waiter]:
			out.append(s.fcm_token)
	return list(dict.fromkeys(out))


def tokens_for_user(user):
	return list(dict.fromkeys(s.fcm_token for s in _active_sessions({"user": user})))


# --------------------------------------------------------------------------- #
# Sending
# --------------------------------------------------------------------------- #


def send(tokens, msg_type, name="", table="", title="", body=""):
	"""Send one data message per token. Returns (sent, failed). Never raises."""
	if not tokens or not fcm_configured():
		return 0, 0
	try:
		from servepos.api.fcm import _get_access_token

		result = _get_access_token()
		if not result:
			return 0, len(tokens)
		access_token, project_id = result
		import requests

		url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
		headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
		channel = CHANNELS.get(msg_type, "general")
		data = {
			"type": msg_type,
			"name": str(name or ""),
			"table": str(table or ""),
			"title": str(title or ""),
			"body": str(body or ""),
			"channel": channel,
		}
		sent = failed = 0
		for token in tokens:
			payload = {
				"message": {
					"token": token,
					"data": data,
					"android": {"priority": "high", "ttl": "300s" if msg_type == "waiter_call" else "3600s"},
				}
			}
			try:
				resp = requests.post(url, headers=headers, json=payload, timeout=5)
				if resp.status_code == 200:
					sent += 1
				else:
					failed += 1
					if resp.status_code == 404 or "UNREGISTERED" in (resp.text or ""):
						_drop_token(token)
			except Exception:
				failed += 1
		return sent, failed
	except Exception:
		frappe.log_error(title="ServePOS push send")
		return 0, len(tokens)


def _drop_token(token):
	for n in frappe.get_all(security.DEVICE_SESSION, filters={"fcm_token": token}, pluck="name"):
		frappe.db.set_value(security.DEVICE_SESSION, n, "fcm_token", None, update_modified=False)


def _table_label(table):
	if not table:
		return ""
	return frappe.db.get_value("ServePOS Table", table, "table_name") or table


# --- jobs (run in the background queue) ------------------------------------ #


def job_waiter_call(call_name, pos_profile, table, guest_name=None):
	label = _table_label(table)
	body = (
		_("{0} at {1} needs assistance").format(guest_name, label)
		if guest_name
		else _("Guest at {0} needs assistance").format(label)
	)
	send(tokens_for_profile(pos_profile), "waiter_call", call_name, table, _("Call: {0}").format(label), body)


def job_call_taken(call_name, accepted_by, pos_profile, table):
	label = _table_label(table)
	send(
		tokens_for_profile(pos_profile, exclude_waiter=accepted_by),
		"call_taken",
		call_name,
		table,
		_("{0} is taken").format(label),
		_("{0} is attending {1}").format(accepted_by, label),
	)


def job_order_status(order_name, msg_type):
	o = frappe.db.get_value(
		"ServePOS Waiter Order", order_name, ["waiter", "table", "status", "parent_order"], as_dict=True
	)
	if not o or not o.waiter:
		return
	label = _table_label(o.table) or _("Takeaway")
	main = o.parent_order or order_name
	titles = {
		"order_ready": (_("Order ready: {0}").format(label), _("{0} is ready to serve").format(main)),
		"order_accepted": (
			_("Order accepted: {0}").format(label),
			_("{0} was accepted at the till").format(main),
		),
		"order_rejected": (
			_("Order rejected: {0}").format(label),
			_("{0} was rejected at the till").format(main),
		),
	}
	title, body = titles.get(msg_type, ("", ""))
	send(tokens_for_user(o.waiter), msg_type, main, o.table, title, body)


# --- enqueue helpers (safe to call from request code) ----------------------- #


def _enqueue(method, **kwargs):
	if not fcm_configured():
		return
	try:
		frappe.enqueue(method, queue="short", enqueue_after_commit=True, **kwargs)
	except Exception:
		frappe.log_error(title="ServePOS push enqueue")


def enqueue_waiter_call(call_name, pos_profile, table, guest_name=None):
	_enqueue(
		"servepos.api.mobile.push.job_waiter_call",
		call_name=call_name,
		pos_profile=pos_profile,
		table=table,
		guest_name=guest_name,
	)


def enqueue_call_taken(call_name, accepted_by, pos_profile, table):
	_enqueue(
		"servepos.api.mobile.push.job_call_taken",
		call_name=call_name,
		accepted_by=accepted_by,
		pos_profile=pos_profile,
		table=table,
	)


def enqueue_order_status(order_name, msg_type):
	_enqueue("servepos.api.mobile.push.job_order_status", order_name=order_name, msg_type=msg_type)


def on_waiter_order_update(doc, method=None):
	"""doc_events hook on ServePOS Waiter Order: tell the waiter about till decisions."""
	before = doc.get_doc_before_save()
	if not before or before.status == doc.status:
		return
	if doc.status == "Accepted":
		enqueue_order_status(doc.name, "order_accepted")
	elif doc.status == "Ready":
		enqueue_order_status(doc.name, "order_ready")
	elif doc.status == "Cancelled" and not doc.flags.servepos_cancelled_by_waiter:
		enqueue_order_status(doc.name, "order_rejected")
