import frappe
import random
from frappe.model.document import Document


class ServePOSVoucher(Document):
    def before_insert(self):
        """Auto-generate a unique random 6-digit numeric code."""
        if not self.code:
            self.code = self._generate_unique_code()

    def validate(self):
        if self.discount_percent is not None:
            if self.discount_percent < 0 or self.discount_percent > 100:
                frappe.throw("Discount Percent must be between 0 and 100.")

    @staticmethod
    def _generate_unique_code():
        """Generate a random 6-digit code that doesn't already exist."""
        for _ in range(100):
            code = str(random.randint(100000, 999999))
            if not frappe.db.exists("ServePOS Voucher", {"code": code}):
                return code
        frappe.throw("Unable to generate a unique voucher code. Please try again.")
