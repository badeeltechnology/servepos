import frappe
from frappe.model.document import Document
from frappe.utils import cint


class ServePOSMobileSettings(Document):
	def validate(self):
		if cint(self.session_days) <= 0:
			self.session_days = 30
		if cint(self.max_session_days) <= 0:
			self.max_session_days = 180
		if cint(self.session_days) > cint(self.max_session_days):
			frappe.throw("Stay logged in days cannot be more than the forced re-login days")
