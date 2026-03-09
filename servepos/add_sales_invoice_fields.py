import frappe

def add_custom_fields_to_sales_invoice():
    """Add ServePOS custom fields to Sales Invoice (same as POS Invoice)"""
    custom_fields = [
        {
            "fieldname": "servepos_section",
            "label": "ServePOS Details",
            "fieldtype": "Section Break",
            "insert_after": "additional_discount_percentage",
        },
        {
            "fieldname": "servepos_table",
            "label": "Table",
            "fieldtype": "Link",
            "options": "ServePOS Table",
            "insert_after": "servepos_section",
        },
        {
            "fieldname": "servepos_room",
            "label": "Room",
            "fieldtype": "Link",
            "options": "ServePOS Room",
            "insert_after": "servepos_table",
        },
        {
            "fieldname": "servepos_order_type",
            "label": "Order Type",
            "fieldtype": "Select",
            "options": "\nDine In\nTakeaway\nDelivery",
            "insert_after": "servepos_room",
        },
        {
            "fieldname": "servepos_column_break",
            "fieldtype": "Column Break",
            "insert_after": "servepos_order_type",
        },
        {
            "fieldname": "servepos_guests",
            "label": "Number of Guests",
            "fieldtype": "Int",
            "insert_after": "servepos_column_break",
        },
        {
            "fieldname": "servepos_waiter",
            "label": "Waiter/Server",
            "fieldtype": "Link",
            "options": "User",
            "insert_after": "servepos_guests",
        },
        {
            "fieldname": "servepos_kot_generated",
            "label": "KOT Generated",
            "fieldtype": "Check",
            "insert_after": "servepos_waiter",
        },
    ]

    for field in custom_fields:
        field_name = f"Sales Invoice-{field['fieldname']}"

        if not frappe.db.exists("Custom Field", field_name):
            doc = frappe.new_doc("Custom Field")
            doc.dt = "Sales Invoice"
            doc.fieldname = field["fieldname"]
            doc.label = field.get("label")
            doc.fieldtype = field["fieldtype"]
            doc.options = field.get("options")
            doc.insert_after = field["insert_after"]
            doc.insert()
            print(f"Created custom field: {field['fieldname']}")
        else:
            print(f"Custom field already exists: {field['fieldname']}")

    frappe.db.commit()
    print("\nCustom fields added to Sales Invoice")


def add_stock_entry_sales_invoice_field():
    """Add Sales Invoice link field to Stock Entry"""
    field_name = "Stock Entry-custom_sales_invoice"

    if not frappe.db.exists("Custom Field", field_name):
        doc = frappe.new_doc("Custom Field")
        doc.dt = "Stock Entry"
        doc.fieldname = "custom_sales_invoice"
        doc.label = "Sales Invoice"
        doc.fieldtype = "Link"
        doc.options = "Sales Invoice"
        doc.insert_after = "custom_pos_invoice"
        doc.insert()
        print("Created custom_sales_invoice field on Stock Entry")
    else:
        print("Field already exists")

    frappe.db.commit()


if __name__ == "__main__":
    add_custom_fields_to_sales_invoice()
    add_stock_entry_sales_invoice_field()
