"""Checks of the waiter app login admin (servepos.api.mobile.admin). Always rolled back.

Run: bench --site <site> execute servepos.api.mobile.test_admin.run
"""

import secrets
import traceback

import frappe

from servepos.api.mobile import admin, auth, security
from servepos.api.mobile.test_mobile import Log, expect_error, make_waiter, pick_profile

PREFIX = "zz-admin-test"


def _login(usr, pwd, device="adm-dev-1"):
	return auth.login(
		usr=usr, pwd=pwd, device_id=device, device_name=f"Test {device}", platform="android", app_version="2.0.0"
	)


def _make_staff(tag, roles):
	doc = frappe.get_doc(
		{
			"doctype": "User",
			"email": f"{PREFIX}-{tag}@example.com",
			"first_name": f"Admin Test {tag}",
			"send_welcome_email": 0,
			"roles": [{"role": r} for r in roles],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist(methods=["POST"])
def run():
	frappe.only_for("System Manager")
	me = frappe.session.user
	saved_session = frappe._dict(frappe.local.session)
	ip = getattr(frappe.local, "request_ip", None)
	log = Log()
	frappe.flags.servepos_mobile_test = True
	tag = secrets.token_hex(2)
	uname = f"zzwaiter.{tag}"
	pwd1, pwd2 = "start1", "second2"
	try:
		profile, _menu, _items = pick_profile()
		log.check(profile, "Found a usable POS Profile", profile)
		if not profile:
			raise Exception("no usable POS Profile")
		w = make_waiter(f"ZZ Admin Test {tag}", None, profile)
		w2 = make_waiter(f"ZZ Admin Test2 {tag}", None, profile)
		manager = _make_staff("mgr", ["ServePOS Manager"])
		cashier = _make_staff("cashier", ["ServePOS Cashier"])

		# ---- permissions ----------------------------------------------------
		frappe.set_user(cashier)
		expect_error(log, "A user without POS manager rights is refused (status)", frappe.PermissionError,
			admin.app_login_status, w)
		expect_error(log, "A user without POS manager rights is refused (create)", frappe.PermissionError,
			admin.create_app_login, w, uname, pwd1)

		# ---- create as ServePOS Manager -------------------------------------
		frappe.set_user(manager)
		st = admin.app_login_status(w)
		log.check(st["has_login"] is False, "No login before creation", st)
		expect_error(log, "Username with bad characters is refused", frappe.ValidationError,
			admin.create_app_login, w, "Bad Name!", pwd1)
		expect_error(log, "Password shorter than 6 is refused", frappe.ValidationError,
			admin.create_app_login, w, uname, "abc")
		expect_error(log, "Password equal to the username is refused", frappe.ValidationError,
			admin.create_app_login, w, uname, uname)

		r = admin.create_app_login(w, uname, pwd1)
		user = r["user"]
		u = frappe.db.get_value("User", user, ["username", "email", "user_type", "enabled"], as_dict=True)
		log.check(r["has_login"] and r["username"] == uname, "ServePOS Manager creates a login with a username", r)
		log.check(
			u.email.endswith("@waiter.servepos.invalid") and u.email.startswith(uname + "."),
			"Placeholder email is generated on the .invalid domain", u.email,
		)
		log.check(
			set(frappe.get_roles(user)) <= admin.WAITER_SAFE_ROLES,
			"Waiter user gets no role besides ServePOS Waiter", (u.user_type, frappe.get_roles(user)),
		)
		log.check(security.WAITER_ROLE in frappe.get_roles(user), "Waiter user has the ServePOS Waiter role")
		log.check(frappe.db.get_value("ServePOS Waiter", w, "user") == user, "User is linked on the waiter")
		log.check(r.get("site_url"), "Create returns the server URL to give the waiter", r.get("site_url"))

		expect_error(log, "Second login for the same waiter is refused", frappe.ValidationError,
			admin.create_app_login, w, uname + "x", pwd1)
		expect_error(log, "Duplicate username is refused", frappe.DuplicateEntryError,
			admin.create_app_login, w2, uname, pwd1)
		expect_error(log, "Duplicate username is refused (case-insensitive)", frappe.DuplicateEntryError,
			admin.create_app_login, w2, uname.upper(), pwd1)

		ov = admin.app_login_overview()
		log.check(ov.get(w, {}).get("username") == uname, "Overview lists the waiter's login", ov.get(w))

		# ---- login with the plain username ---------------------------------
		frappe.set_user("Guest")
		r1 = _login(uname, pwd1, "adm-dev-1")
		tok1 = r1["token"]
		log.check(r1["user"]["waiter"] == w, "auth.login accepts the plain username", r1["user"])
		frappe.set_user("Guest")
		r1b = _login(uname.upper(), pwd1, "adm-dev-2")
		log.check(r1b["user"]["user"] == user, "Username login is case-insensitive")
		tok1b = r1b["token"]
		frappe.set_user("Guest")
		expect_error(log, "Wrong password is refused", frappe.AuthenticationError, _login, uname, "nope123")

		frappe.set_user(manager)
		st = admin.app_login_status(w)
		log.check(len(st["devices"]) == 2, "Status lists both signed-in phones", len(st["devices"]))

		# ---- password reset ------------------------------------------------
		expect_error(log, "Reset to a too-short password is refused", frappe.ValidationError,
			admin.reset_app_password, w, "123")
		rr = admin.reset_app_password(w, pwd2)
		log.check(rr["revoked"] == 2, "Password reset signs out every phone", rr)
		expect_error(log, "Old token is rejected after the reset", frappe.AuthenticationError,
			security.validate_token, tok1)
		frappe.set_user("Guest")
		expect_error(log, "Old password no longer works", frappe.AuthenticationError, _login, uname, pwd1)
		security.reset_login_rate(uname, ip)
		r2 = _login(uname, pwd2, "adm-dev-1")
		log.check(r2.get("token"), "New password works")
		tok2 = r2["token"]

		# ---- disable / enable ----------------------------------------------
		frappe.set_user(manager)
		d = admin.set_app_login_enabled(w, 0)
		log.check(d["enabled"] == 0 and d["revoked"] >= 1, "Disable signs the phone out", d)
		expect_error(log, "Token is rejected after disable", frappe.AuthenticationError,
			security.validate_token, tok2)
		frappe.set_user("Guest")
		security.reset_login_rate(uname, ip)
		expect_error(log, "Disabled login cannot sign in", frappe.AuthenticationError, _login, uname, pwd2)
		frappe.set_user(manager)
		admin.set_app_login_enabled(w, 1)
		frappe.set_user("Guest")
		security.reset_login_rate(uname, ip)
		r3 = _login(uname, pwd2, "adm-dev-3")
		log.check(r3.get("token"), "Re-enabled login signs in again")

		# ---- sign out all phones -------------------------------------------
		frappe.set_user(manager)
		rv = admin.revoke_app_devices(w)
		log.check(rv["revoked"] == 1 and not admin.app_login_status(w)["devices"], "Sign out all phones", rv)

		# ---- privileged accounts are off limits for a ServePOS Manager ----
		frappe.db.set_value("ServePOS Waiter", w2, "user", cashier)
		expect_error(log, "Manager cannot reset the password of a non-waiter user", frappe.PermissionError,
			admin.reset_app_password, w2, "hijack1")
		frappe.db.set_value("ServePOS Waiter", w2, "user", "Administrator")
		expect_error(log, "Administrator can never be managed here", frappe.PermissionError,
			admin.set_app_login_enabled, w2, 0)
		frappe.db.set_value("ServePOS Waiter", w2, "user", None)

		# ---- remove ---------------------------------------------------------
		rm = admin.remove_app_login(w)
		u = frappe.db.get_value("User", user, ["enabled", "username"], as_dict=True)
		log.check(
			not frappe.db.get_value("ServePOS Waiter", w, "user") and u and u.enabled == 0,
			"Remove unlinks the waiter and disables (keeps) the User", u,
		)
		log.check(admin.app_login_status(w)["has_login"] is False, "Status shows no login after removal")
		frappe.set_user("Guest")
		security.reset_login_rate(uname, ip)
		expect_error(log, "Removed login cannot sign in", frappe.AuthenticationError, _login, uname, pwd2)
		frappe.set_user(manager)
		r4 = admin.create_app_login(w, uname, pwd1)
		log.check(r4["user"] != user and r4["username"] == uname, "Username is free again after removal", r4["user"])

		# ---- System Manager may also use it ---------------------------------
		frappe.set_user(me)
		log.check(admin.app_login_status(w)["has_login"], "System Manager can use the endpoints")
	except Exception:
		log.check(False, "Unexpected error", traceback.format_exc()[-2000:])
	finally:
		frappe.flags.servepos_mobile_test = False
		frappe.local.servepos_device_session = None
		frappe.set_user(me)
		frappe.local.session = saved_session
		frappe.db.rollback()
		try:
			security.reset_login_rate(uname, ip)
			security.reset_login_rate(uname.upper(), ip)
		except Exception:
			pass
	return {
		"passed": sum(1 for s in log.steps if s["ok"]),
		"failed": sum(1 for s in log.steps if not s["ok"]),
		"failures": [s for s in log.steps if not s["ok"]],
	}
