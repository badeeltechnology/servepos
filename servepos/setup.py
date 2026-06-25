"""
ServePOS Setup Functions
Creates doctypes, custom fields, and initial configuration
"""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def cleanup_servepos_custom_fields():
    """Delete all existing ServePOS custom fields to allow recreation with correct types"""
    doctypes = ["Item", "POS Profile", "POS Invoice", "POS Invoice Item", "Item Group"]
    for dt in doctypes:
        fields = frappe.get_all(
            "Custom Field",
            filters={"dt": dt, "fieldname": ["like", "servepos_%"]},
            pluck="name"
        )
        # Also get non-prefixed fields we created
        extra_fields = frappe.get_all(
            "Custom Field",
            filters={
                "dt": dt,
                "fieldname": ["in", ["enable_kds", "auto_generate_kot", "auto_deduct_stock", "kot_warning_minutes", "kot_urgent_minutes"]]
            },
            pluck="name"
        )
        fields.extend(extra_fields)
        for field in fields:
            frappe.delete_doc("Custom Field", field, force=True)
            print(f"Deleted custom field: {field}")
    frappe.db.commit()


def create_kitchen_station_item_group_doctype():
    """Create child table for Kitchen Station Item Groups"""
    if frappe.db.exists("DocType", "ServePOS Station Item Group"):
        print("ServePOS Station Item Group already exists")
        return

    doc = frappe.new_doc("DocType")
    doc.name = "ServePOS Station Item Group"
    doc.module = "ServePOS"
    doc.custom = 0
    doc.istable = 1
    doc.append("fields", {
        "fieldname": "item_group",
        "fieldtype": "Link",
        "label": "Item Group",
        "options": "Item Group",
        "reqd": 1,
        "in_list_view": 1
    })
    doc.insert()
    print("Created ServePOS Station Item Group")


def create_kitchen_station_doctype():
    """Create Kitchen Station doctype"""
    if frappe.db.exists("DocType", "ServePOS Kitchen Station"):
        print("ServePOS Kitchen Station already exists")
        return

    # First create the child table
    create_kitchen_station_item_group_doctype()

    doc = frappe.new_doc("DocType")
    doc.name = "ServePOS Kitchen Station"
    doc.module = "ServePOS"
    doc.custom = 0
    doc.is_submittable = 0
    doc.autoname = "field:station_name"

    fields = [
        {"fieldname": "station_name", "fieldtype": "Data", "label": "Station Name", "reqd": 1, "unique": 1},
        {"fieldname": "description", "fieldtype": "Small Text", "label": "Description"},
        {"fieldname": "column_break_1", "fieldtype": "Column Break"},
        {"fieldname": "is_active", "fieldtype": "Check", "label": "Is Active", "default": "1"},
        {"fieldname": "display_order", "fieldtype": "Int", "label": "Display Order", "default": "0"},
        {"fieldname": "section_break_item_groups", "fieldtype": "Section Break", "label": "Item Groups"},
        {"fieldname": "item_groups", "fieldtype": "Table", "label": "Item Groups", "options": "ServePOS Station Item Group"}
    ]
    for field in fields:
        doc.append("fields", field)

    doc.append("permissions", {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1})
    doc.append("permissions", {"role": "Sales User", "read": 1})
    doc.insert()
    print("Created ServePOS Kitchen Station")


