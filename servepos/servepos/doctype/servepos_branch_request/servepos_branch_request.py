import frappe
from frappe.model.document import Document


class ServePOSBranchRequest(Document):
	def before_submit(self):
		self.status = "Pending"

	def update_status(self):
		"""Update status based on item fulfillment."""
		if not self.items:
			return

		total = len(self.items)
		fulfilled = sum(1 for item in self.items if item.status in ("Transferred", "Ordered", "Fulfilled"))

		if fulfilled == 0:
			self.status = "Pending"
		elif fulfilled < total:
			self.status = "Partially Fulfilled"
		else:
			self.status = "Fulfilled"

		self.save(ignore_permissions=True)
