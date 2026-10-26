import frappe
from frappe.model.document import Document


class ServePOSWaiter(Document):
	def validate(self):
		if self.user:
			other = frappe.db.get_value(
				"ServePOS Waiter", {"user": self.user, "name": ["!=", self.name or ""]}, "name"
			)
			if other:
				frappe.throw(frappe._("User {0} is already linked to waiter {1}").format(self.user, other))
			if "ServePOS Waiter" not in frappe.get_roles(self.user):
				frappe.msgprint(
					frappe._("User {0} does not have the ServePOS Waiter role yet; the waiter app login will be refused until it is added.").format(self.user),
					indicator="orange",
					alert=True,
				)

	def on_update(self):
		# deactivating a waiter or changing the linked user logs the old phones out
		before = self.get_doc_before_save()
		if before and ((before.is_active and not self.is_active) or (before.user and before.user != self.user)):
			from servepos.api.mobile import security

			for n in frappe.get_all(security.DEVICE_SESSION, filters={"waiter": self.name, "revoked": 0}, pluck="name"):
				security.revoke(n, "Waiter deactivated or user changed")

	def before_insert(self):
		"""
		Auto-fill `branch` from the creating user's POS Profile when not
		supplied by the client.

		Clients such as the Desktop POS `waiters:create` handler only send
		waiter_name/pin/phone/is_active — without this hook every new waiter
		would have a blank branch and therefore show up on every POS Profile,
		defeating the branch scoping in `registry.get_waiters`.

		Resolution order for the branch:
		  1. branch already set on the doc — keep it (admin / explicit value)
		  2. the creating user's default POS Profile branch
		  3. the branch of the user's only POS Profile (if exactly one)
		  4. leave blank (Administrator / user with no POS Profile)

		`servepos_visible_profiles` is intentionally left blank; an empty
		whitelist means "visible on every profile within the branch", which
		is the right default for a freshly-created waiter.
		"""
		if self.branch:
			return

		user = frappe.session.user
		if not user or user in ("Guest", "Administrator"):
			return

		ppu = frappe.qb.DocType("POS Profile User")
		pp = frappe.qb.DocType("POS Profile")
		rows = (
			frappe.qb.from_(ppu)
			.inner_join(pp).on(pp.name == ppu.parent)
			.select(pp.name, pp.branch, ppu.default)
			.where(ppu.user == user)
			.where(pp.disabled == 0)
			.run(as_dict=True)
		) or []

		if not rows:
			return

		pick = next((r for r in rows if r.get("default") and r.get("branch")), None)
		if not pick and len(rows) == 1 and rows[0].get("branch"):
			pick = rows[0]

		if pick:
			self.branch = pick.branch
