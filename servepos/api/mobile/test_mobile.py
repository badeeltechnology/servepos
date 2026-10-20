"""End-to-end checks of the Waiter App API (Mobile API v2). Always rolled back.

Run as System Manager: /api/method/servepos.api.mobile.test_mobile.run
(or from the System Console: `from servepos.api.mobile.test_mobile import run; print(run())`).
"""

import secrets
import traceback
import uuid

import frappe
from frappe.utils import add_days, add_to_date, flt, get_datetime, now_datetime

from servepos.api.mobile import auth, calls, push, security, waiter

PREFIX = "zz-mobile-test"
MOD_GROUP = "ZZ Mobile Test Extras"


class Log:
	def __init__(self):
		self.steps = []

	def check(self, cond, step, detail=""):
		self.steps.append({"ok": bool(cond), "step": step, "detail": str(detail)[:300]})


def expect_error(log, step, exc, fn, *a, **kw):
	try:
		fn(*a, **kw)
		log.check(False, step, "no error raised")
	except Exception as e:
		frappe.clear_messages()
		ok = isinstance(e, exc) if exc else True
		log.check(ok, step, f"{type(e).__name__}: {str(e)[:120]}")


def cid():
	return str(uuid.uuid4())


def as_device(user, session_name):
	frappe.set_user(user)
	frappe.local.role_cache = {}
	frappe.local.servepos_device_session = session_name


def make_user(tag, pwd, role=True):
	email = f"{PREFIX}-{tag}@example.com"
	doc = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": f"Mobile Test {tag.upper()}",
			"send_welcome_email": 0,
			"new_password": pwd,
			"roles": [{"role": security.WAITER_ROLE}] if role else [],
		}
	)
	doc.flags.ignore_password_policy = True
	doc.insert(ignore_permissions=True)
	return email


def make_waiter(name, user, profile):
	frappe.get_doc(
		{
			"doctype": "ServePOS Waiter",
			"waiter_name": name,
			"pin": "9876",
			"is_active": 1,
			"user": user,
			"servepos_visible_profiles": profile,
		}
	).insert(ignore_permissions=True)
	return name


def pick_profile():
	"""A profile with at least one active table and an available priced item."""
	for p in frappe.get_all("POS Profile", filters={"disabled": 0}, pluck="name", order_by="name asc"):
		menu = waiter.build_menu(p)
		items = [i for i in menu["items"] if i["is_available"] and i["rate"] > 0 and not i["modifier_groups"]]
		if menu["tables"] and items:
			return p, menu, items
	return None, None, None


def login(usr, pwd, device="dev-1"):
	return auth.login(
		usr=usr,
		pwd=pwd,
		device_id=device,
		device_name=f"Test {device}",
		platform="android",
		app_version="2.0.0",
	)


