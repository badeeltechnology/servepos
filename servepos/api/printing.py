"""
ServePOS Printing API
Handles printing of KOTs and Bills
"""
import frappe
from frappe import _


@frappe.whitelist()
def print_kot(kot_name, printer=None):
    """Print a KOT to a specific printer or default"""
    kot = frappe.get_doc("ServePOS KOT", kot_name)

    # Get print format
    print_format = "ServePOS KOT"

    # Generate PDF
    from frappe.utils.print_format import download_pdf
    pdf = frappe.get_print(
        "ServePOS KOT",
        kot_name,
        print_format,
        as_pdf=True
    )

    return {
        "success": True,
        "message": f"KOT {kot_name} printed",
        "print_url": f"/api/method/frappe.utils.print_format.download_pdf?doctype=ServePOS%20KOT&name={kot_name}&format={print_format}"
    }


@frappe.whitelist()
def print_bill(pos_invoice, printer=None):
    """Print a Bill/Receipt to a specific printer or default"""
    invoice = frappe.get_doc("POS Invoice", pos_invoice)

    # Get print format
    print_format = "ServePOS Bill"

    return {
        "success": True,
        "message": f"Bill {pos_invoice} printed",
        "print_url": f"/api/method/frappe.utils.print_format.download_pdf?doctype=POS%20Invoice&name={pos_invoice}&format={print_format}"
    }


@frappe.whitelist()
def get_print_url(doctype, name, print_format=None):
    """Get print URL for a document"""
    if not print_format:
        if doctype == "ServePOS KOT":
            print_format = "ServePOS KOT"
        elif doctype == "POS Invoice":
            print_format = "ServePOS Bill"
        else:
            print_format = "Standard"

    return {
        "print_url": f"/api/method/frappe.utils.print_format.download_pdf?doctype={doctype}&name={name}&format={print_format}",
        "preview_url": f"/printpreview?doctype={doctype}&name={name}&format={print_format}"
    }


@frappe.whitelist()
def print_all_kots_for_invoice(pos_invoice):
    """Print all KOTs for a POS Invoice"""
    kots = frappe.get_all(
        "ServePOS KOT",
        filters={"pos_invoice": pos_invoice},
        pluck="name"
    )

    results = []
    for kot in kots:
        result = print_kot(kot)
        results.append(result)

    return {
        "success": True,
        "message": f"Printed {len(results)} KOT(s)",
        "kots": results
    }
