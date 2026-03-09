import frappe

def create_test_order():
    # Create a test POS Invoice
    invoice = frappe.new_doc('POS Invoice')
    invoice.pos_profile = 'Restaurant POS'
    invoice.customer = 'Walk-in Customer'
    invoice.company = 'Demo Restaurant'
    invoice.set_warehouse = 'Kitchen Store - DR'
    invoice.currency = 'INR'
    invoice.servepos_order_type = 'Dine In'
    invoice.servepos_table = 'T1'
    invoice.servepos_room = 'Main Hall'

    # Add items
    invoice.append('items', {
        'item_code': 'CHICKEN-BIRYANI',
        'qty': 1,
        'rate': 250
    })
    invoice.append('items', {
        'item_code': 'COLA-REGULAR',
        'qty': 2,
        'rate': 40
    })

    # Add payment
    invoice.append('payments', {
        'mode_of_payment': 'Cash',
        'amount': 330
    })

    invoice.insert()
    invoice.submit()

    frappe.db.commit()

    return invoice.name