def create_custom_fields_for_item_group():
    """Add ServePOS custom fields to Item Group doctype"""
    custom_fields = {
        "Item Group": [
            {
                "fieldname": "servepos_is_menu_group",
                "fieldtype": "Check",
                "label": "Is Menu Group (ServePOS)",
                "description": "Check this to show this group in the POS menu management portal",
                "insert_after": "is_group",
                "default": "0"
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for Item Group")


def create_custom_fields_for_item():
    """Add ServePOS custom fields to Item doctype"""
    custom_fields = {
        "Item": [
            {
                "fieldname": "servepos_arabic_section",
                "fieldtype": "Section Break",
                "label": "Arabic / Translation",
                "insert_after": "description",
                "collapsible": 1
            },
            {
                "fieldname": "servepos_item_name_ar",
                "fieldtype": "Data",
                "label": "Item Name (Arabic)",
                "insert_after": "servepos_arabic_section",
                "translatable": 1
            },
            {
                "fieldname": "servepos_description_ar",
                "fieldtype": "Small Text",
                "label": "Description (Arabic)",
                "insert_after": "servepos_item_name_ar",
                "translatable": 1
            },
            {
                "fieldname": "servepos_section",
                "fieldtype": "Section Break",
                "label": "ServePOS Settings",
                "insert_after": "servepos_description_ar",
                "collapsible": 1
            },
            {
                "fieldname": "servepos_kitchen_station",
                "fieldtype": "Link",
                "label": "Kitchen Station",
                "options": "ServePOS Kitchen Station",
                "insert_after": "servepos_section"
            },
            {
                "fieldname": "servepos_preparation_time",
                "fieldtype": "Int",
                "label": "Preparation Time (mins)",
                "insert_after": "servepos_kitchen_station"
            },
            {
                "fieldname": "servepos_column_break",
                "fieldtype": "Column Break",
                "insert_after": "servepos_preparation_time"
            },
            {
                "fieldname": "servepos_is_available",
                "fieldtype": "Check",
                "label": "Available in POS",
                "default": "1",
                "insert_after": "servepos_column_break"
            },
            {
                "fieldname": "servepos_modifiers",
                "fieldtype": "Small Text",
                "label": "Available Modifiers (comma separated)",
                "insert_after": "servepos_is_available"
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for Item")


def create_custom_fields_for_pos_profile():
    """Add ServePOS custom fields to POS Profile"""
    custom_fields = {
        "POS Profile": [
            {
                "fieldname": "servepos_section",
                "fieldtype": "Section Break",
                "label": "ServePOS Settings",
                "insert_after": "applicable_for_users",
                "collapsible": 1
            },
            {
                "fieldname": "enable_kds",
                "fieldtype": "Check",
                "label": "Enable Kitchen Display System",
                "default": "1",
                "insert_after": "servepos_section"
            },
            {
                "fieldname": "auto_generate_kot",
                "fieldtype": "Check",
                "label": "Auto Generate KOT on Order",
                "default": "1",
                "insert_after": "enable_kds"
            },
            {
                "fieldname": "auto_deduct_stock",
                "fieldtype": "Check",
                "label": "Auto Deduct Stock (BOM-based)",
                "default": "0",
                "insert_after": "auto_generate_kot"
            },
            {
                "fieldname": "servepos_column_break",
                "fieldtype": "Column Break",
                "insert_after": "auto_deduct_stock"
            },
            {
                "fieldname": "kot_warning_minutes",
                "fieldtype": "Int",
                "label": "KOT Warning Time (minutes)",
                "default": "10",
                "insert_after": "servepos_column_break"
            },
            {
                "fieldname": "kot_urgent_minutes",
                "fieldtype": "Int",
                "label": "KOT Urgent Time (minutes)",
                "default": "15",
                "insert_after": "kot_warning_minutes"
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for POS Profile")


def create_custom_fields_for_pos_profile_guest():
    """Add guest calling & branding custom fields to POS Profile"""
    custom_fields = {
        "POS Profile": [
            {
                "fieldname": "servepos_guest_section",
                "fieldtype": "Section Break",
                "label": "Guest Calling & Branding",
                "insert_after": "kot_urgent_minutes",
                "collapsible": 1
            },
            {
                "fieldname": "servepos_enable_guest_calling",
                "fieldtype": "Check",
                "label": "Enable Guest Calling",
                "description": "Allow guests to call waiters by scanning a QR code on their seat/table",
                "default": "0",
                "insert_after": "servepos_guest_section"
            },
            {
                "fieldname": "servepos_restaurant_display_name",
                "fieldtype": "Data",
                "label": "Restaurant Display Name",
                "description": "Friendly name shown to guests (e.g. 'Beach Grill')",
                "insert_after": "servepos_enable_guest_calling"
            },
            {
                "fieldname": "servepos_restaurant_description",
                "fieldtype": "Small Text",
                "label": "Restaurant Description",
                "description": "Short description shown to guests",
                "insert_after": "servepos_restaurant_display_name"
            },
            {
                "fieldname": "servepos_guest_col_break",
                "fieldtype": "Column Break",
                "insert_after": "servepos_restaurant_description"
            },
            {
                "fieldname": "servepos_restaurant_logo",
                "fieldtype": "Attach Image",
                "label": "Restaurant Logo",
                "insert_after": "servepos_guest_col_break"
            },
            {
                "fieldname": "servepos_venue_name",
                "fieldtype": "Data",
                "label": "Venue Name",
                "description": "Hotel/resort name shown at the top of the guest page",
                "insert_after": "servepos_restaurant_logo"
            },
            {
                "fieldname": "servepos_venue_logo",
                "fieldtype": "Attach Image",
                "label": "Venue Logo",
                "insert_after": "servepos_venue_name"
            },
            {
                "fieldname": "servepos_menu_section",
                "fieldtype": "Section Break",
                "label": "Menu Gallery",
                "description": "Upload menu images that guests can swipe through",
                "insert_after": "servepos_venue_logo",
                "collapsible": 1
            },
            {
                "fieldname": "servepos_menu_images",
                "fieldtype": "Table",
                "label": "Menu Images",
                "options": "ServePOS Menu Image",
                "insert_after": "servepos_menu_section"
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created guest calling & branding custom fields for POS Profile")


def create_custom_fields_for_pos_invoice():
    """Add ServePOS custom fields to POS Invoice"""
    custom_fields = {
        "POS Invoice": [
            {
                "fieldname": "servepos_section",
                "fieldtype": "Section Break",
                "label": "ServePOS Details",
                "insert_after": "amended_from",
                "collapsible": 1
            },
            {
                "fieldname": "servepos_cashier",
                "fieldtype": "Data",
                "label": "Cashier",
                "insert_after": "servepos_section"
            },
            {
                "fieldname": "servepos_table",
                "fieldtype": "Link",
                "label": "Table",
                "options": "ServePOS Table",
                "insert_after": "servepos_cashier"
            },
            {
                "fieldname": "servepos_room",
                "fieldtype": "Link",
                "label": "Room",
                "options": "ServePOS Room",
                "insert_after": "servepos_table"
            },
            {
                "fieldname": "servepos_order_type",
                "fieldtype": "Select",
                "label": "Order Type",
                "options": "\nDine In\nTakeaway\nDelivery",
                "default": "Dine In",
                "insert_after": "servepos_room"
            },
            {
                "fieldname": "servepos_column_break",
                "fieldtype": "Column Break",
                "insert_after": "servepos_order_type"
            },
            {
                "fieldname": "servepos_waiter",
                "fieldtype": "Link",
                "label": "Waiter/Server",
                "options": "ServePOS Waiter",
                "insert_after": "servepos_column_break"
            },
            {
                "fieldname": "servepos_guests",
                "fieldtype": "Int",
                "label": "Number of Guests",
                "insert_after": "servepos_waiter"
            },
            {
                "fieldname": "servepos_kot_generated",
                "fieldtype": "Check",
                "label": "KOT Generated",
                "read_only": 1,
                "insert_after": "servepos_guests"
            }
        ],
        "POS Invoice Item": [
            {
                "fieldname": "servepos_modifiers",
                "fieldtype": "Small Text",
                "label": "Modifiers",
                "insert_after": "description"
            },
            {
                "fieldname": "servepos_comment",
                "fieldtype": "Small Text",
                "label": "Special Instructions",
                "insert_after": "servepos_modifiers"
            },
            {
                "fieldname": "servepos_kot_status",
                "fieldtype": "Select",
                "label": "KOT Status",
                "options": "\nPending\nIn Progress\nReady\nServed",
                "insert_after": "servepos_comment"
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for POS Invoice")


def create_custom_fields_for_restaurant():
    """Add branch field to ServePOS Table and Room"""
    custom_fields = {
        "ServePOS Table": [
            {
                "fieldname": "branch",
                "fieldtype": "Link",
                "label": "Branch",
                "options": "Branch",
                "insert_after": "table_name",
                "reqd": 0
            }
        ],
        "ServePOS Room": [
            {
                "fieldname": "branch",
                "fieldtype": "Link",
                "label": "Branch",
                "options": "Branch",
                "insert_after": "room_name",
                "reqd": 0
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for ServePOS Table and Room")


def create_custom_fields_for_sales_invoice():
    """Add ServePOS custom fields to Sales Invoice and Sales Invoice Item"""
    custom_fields = {
        "Sales Invoice": [
            {
                "fieldname": "servepos_section",
                "fieldtype": "Section Break",
                "label": "ServePOS Details",
                "insert_after": "amended_from",
                "collapsible": 1
            },
            {
                "fieldname": "servepos_cashier",
                "fieldtype": "Data",
                "label": "Cashier",
                "insert_after": "servepos_section"
            },
            {
                "fieldname": "servepos_table",
                "fieldtype": "Link",
                "label": "Table",
                "options": "ServePOS Table",
                "insert_after": "servepos_cashier"
            },
            {
                "fieldname": "servepos_room",
                "fieldtype": "Link",
                "label": "Room",
                "options": "ServePOS Room",
                "insert_after": "servepos_table"
            },
            {
                "fieldname": "servepos_order_type",
                "fieldtype": "Select",
                "label": "Order Type",
                "options": "\nDine In\nTakeaway\nDelivery",
                "default": "Dine In",
                "insert_after": "servepos_room"
            },
            {
                "fieldname": "servepos_column_break",
                "fieldtype": "Column Break",
                "insert_after": "servepos_order_type"
            },
            {
                "fieldname": "servepos_guests",
                "fieldtype": "Int",
                "label": "Number of Guests",
                "insert_after": "servepos_column_break"
            },
            {
                "fieldname": "servepos_order_number",
                "fieldtype": "Data",
                "label": "POS Order Number",
                "read_only": 1,
                "insert_after": "servepos_guests"
            },
            {
                "fieldname": "servepos_kot_generated",
                "fieldtype": "Check",
                "label": "KOT Generated",
                "read_only": 1,
                "insert_after": "servepos_order_number"
            }
        ],
        "Sales Invoice Item": [
            {
                "fieldname": "servepos_modifiers",
                "fieldtype": "Small Text",
                "label": "Modifiers",
                "insert_after": "description"
            },
            {
                "fieldname": "servepos_comment",
                "fieldtype": "Small Text",
                "label": "Special Instructions",
                "insert_after": "servepos_modifiers"
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for Sales Invoice")


def create_kot_item_doctype():
    """Create KOT Item child table"""
    if frappe.db.exists("DocType", "ServePOS KOT Item"):
        print("ServePOS KOT Item already exists")
        return

    doc = frappe.new_doc("DocType")
    doc.name = "ServePOS KOT Item"
    doc.module = "ServePOS"
    doc.custom = 0
    doc.istable = 1

    fields = [
        {"fieldname": "item_code", "fieldtype": "Link", "label": "Item Code", "options": "Item", "reqd": 1, "in_list_view": 1},
        {"fieldname": "item_name", "fieldtype": "Data", "label": "Item Name", "in_list_view": 1, "fetch_from": "item_code.item_name"},
        {"fieldname": "qty", "fieldtype": "Float", "label": "Qty", "reqd": 1, "in_list_view": 1},
        {"fieldname": "modifiers", "fieldtype": "Small Text", "label": "Modifiers", "in_list_view": 1},
        {"fieldname": "special_instructions", "fieldtype": "Small Text", "label": "Special Instructions"},
        {"fieldname": "status", "fieldtype": "Select", "label": "Status", "options": "Pending\nIn Progress\nReady\nServed", "default": "Pending", "in_list_view": 1},
        {"fieldname": "pos_invoice_item", "fieldtype": "Data", "label": "POS Invoice Item", "hidden": 1}
    ]
    for field in fields:
        doc.append("fields", field)

    doc.insert()
    print("Created ServePOS KOT Item")


def create_kot_doctype():
    """Create Kitchen Order Ticket (KOT) doctype"""
    # First create child table
    create_kot_item_doctype()

    if frappe.db.exists("DocType", "ServePOS KOT"):
        print("ServePOS KOT already exists")
        return

    doc = frappe.new_doc("DocType")
    doc.name = "ServePOS KOT"
    doc.module = "ServePOS"
    doc.custom = 0
    doc.is_submittable = 0
    doc.autoname = "naming_series:"
    doc.naming_series = "KOT-.YYYY.-.#####"

    fields = [
        {"fieldname": "naming_series", "fieldtype": "Select", "label": "Series", "options": "KOT-.YYYY.-.#####", "reqd": 1, "hidden": 1, "default": "KOT-.YYYY.-.#####"},
        {"fieldname": "pos_invoice", "fieldtype": "Link", "label": "POS Invoice", "options": "POS Invoice", "reqd": 1},
        {"fieldname": "kitchen_station", "fieldtype": "Link", "label": "Kitchen Station", "options": "ServePOS Kitchen Station", "reqd": 1},
        {"fieldname": "table", "fieldtype": "Link", "label": "Table", "options": "ServePOS Table"},
        {"fieldname": "column_break_1", "fieldtype": "Column Break"},
        {"fieldname": "status", "fieldtype": "Select", "label": "Status", "options": "Pending\nIn Progress\nReady\nServed\nCancelled", "default": "Pending", "reqd": 1, "in_list_view": 1},
        {"fieldname": "priority", "fieldtype": "Select", "label": "Priority", "options": "Normal\nHigh\nUrgent", "default": "Normal"},
        {"fieldname": "order_time", "fieldtype": "Datetime", "label": "Order Time", "default": "now"},
        {"fieldname": "section_break_items", "fieldtype": "Section Break", "label": "Items"},
        {"fieldname": "items", "fieldtype": "Table", "label": "Items", "options": "ServePOS KOT Item", "reqd": 1},
        {"fieldname": "section_break_notes", "fieldtype": "Section Break", "label": "Notes"},
        {"fieldname": "notes", "fieldtype": "Small Text", "label": "Notes"}
    ]
    for field in fields:
        doc.append("fields", field)

    doc.append("permissions", {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1})
    doc.append("permissions", {"role": "Sales User", "read": 1, "write": 1, "create": 1})
    doc.insert()
    print("Created ServePOS KOT")


def create_visible_profiles_fields():
    """
    Add `servepos_visible_profiles` (Small Text, comma-separated POS Profile
    names) to every doctype that should be filterable per POS Profile.
    This is the single schema backing the centralized registry API.
    """
    doctypes = [
        ("Item Group", "servepos_is_menu_group"),
        ("ServePOS Modifier Group", None),
        ("ServePOS Waiter", None),
        ("ServePOS Table", None),
        ("ServePOS Room", None),
        ("ServePOS Kitchen Station", None),
        ("ServePOS Promo", None),
    ]
    custom_fields = {}
    for dt, insert_after in doctypes:
        if not frappe.db.exists("DocType", dt):
            continue
        custom_fields[dt] = [
            {
                "fieldname": "servepos_visible_profiles",
                "fieldtype": "Small Text",
                "label": "Visible on POS Profiles",
                "description": "Comma-separated POS Profile names. Leave empty to show everywhere.",
                "insert_after": insert_after or "name",
            }
        ]
    if custom_fields:
        create_custom_fields(custom_fields)
        print("Created servepos_visible_profiles fields on:", ", ".join(custom_fields.keys()))


def create_custom_fields_for_stock_entry():
    """Add ServePOS custom fields to Stock Entry"""
    custom_fields = {
        "Stock Entry": [
            {
                "fieldname": "custom_pos_invoice",
                "fieldtype": "Link",
                "label": "POS Invoice",
                "options": "POS Invoice",
                "insert_after": "remarks",
                "read_only": 1
            }
        ]
    }
    create_custom_fields(custom_fields)
    print("Created custom fields for Stock Entry")


def create_kot_print_format():
    """Create KOT Print Format"""
    if frappe.db.exists("Print Format", "ServePOS KOT"):
        print("ServePOS KOT Print Format already exists")
        return

    html = """
<style>
    .kot-print {
        font-family: 'Courier New', monospace;
        width: 80mm;
        padding: 5mm;
        font-size: 12px;
    }
    .kot-header {
        text-align: center;
        border-bottom: 2px dashed #000;
        padding-bottom: 5px;
        margin-bottom: 10px;
    }
    .kot-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: bold;
    }
    .kot-info {
        margin-bottom: 10px;
        font-size: 11px;
    }
    .kot-info div {
        display: flex;
        justify-content: space-between;
    }
    .kot-items {
        border-top: 1px dashed #000;
        border-bottom: 1px dashed #000;
        padding: 5px 0;
    }
    .kot-item {
        margin: 5px 0;
        padding: 3px 0;
        border-bottom: 1px dotted #ccc;
    }
    .kot-item:last-child {
        border-bottom: none;
    }
    .item-name {
        font-weight: bold;
        font-size: 14px;
    }
    .item-qty {
        font-size: 16px;
        font-weight: bold;
    }
    .item-modifiers {
        font-size: 10px;
        color: #666;
        margin-left: 10px;
    }
    .item-instructions {
        font-size: 10px;
        font-style: italic;
        margin-left: 10px;
        color: #333;
    }
    .kot-footer {
        text-align: center;
        margin-top: 10px;
        font-size: 10px;
    }
    .priority-high {
        background: #ffe0e0;
    }
    .priority-urgent {
        background: #ffcccc;
        font-weight: bold;
    }
</style>

<div class="kot-print {{ 'priority-' + doc.priority|lower if doc.priority != 'Normal' else '' }}">
    <div class="kot-header">
        <h2>KITCHEN ORDER TICKET</h2>
        <div style="font-size: 14px; font-weight: bold;">{{ doc.name }}</div>
    </div>

    <div class="kot-info">
        <div><span>Station:</span><span><b>{{ doc.kitchen_station }}</b></span></div>
        <div><span>Table:</span><span><b>{{ frappe.db.get_value('ServePOS Table', doc.table, 'table_name') if doc.table else 'N/A' }}</b></span></div>
        <div><span>Time:</span><span>{{ doc.order_time.strftime('%H:%M') if doc.order_time else '' }}</span></div>
        <div><span>Invoice:</span><span>{{ doc.pos_invoice }}</span></div>
        {% if doc.priority != 'Normal' %}
        <div style="text-align: center; font-weight: bold; font-size: 14px; margin-top: 5px;">
            *** {{ doc.priority|upper }} ***
        </div>
        {% endif %}
    </div>

    <div class="kot-items">
        {% for item in doc.items %}
        <div class="kot-item">
            <div style="display: flex; justify-content: space-between;">
                <span class="item-name">{{ item.item_name or item.item_code }}</span>
                <span class="item-qty">x{{ item.qty|int }}</span>
            </div>
            {% if item.modifiers %}
            <div class="item-modifiers">+ {{ item.modifiers }}</div>
            {% endif %}
            {% if item.special_instructions %}
            <div class="item-instructions">Note: {{ item.special_instructions }}</div>
            {% endif %}
        </div>
        {% endfor %}
    </div>

    {% if doc.notes %}
    <div style="margin-top: 10px; font-size: 11px;">
        <b>Notes:</b> {{ doc.notes }}
    </div>
    {% endif %}

    <div class="kot-footer">
        <div>Printed: {{ frappe.utils.now_datetime().strftime('%Y-%m-%d %H:%M:%S') }}</div>
    </div>
</div>
"""

    pf = frappe.new_doc("Print Format")
    pf.name = "ServePOS KOT"
    pf.doc_type = "ServePOS KOT"
    pf.module = "ServePOS"
    pf.print_format_type = "Jinja"
    pf.raw_printing = 1
    pf.html = html
    pf.insert()
    print("Created ServePOS KOT Print Format")


def create_bill_print_format():
    """Create Bill/Receipt Print Format for POS Invoice"""
    if frappe.db.exists("Print Format", "ServePOS Bill"):
        print("ServePOS Bill Print Format already exists")
        return

    html = """
<style>
    .bill-print {
        font-family: 'Courier New', monospace;
        width: 80mm;
        padding: 5mm;
        font-size: 12px;
    }
    .bill-header {
        text-align: center;
        margin-bottom: 10px;
    }
    .bill-header h2 {
        margin: 0;
        font-size: 16px;
    }
    .company-info {
        text-align: center;
        font-size: 10px;
        margin-bottom: 10px;
        border-bottom: 2px dashed #000;
        padding-bottom: 10px;
    }
    .bill-info {
        font-size: 11px;
        margin-bottom: 10px;
    }
    .bill-info div {
        display: flex;
        justify-content: space-between;
    }
    .items-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 10px;
    }
    .items-table th {
        border-bottom: 1px solid #000;
        text-align: left;
        font-size: 11px;
        padding: 3px 0;
    }
    .items-table td {
        font-size: 11px;
        padding: 3px 0;
        vertical-align: top;
    }
    .items-table .item-name {
        max-width: 30mm;
    }
    .items-table .qty {
        text-align: center;
        width: 10mm;
    }
    .items-table .rate {
        text-align: right;
        width: 15mm;
    }
    .items-table .amount {
        text-align: right;
        width: 18mm;
    }
    .totals {
        border-top: 1px dashed #000;
        padding-top: 5px;
        font-size: 11px;
    }
    .totals div {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
    }
    .grand-total {
        border-top: 2px solid #000;
        border-bottom: 2px solid #000;
        font-size: 14px;
        font-weight: bold;
        padding: 5px 0;
        margin: 5px 0;
    }
    .payment-info {
        font-size: 11px;
        margin-top: 10px;
        border-top: 1px dashed #000;
        padding-top: 5px;
    }
    .bill-footer {
        text-align: center;
        margin-top: 15px;
        font-size: 10px;
        border-top: 2px dashed #000;
        padding-top: 10px;
    }
</style>

<div class="bill-print">
    <div class="bill-header">
        <h2>{{ doc.company }}</h2>
    </div>

    <div class="company-info">
        {% set company = frappe.get_doc('Company', doc.company) %}
        {% if company.company_address %}
        {{ company.company_address }}<br>
        {% endif %}
        {% if company.phone_no %}
        Tel: {{ company.phone_no }}<br>
        {% endif %}
        {% if company.tax_id %}
        Tax ID: {{ company.tax_id }}
        {% endif %}
    </div>

    <div class="bill-info">
        <div><span>Invoice:</span><span><b>{{ doc.name }}</b></span></div>
        <div><span>Date:</span><span>{{ doc.posting_date }}</span></div>
        <div><span>Time:</span><span>{{ doc.posting_time }}</span></div>
        {% if doc.servepos_table %}
        <div><span>Table:</span><span>{{ frappe.db.get_value('ServePOS Table', doc.servepos_table, 'table_name') }}</span></div>
        {% endif %}
        {% if doc.servepos_waiter %}
        <div><span>Server:</span><span>{{ frappe.db.get_value('ServePOS Waiter', doc.servepos_waiter, 'waiter_name') or doc.servepos_waiter }}</span></div>
        {% endif %}
        {% if doc.servepos_guests %}
        <div><span>Guests:</span><span>{{ doc.servepos_guests }}</span></div>
        {% endif %}
        {% if doc.customer_name %}
        <div><span>Customer:</span><span>{{ doc.customer_name }}</span></div>
        {% endif %}
    </div>

    <table class="items-table">
        <thead>
            <tr>
                <th class="item-name">Item</th>
                <th class="qty">Qty</th>
                <th class="rate">Rate</th>
                <th class="amount">Amount</th>
            </tr>
        </thead>
        <tbody>
            {% for item in doc.items %}
            <tr>
                <td class="item-name">{{ item.item_name }}</td>
                <td class="qty">{{ item.qty|int }}</td>
                <td class="rate">{{ frappe.utils.fmt_money(item.rate, currency=doc.currency) }}</td>
                <td class="amount">{{ frappe.utils.fmt_money(item.amount, currency=doc.currency) }}</td>
            </tr>
            {% if item.servepos_modifiers %}
            <tr>
                <td colspan="4" style="font-size: 9px; padding-left: 5px;">+ {{ item.servepos_modifiers }}</td>
            </tr>
            {% endif %}
            {% endfor %}
        </tbody>
    </table>

    <div class="totals">
        <div><span>Subtotal:</span><span>{{ frappe.utils.fmt_money(doc.net_total, currency=doc.currency) }}</span></div>
        {% for tax in doc.taxes %}
        <div><span>{{ tax.description }}:</span><span>{{ frappe.utils.fmt_money(tax.tax_amount, currency=doc.currency) }}</span></div>
        {% endfor %}
        {% if doc.discount_amount %}
        <div><span>Discount:</span><span>-{{ frappe.utils.fmt_money(doc.discount_amount, currency=doc.currency) }}</span></div>
        {% endif %}
    </div>

    <div class="grand-total">
        <div><span>TOTAL:</span><span>{{ frappe.utils.fmt_money(doc.grand_total, currency=doc.currency) }}</span></div>
    </div>

    <div class="payment-info">
        <div style="font-weight: bold; margin-bottom: 5px;">Payment Details:</div>
        {% for payment in doc.payments %}
        <div style="display: flex; justify-content: space-between;">
            <span>{{ payment.mode_of_payment }}:</span>
            <span>{{ frappe.utils.fmt_money(payment.amount, currency=doc.currency) }}</span>
        </div>
        {% endfor %}
        {% if doc.change_amount > 0 %}
        <div style="display: flex; justify-content: space-between; margin-top: 5px;">
            <span>Change:</span>
            <span>{{ frappe.utils.fmt_money(doc.change_amount, currency=doc.currency) }}</span>
        </div>
        {% endif %}
    </div>

    <div class="bill-footer">
        <div style="font-size: 12px; margin-bottom: 5px;">Thank you for dining with us!</div>
        <div>Powered by ServePOS</div>
        <div style="margin-top: 5px;">{{ frappe.utils.now_datetime().strftime('%Y-%m-%d %H:%M:%S') }}</div>
    </div>
</div>
"""

    pf = frappe.new_doc("Print Format")
    pf.name = "ServePOS Bill"
    pf.doc_type = "POS Invoice"
    pf.module = "ServePOS"
    pf.print_format_type = "Jinja"
    pf.raw_printing = 1
    pf.html = html
    pf.insert()
    print("Created ServePOS Bill Print Format")


def create_demo_kitchen_stations():
    """Create demo kitchen stations"""
    stations = [
        {"station_name": "Main Kitchen", "description": "Main cooking area", "display_order": 1},
        {"station_name": "Bar", "description": "Beverages and drinks", "display_order": 2},
        {"station_name": "Dessert Station", "description": "Desserts and sweets", "display_order": 3},
    ]

    for station_data in stations:
        if not frappe.db.exists("ServePOS Kitchen Station", station_data["station_name"]):
            station = frappe.new_doc("ServePOS Kitchen Station")
            station.update(station_data)
            station.insert()
            print(f"Created kitchen station: {station_data['station_name']}")
        else:
            print(f"Kitchen station already exists: {station_data['station_name']}")


def setup_all():
    """Run all setup functions.
    Called on after_install and after_migrate via hooks.py.
    All create_custom_fields calls are idempotent (safe to run repeatedly)."""
    print("=" * 50)
    print("Setting up ServePOS...")
    print("=" * 50)

    # Create doctypes
    create_kitchen_station_doctype()
    create_kot_doctype()

    # NOTE: cleanup is intentionally NOT called on every migrate.
    # create_custom_fields is idempotent — it creates missing fields
    # and updates existing ones. Cleanup is only needed for type changes.

    # Create custom fields
    print("\nCreating custom fields...")
    create_custom_fields_for_item_group()
    create_custom_fields_for_item()
    create_custom_fields_for_pos_profile()
    create_custom_fields_for_pos_profile_guest()
    create_custom_fields_for_pos_invoice()
    create_custom_fields_for_sales_invoice()
    create_custom_fields_for_restaurant()
    create_custom_fields_for_stock_entry()
    create_visible_profiles_fields()

    # Create print formats
    print("\nCreating print formats...")
    create_kot_print_format()
    create_bill_print_format()

    # Create demo data
    print("\nCreating demo data...")
    create_demo_kitchen_stations()

    frappe.db.commit()
    print("=" * 50)
    print("ServePOS setup complete!")
    print("=" * 50)
