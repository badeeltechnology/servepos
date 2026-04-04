import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class ServePOSWaiterOrder(Document):
	def before_insert(self):
		self.waiter = frappe.session.user
		self.waiter_name = frappe.get_value("User", self.waiter, "full_name") or self.waiter
		if not self.status:
			self.status = "Pending"

	def before_save(self):
		if self.has_value_changed("status"):
			log = self.edit_log or ""
			log += f"\n[{now_datetime()}] Status changed to {self.status} by {frappe.session.user}"
			self.edit_log = log.strip()

		# Track item changes for audit
		if not self.is_new() and self.has_value_changed("items"):
			log = self.edit_log or ""
			log += f"\n[{now_datetime()}] Items modified by {frappe.session.user}"
			self.edit_log = log.strip()

	def on_update(self):
		# Reserve table when order is pending
		if self.table and self.status == "Pending":
			frappe.db.set_value("ServePOS Table", self.table, "status", "Reserved")

		# Free table when order is cancelled
		if self.table and self.status == "Cancelled":
			frappe.db.set_value("ServePOS Table", self.table, "status", "Available")
