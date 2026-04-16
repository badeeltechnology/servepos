import frappe
from frappe.model.document import Document


class ServePOSWaiter(Document):
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