@frappe.whitelist(methods=["POST"])
def run():
	frappe.only_for("System Manager")
	admin = frappe.session.user
	saved_session = frappe._dict(frappe.local.session)
	ip = getattr(frappe.local, "request_ip", None)
	log = Log()
	frappe.flags.servepos_mobile_test = True
	pwd = "Mt!" + secrets.token_urlsafe(12)
	users = []
	try:
		profile, menu, items = pick_profile()
		log.check(profile, "Found a POS Profile with tables and priced items", profile)
		if not profile:
			raise Exception("no usable POS Profile")
		other_profile = frappe.get_all(
			"POS Profile", filters={"disabled": 0, "name": ["!=", profile]}, pluck="name", limit=1
		)
		table = menu["tables"][0]["name"]
		item = items[0]

		# a modifier group linked to the test item
		frappe.get_doc(
			{
				"doctype": "ServePOS Modifier Group",
				"group_name": MOD_GROUP,
				"selection_type": "Multiple",
				"max_selections": 1,
				"modifiers": [
					{"modifier_name": "Extra shot", "price": 3.5},
					{"modifier_name": "Syrup", "price": 2},
				],
			}
		).insert(ignore_permissions=True)
		frappe.get_doc(
			{
				"doctype": "ServePOS Item Modifier Group",
				"parent": item["item_code"],
				"parenttype": "Item",
				"parentfield": "servepos_modifier_groups",
				"modifier_group": MOD_GROUP,
				"idx": 99,
				"name": frappe.generate_hash(length=12),
				"creation": now_datetime(),
				"modified": now_datetime(),
				"owner": admin,
				"modified_by": admin,
			}
		).db_insert()

		ua, ub, uc, ud = (
			make_user("a", pwd),
			make_user("b", pwd),
			make_user("c", pwd, role=False),
			make_user("d", pwd),
		)
		users = [ua, ub, uc, ud]
		wa = make_waiter("ZZ Mobile Test A", ua, profile)
		wb = make_waiter("ZZ Mobile Test B", ub, profile)
		make_waiter("ZZ Mobile Test C", uc, profile)
		for u in users:
			security.reset_login_rate(u, ip)

		# ---- 1. login ------------------------------------------------------
		frappe.set_user("Guest")
		r = login(ua, pwd)
		tok_a = r["token"]
		log.check(
			tok_a.startswith("spw_") and len(tok_a) > 60, "Login returns a spw_ device token", len(tok_a)
		)
		log.check(
			set(r) >= {"token", "expires_on", "user", "pos_profiles", "default_pos_profile", "server"}
			and r["user"]["waiter"] == wa
			and r["user"]["user"] == ua,
			"Login response has the contract shape",
			sorted(r),
		)
		log.check(
			[p["name"] for p in r["pos_profiles"]] == [profile] and r["default_pos_profile"] == profile,
			"Login lists only the waiter's visible profiles",
			r["pos_profiles"],
		)
		sess_a = frappe.db.get_value(
			security.DEVICE_SESSION,
			{"token_hash": security.hash_token(tok_a)},
			["name", "user", "waiter", "owner"],
			as_dict=True,
		)
		log.check(
			sess_a and sess_a.user == ua and sess_a.waiter == wa and sess_a.owner == ua,
			"Device session stored for the waiter (owner = waiter user)",
			sess_a,
		)
		log.check(
			not frappe.db.exists(security.DEVICE_SESSION, {"token_hash": tok_a}),
			"Raw token is never stored, only its sha256",
		)
		log.check("token_hash" not in str(r), "Login response does not leak the token hash")

		from frappe.auth import get_login_attempt_tracker

		def reset_trackers(*keys):
			for k in keys:
				if k:
					get_login_attempt_tracker(k, raise_locked_exception=False).add_success_attempt()

		frappe.set_user("Guest")
		expect_error(log, "Wrong password is refused (401)", frappe.AuthenticationError, login, ua, pwd + "x")
		expect_error(
			log,
			"Unknown user is refused (401)",
			frappe.AuthenticationError,
			login,
			f"{PREFIX}-nobody@example.com",
			pwd,
		)
		expect_error(
			log, "User without the ServePOS Waiter role is refused", frappe.PermissionError, login, uc, pwd
		)
		expect_error(
			log, "User with role but no linked waiter is refused", frappe.PermissionError, login, ud, pwd
		)
		frappe.db.set_value("ServePOS Waiter", wb, "is_active", 0)
		expect_error(log, "Inactive waiter is refused", frappe.PermissionError, login, ub, pwd)
		frappe.db.set_value("ServePOS Waiter", wb, "is_active", 1)

		# rate limit: 5 attempts per 5 minutes per username + IP
		reset_trackers(ua, ip)
		security.reset_login_rate(ub, ip)
		for _i in range(5):
			try:
				login(ub, "wrong-" + pwd)
			except Exception:
				frappe.clear_messages()
		expect_error(
			log,
			"6th attempt within 5 minutes is rate limited (even with the right password)",
			frappe.TooManyRequestsError,
			login,
			ub,
			pwd,
		)
		security.reset_login_rate(ub, ip)
		reset_trackers(ub, ip)
		r = login(ub, pwd)
		tok_b = r["token"]
		sess_b = frappe.db.get_value(
			security.DEVICE_SESSION, {"token_hash": security.hash_token(tok_b)}, "name"
		)
		log.check(sess_b, "Login works again after the window is reset")

		# re-login on the same device replaces the session
		r2 = login(ua, pwd)
		old = frappe.db.get_value(
			security.DEVICE_SESSION, sess_a.name, ["revoked", "revoked_reason"], as_dict=True
		)
		log.check(old.revoked == 1, "Re-login on the same device revokes the old session", old)
		expect_error(
			log,
			"Old token stops working after re-login",
			frappe.AuthenticationError,
			security.validate_token,
			tok_a,
			touch=False,
		)
		tok_a = r2["token"]
		sess_a = frappe.db.get_value(
			security.DEVICE_SESSION, {"token_hash": security.hash_token(tok_a)}, "name"
		)

		# ---- 2. validate_token ---------------------------------------------
		s = security.validate_token(tok_a, ip="10.0.0.5")
		log.check(s.user == ua and s.waiter == wa, "validate_token accepts a valid token", s.user)
		expect_error(
			log,
			"validate_token rejects garbage",
			frappe.AuthenticationError,
			security.validate_token,
			"spw_nope",
		)
		expect_error(
			log,
			"validate_token rejects a non-spw token",
			frappe.AuthenticationError,
			security.validate_token,
			"abc",
		)

		r3 = login(ua, pwd, device="dev-exp")
		n3 = frappe.db.get_value(
			security.DEVICE_SESSION, {"token_hash": security.hash_token(r3["token"])}, "name"
		)
		frappe.db.set_value(
			security.DEVICE_SESSION, n3, "expires_on", add_to_date(now_datetime(), minutes=-1)
		)
		expect_error(
			log, "Expired token is rejected", frappe.AuthenticationError, security.validate_token, r3["token"]
		)
		frappe.db.set_value(
			security.DEVICE_SESSION,
			n3,
			{"expires_on": add_days(now_datetime(), 10), "created_on": add_days(now_datetime(), -181)},
		)
		expect_error(
			log,
			"Token older than the 180-day hard cap is rejected",
			frappe.AuthenticationError,
			security.validate_token,
			r3["token"],
		)

		r4 = login(ua, pwd, device="dev-rev")
		n4 = frappe.db.get_value(
			security.DEVICE_SESSION, {"token_hash": security.hash_token(r4["token"])}, "name"
		)
		d4 = frappe.get_doc(security.DEVICE_SESSION, n4)
		d4.revoked = 1
		d4.save(ignore_permissions=True)
		expect_error(
			log,
			"Token revoked in Desk is rejected",
			frappe.AuthenticationError,
			security.validate_token,
			r4["token"],
		)

		r5 = login(ub, pwd, device="dev-dis")
		frappe.db.set_value("User", ub, "enabled", 0)
		expect_error(
			log,
			"Token of a disabled user is rejected",
			frappe.AuthenticationError,
			security.validate_token,
			r5["token"],
		)
		frappe.db.set_value("User", ub, "enabled", 1)
		n5 = frappe.db.get_value(
			security.DEVICE_SESSION, {"token_hash": security.hash_token(r5["token"])}, "revoked"
		)
		log.check(n5 == 1, "Disabled user's session is revoked")

		# sliding expiry
		frappe.db.set_value(
			security.DEVICE_SESSION,
			sess_a,
			{"last_seen": add_to_date(now_datetime(), minutes=-5), "expires_on": add_days(now_datetime(), 1)},
		)
		security.validate_token(tok_a)
		exp = get_datetime(frappe.db.get_value(security.DEVICE_SESSION, sess_a, "expires_on"))
		log.check(
			exp > add_days(now_datetime(), 29), "Sliding expiry: use pushes expires_on to ~30 days", exp
		)
		frappe.db.set_value(security.DEVICE_SESSION, sess_a, "expires_on", add_days(now_datetime(), 2))
		s = security.validate_token(tok_a)
		exp2 = get_datetime(frappe.db.get_value(security.DEVICE_SESSION, sess_a, "expires_on"))
		log.check(
			exp2 < add_days(now_datetime(), 3) and not s.get("touched"),
			"No extra write within a minute of the last touch",
			exp2,
		)

		# ---- 3. me / sessions / profile access -------------------------------
		as_device(ua, sess_a)
		me = auth.me()
		log.check(
			me["user"]["waiter"] == wa and "token" not in me and me["expires_on"],
			"me() returns the login shape without the token",
		)
		sl = auth.sessions()
		log.check(
			any(x["current"] for x in sl) and all("token_hash" not in x for x in sl),
			"sessions() lists own devices, marks current",
			len(sl),
		)
		if other_profile:
			expect_error(
				log,
				"Profile not visible to the waiter is refused",
				frappe.PermissionError,
				waiter.bootstrap,
				other_profile[0],
			)
		frappe.set_user(uc)
		frappe.local.role_cache = {}
		expect_error(
			log,
			"API refuses a user without the waiter role",
			frappe.PermissionError,
			waiter.bootstrap,
			profile,
		)

		# ---- 4. bootstrap ----------------------------------------------------
		as_device(ua, sess_a)
		b = waiter.bootstrap(profile)
		keys = {
			"version",
			"currency",
			"currency_precision",
			"settings",
			"item_groups",
			"items",
			"modifier_groups",
			"rooms",
			"tables",
		}
		log.check(keys <= set(b), "bootstrap has the contract keys", sorted(set(b)))
		bi = next((i for i in b["items"] if i["item_code"] == item["item_code"]), None)
		log.check(
			bi
			and MOD_GROUP in bi["modifier_groups"]
			and set(bi)
			>= {
				"item_code",
				"item_name",
				"item_name_ar",
				"item_group",
				"rate",
				"image",
				"description",
				"is_available",
				"modifier_groups",
				"sort",
			},
			"bootstrap item shape incl. linked modifier group",
			bi and bi["modifier_groups"],
		)
		mg = next((g for g in b["modifier_groups"] if g["name"] == MOD_GROUP), None)
		log.check(
			mg
			and {"name": "Extra shot", "price": 3.5, "is_default": False} in mg["modifiers"]
			and mg["max_selections"] == 1
			and mg["selection_type"] == "Multiple",
			"bootstrap modifier group shape",
			mg,
		)
		log.check(
			set(b["settings"]) == {"order_start_time", "order_end_time", "allow_cancel_pending"},
			"bootstrap settings shape",
			b["settings"],
		)
		log.check(
			waiter.bootstrap(profile, version=b["version"]) == {"version": b["version"], "unchanged": True},
			"bootstrap returns unchanged for the same version",
		)

		# ---- 5. create_order: server pricing, modifiers, idempotency ---------
		rate = flt(item["rate"])
		prec = waiter._precision()
		c1 = cid()
		lines = [
			{
				"item_code": item["item_code"],
				"qty": 2,
				"rate": 0.01,
				"item_name": "HACK",
				"modifiers": [{"group": MOD_GROUP, "name": "Extra shot", "price": 0}],
				"modifier_total": 0,
				"special_instructions": "x" * 900,
			}
		]
		o = waiter.create_order(profile, c1, "Dine In", table, None, 3, "first", lines)
		it = o["items"][0]
		log.check(
			it["rate"] == rate and it["item_name"] != "HACK",
			"Server price ignores the client rate",
			f"{it['rate']} vs {rate}",
		)
		log.check(
			it["modifiers"] == [{"group": MOD_GROUP, "name": "Extra shot", "price": 3.5}]
			and it["modifier_total"] == 3.5,
			"Modifier priced from master data",
			it["modifiers"],
		)
		log.check(
			it["amount"] == flt((rate + 3.5) * 2, prec) and o["total"] == it["amount"],
			"Amount and total computed on the server",
			o["total"],
		)
		log.check(len(it["special_instructions"]) == 500, "special_instructions capped at 500 chars")
		log.check(
			o["status"] == "Pending"
			and o["waiter"] == wa
			and o["table"] == table
			and o["guests"] == 3
			and o["currency"],
			"Order shape (status, waiter, table, guests, currency)",
			{k: o[k] for k in ("status", "waiter", "table", "guests", "currency")},
		)
		dbo = frappe.db.get_value(
			waiter.WO, o["name"], ["waiter", "waiter_name", "pos_profile", "branch", "status"], as_dict=True
		)
		log.check(
			dbo.waiter == ua and dbo.waiter_name == wa and dbo.status == "Pending",
			"Stored in ServePOS Waiter Order as the desktop POS expects",
			dbo,
		)
		o_again = waiter.create_order(profile, c1, "Dine In", table, None, 3, "first", lines)
		log.check(
			o_again["name"] == o["name"] and frappe.db.count(waiter.WO, {"client_request_id": c1}) == 1,
			"Same client_request_id twice -> one order",
		)
		expect_error(
			log,
			"Unknown modifier is refused",
			frappe.ValidationError,
			waiter.create_order,
			profile,
			cid(),
			"Dine In",
			table,
			None,
			1,
			"",
			[
				{
					"item_code": item["item_code"],
					"qty": 1,
					"modifiers": [{"group": MOD_GROUP, "name": "Gold leaf"}],
				}
			],
		)
		expect_error(
			log,
			"Unknown item is refused",
			frappe.ValidationError,
			waiter.create_order,
			profile,
			cid(),
			"Dine In",
			table,
			None,
			1,
			"",
			[{"item_code": "ZZ-NO-SUCH-ITEM", "qty": 1}],
		)
		expect_error(
			log,
			"More modifiers than max_selections is refused",
			frappe.ValidationError,
			waiter.create_order,
			profile,
			cid(),
			"Dine In",
			table,
			None,
			1,
			"",
			[
				{
					"item_code": item["item_code"],
					"qty": 1,
					"modifiers": [
						{"group": MOD_GROUP, "name": "Extra shot"},
						{"group": MOD_GROUP, "name": "Syrup"},
					],
				}
			],
		)
		expect_error(
			log,
			"Dine In without a table is refused",
			frappe.ValidationError,
			waiter.create_order,
			profile,
			cid(),
			"Dine In",
			None,
			None,
			1,
			"",
			[{"item_code": item["item_code"], "qty": 1}],
		)
		expect_error(
			log,
			"Missing client_request_id is refused",
			frappe.ValidationError,
			waiter.create_order,
			profile,
			None,
			"Dine In",
			table,
			None,
			1,
			"",
			[{"item_code": item["item_code"], "qty": 1}],
		)
		expect_error(
			log,
			"Zero qty is refused",
			frappe.ValidationError,
			waiter.create_order,
			profile,
			cid(),
			"Dine In",
			table,
			None,
			1,
			"",
			[{"item_code": item["item_code"], "qty": 0}],
		)

		# ---- 6. add_items round ---------------------------------------------
		as_device(ub, sess_b)
		c2 = cid()
		o2 = waiter.add_items(o["name"], c2, [{"item_code": item["item_code"], "qty": 1}])
		r2_items = [i for i in o2["items"] if i["round"] == 2]
		log.check(
			o2["name"] == o["name"]
			and len(r2_items) == 1
			and r2_items[0]["added_by"] == wb
			and len(o2["items"]) == 2,
			"add_items adds round 2, recorded as added by the other waiter",
			[(i["round"], i["added_by"]) for i in o2["items"]],
		)
		round_doc = frappe.db.get_value(
			waiter.WO, {"client_request_id": c2}, ["name", "parent_order", "status", "round_no"], as_dict=True
		)
		log.check(
			round_doc.parent_order == o["name"] and round_doc.status == "Pending" and round_doc.round_no == 2,
			"Round is its own Pending waiter order for the till",
			round_doc,
		)
		o2b = waiter.add_items(o["name"], c2, [{"item_code": item["item_code"], "qty": 1}])
		log.check(
			len(o2b["items"]) == 2 and frappe.db.count(waiter.WO, {"parent_order": o["name"]}) == 1,
			"Repeated add_items request id -> no extra round",
		)
		log.check(o2["total"] == flt(it["amount"] + rate, prec), "Order total folds all rounds", o2["total"])

		# ---- 7. my_orders / order / tables -----------------------------------
		as_device(ua, sess_a)
		c3 = cid()
		o3 = waiter.create_order(
			profile, c3, "Takeaway", None, None, 1, "", [{"item_code": item["item_code"], "qty": 1}]
		)
		mine_a = [x["name"] for x in waiter.my_orders(profile, "mine", 1)]
		log.check(
			o["name"] in mine_a and o3["name"] in mine_a and round_doc.name not in mine_a,
			"my_orders(mine) lists my orders, rounds folded",
			mine_a[:5],
		)
		as_device(ub, sess_b)
		mine_b = [x["name"] for x in waiter.my_orders(profile, "mine", 1)]
		all_b = [x["name"] for x in waiter.my_orders(profile, "all", 1)]
		log.check(
			o["name"] not in mine_b and o["name"] in all_b,
			"my_orders: other waiter's order only under scope=all",
		)
		log.check(
			waiter.order(round_doc.name)["name"] == o["name"], "order(name of a round) returns the main order"
		)
		tb = {t["name"]: t for t in waiter.tables(profile)}
		log.check(
			tb[table]["status"] == "Occupied" and (tb[table]["order"] or {}).get("order") == o["name"],
			"tables() shows the table Occupied with the open order",
			tb[table]["order"],
		)

		# ---- 8. cancel rules --------------------------------------------------
		expect_error(
			log,
			"Another waiter cannot cancel my order",
			frappe.PermissionError,
			waiter.cancel_order,
			o["name"],
			"no",
		)
		as_device(ua, sess_a)
		frappe.db.set_value(waiter.WO, o3["name"], "status", "Accepted")
		expect_error(
			log,
			"Accepted order cannot be cancelled",
			frappe.ValidationError,
			waiter.cancel_order,
			o3["name"],
			"late",
		)
		frappe.db.set_single_value(security.SETTINGS, "allow_cancel_pending", 0)
		frappe.clear_document_cache(security.SETTINGS, security.SETTINGS)
		expect_error(
			log,
			"Cancel refused when allow_cancel_pending is off",
			frappe.PermissionError,
			waiter.cancel_order,
			o["name"],
			"x",
		)
		frappe.db.set_single_value(security.SETTINGS, "allow_cancel_pending", 1)
		frappe.clear_document_cache(security.SETTINGS, security.SETTINGS)
		oc = waiter.cancel_order(o["name"], "guest left")
		log.check(
			oc["status"] == "Cancelled"
			and frappe.db.get_value(waiter.WO, round_doc.name, "status") == "Cancelled",
			"Own Pending order cancels, with its pending rounds",
		)
		expect_error(
			log,
			"add_items to a cancelled order is refused",
			frappe.ValidationError,
			waiter.add_items,
			o["name"],
			cid(),
			[{"item_code": item["item_code"], "qty": 1}],
		)

		# ---- 9. calls ------------------------------------------------------
		call = frappe.get_doc(
			{
				"doctype": "ServePOS Waiter Call",
				"table": table,
				"pos_profile": profile,
				"status": "Pending",
				"notes": "water please",
			}
		).insert(ignore_permissions=True)
		act = calls.active(profile)
		row = next((c for c in act if c["name"] == call.name), None)
		log.check(
			row and set(row) == {"name", "table", "room", "created", "status", "accepted_by", "guest_note"},
			"calls.active shape",
			row,
		)
		r1 = calls.accept(call.name)
		as_device(ub, sess_b)
		r2c = calls.accept(call.name)
		log.check(
			r1["ok"] is True
			and r2c == {"ok": False, "name": call.name, "status": "Accepted", "accepted_by": wa},
			"Call accept: first waiter wins, second gets ok:false + accepted_by",
			r2c,
		)
		expect_error(
			log,
			"Only the accepting waiter can mark attended",
			frappe.PermissionError,
			calls.attended,
			call.name,
		)
		as_device(ua, sess_a)
		log.check(
			calls.attended(call.name)["ok"] is True
			and frappe.db.get_value("ServePOS Waiter Call", call.name, "status") == "Attended",
			"Accepting waiter marks attended",
		)

		# ---- 10. legacy switch -------------------------------------------
		frappe.db.set_single_value(security.SETTINGS, "disable_legacy_waiter_api", 1)
		frappe.clear_document_cache(security.SETTINGS, security.SETTINGS)
		from servepos.api import waiter as legacy

		expect_error(
			log,
			"Legacy key-based endpoint refused when disabled",
			frappe.PermissionError,
			legacy.get_my_orders,
			wa,
		)
		frappe.db.set_single_value(security.SETTINGS, "disable_legacy_waiter_api", 0)
		frappe.clear_document_cache(security.SETTINGS, security.SETTINGS)

		# ---- 11. push register + logout ------------------------------------
		push.register("fcm-test-token-123", "android")
		log.check(
			frappe.db.get_value(security.DEVICE_SESSION, sess_a, "fcm_token") == "fcm-test-token-123",
			"push.register binds the FCM token to the device session",
		)
		log.check(
			push.tokens_for_profile(profile) == ["fcm-test-token-123"]
			or "fcm-test-token-123" in push.tokens_for_profile(profile),
			"Push recipients for the profile include the device",
		)
		log.check(auth.logout() == {"ok": True}, "logout returns ok")
		lo = frappe.db.get_value(security.DEVICE_SESSION, sess_a, ["revoked", "fcm_token"], as_dict=True)
		log.check(
			lo.revoked == 1 and not lo.fcm_token, "logout revokes the session and clears the push token", lo
		)
		expect_error(
			log, "Token is rejected after logout", frappe.AuthenticationError, security.validate_token, tok_a
		)

		# ---- 12. admin revoke-all ----------------------------------------
		frappe.set_user(admin)
		frappe.local.servepos_device_session = None
		rv = auth.revoke_all_for_waiter(wb)
		log.check(
			rv["revoked"] >= 1
			and not frappe.db.exists(security.DEVICE_SESSION, {"waiter": wb, "revoked": 0}),
			"revoke_all_for_waiter logs every phone of the waiter out",
			rv,
		)
	except Exception:
		log.check(False, "Unexpected error", traceback.format_exc()[-2000:])
	finally:
		frappe.flags.servepos_mobile_test = False
		frappe.local.servepos_device_session = None
		frappe.set_user(admin)
		frappe.local.session = saved_session
		frappe.db.rollback()
		try:
			from frappe.auth import get_login_attempt_tracker

			for u in users:
				security.reset_login_rate(u, ip)
				get_login_attempt_tracker(u, raise_locked_exception=False).add_success_attempt()
			security.reset_login_rate(f"{PREFIX}-nobody@example.com", ip)
			if ip:
				get_login_attempt_tracker(ip, raise_locked_exception=False).add_success_attempt()
			frappe.clear_document_cache(security.SETTINGS, security.SETTINGS)
		except Exception:
			pass
	return {
		"passed": sum(1 for s in log.steps if s["ok"]),
		"failed": sum(1 for s in log.steps if not s["ok"]),
		"steps": log.steps,
	}
