"""ServePOS Mobile API v2: guest calls (table QR "call waiter")."""

import frappe
from frappe import _
from frappe.utils import now_datetime

from servepos.api.mobile import security

CALL = "ServePOS Waiter Call"


def _call_row(name):
	if not name or not isinstance(name, str):
		frappe.throw(_("Call name is required"))
	row = frappe.db.get_value(
		CALL, name, ["name", "status", "accepted_by", "pos_profile", "table"], as_dict=True
	)
	if not row:
		frappe.throw(_("Call {0} not found").format(name), frappe.DoesNotExistError)
	return row


def _publish(name, status, accepted_by=None, table=None):
	try:
		frappe.publish_realtime(
			"servepos_waiter_call_update",
			{"call_name": name, "status": status, "accepted_by": accepted_by, "table": table},
			doctype=CALL,
			after_commit=True,
		)
	except Exception:
		pass


@frappe.whitelist(methods=["GET", "POST"])
def active(pos_profile=None):
	"""Pending and Accepted calls of the profile, newest first."""
	waiter = security.current_waiter()
	profile = security.assert_profile_access(waiter, pos_profile)
	calls = frappe.get_all(
		CALL,
		filters={"pos_profile": profile.name, "status": ["in", ["Pending", "Accepted"]]},
		fields=["name", "table", "call_time", "status", "accepted_by", "notes", "guest_name"],
		order_by="call_time desc",
		limit=100,
	)
	rooms = dict(
		frappe.get_all(
			"ServePOS Table",
			filters={"name": ["in", [c.table for c in calls] or [""]]},
			fields=["name", "room"],
			as_list=True,
			limit=0,
		)
	)
	return [
		{
			"name": c.name,
			"table": c.table,
			"room": rooms.get(c.table),
			"created": str(c.call_time) if c.call_time else None,
			"status": c.status,
			"accepted_by": c.accepted_by,
			"guest_note": " - ".join(x for x in (c.guest_name, c.notes) if x) or "",
		}
		for c in calls
	]


@frappe.whitelist(methods=["POST"])
def accept(name=None):
	"""First waiter wins. Others get {"ok": false, "accepted_by": "<waiter>"}."""
	waiter = security.current_waiter()
	row = _call_row(name)
	security.assert_profile_access(waiter, row.pos_profile)
	now = now_datetime()
	frappe.db.sql(
		f"""update `tab{CALL}` set status='Accepted', accepted_by=%(w)s, accepted_at=%(now)s,
			modified=%(now)s, modified_by=%(user)s
		where name=%(name)s and status='Pending' and ifnull(accepted_by, '')=''""",
		{"w": waiter.name, "now": now, "user": frappe.session.user, "name": row.name},
	)
	won = frappe.db._cursor.rowcount == 1
	if not won:
		cur = frappe.db.get_value(CALL, row.name, ["status", "accepted_by"], as_dict=True)
		if cur.status == "Accepted" and cur.accepted_by == waiter.name:
			return {"ok": True, "name": row.name, "status": "Accepted", "accepted_by": waiter.name}
		return {"ok": False, "name": row.name, "status": cur.status, "accepted_by": cur.accepted_by}

	_publish(row.name, "Accepted", waiter.name, row.table)
	try:
		from servepos.api.mobile import push

		push.enqueue_call_taken(row.name, waiter.name, row.pos_profile, row.table)
	except Exception:
		frappe.log_error(title="ServePOS push: call_taken")
	return {"ok": True, "name": row.name, "status": "Accepted", "accepted_by": waiter.name}


@frappe.whitelist(methods=["POST"])
def attended(name=None):
	"""The waiter who accepted the call has met the guest."""
	waiter = security.current_waiter()
	row = _call_row(name)
	security.assert_profile_access(waiter, row.pos_profile)
	if row.status == "Attended" and row.accepted_by == waiter.name:
		return {"ok": True, "name": row.name, "status": "Attended"}
	if row.status != "Accepted":
		frappe.throw(_("Only accepted calls can be marked as attended"))
	if row.accepted_by != waiter.name:
		frappe.throw(_("Only the waiter who accepted can mark this call as attended"), frappe.PermissionError)
	frappe.db.set_value(CALL, row.name, {"status": "Attended", "attended_at": now_datetime()})
	_publish(row.name, "Attended", waiter.name, row.table)
	return {"ok": True, "name": row.name, "status": "Attended"}
