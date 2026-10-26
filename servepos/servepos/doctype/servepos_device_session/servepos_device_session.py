import frappe
from frappe.model.document import Document


class ServePOSDeviceSession(Document):
	def validate(self):
		if self.has_value_changed("revoked") and self.revoked and not self.revoked_reason:
			self.revoked_reason = f"Revoked by {frappe.session.user}"
		if self.has_value_changed("revoked") and self.revoked:
			self.fcm_token = None
