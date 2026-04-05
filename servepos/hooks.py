app_name = "servepos"
app_title = "ServePOS"
app_publisher = "Badeel Technology"
app_description = "An intuitive POS solution built for restaurants to handle orders, payments, and kitchen coordination seamlessly."
app_email = "developer@badeeltechnology.com"
app_license = "agpl-3.0"

# Apps
# ------------------

required_apps = ["erpnext"]

# Fixtures
fixtures = [
	{"dt": "Custom Field", "filters": [["fieldname", "like", "servepos%"]]},
	{"dt": "Custom Field", "filters": [["fieldname", "like", "custom_pos_invoice%"]]},
	{"dt": "Custom Field", "filters": [["fieldname", "=", "custom_sales_invoice"]]},
	{"dt": "Role", "filters": [["name", "like", "ServePOS%"]]},
]

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "servepos",
		"logo": "/assets/servepos/images/logo.svg",
		"title": "ServePOS",
		"route": "/pos",
		"has_permission": "servepos.servepos.api.permission.has_app_permission"
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/servepos/css/servepos.css"
# app_include_js = "/assets/servepos/js/servepos.js"

# include js, css files in header of web template
# web_include_css = "/assets/servepos/css/servepos.css"
# web_include_js = "/assets/servepos/js/servepos.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "servepos/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "servepos/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
role_home_page = {
	"ServePOS Manager": "pos",
	"ServePOS Cashier": "pos",
	"ServePOS Waiter": "pos",
	"ServePOS Kitchen": "pos",
}

# Website Routes
# --------------
website_route_rules = [
	{"from_route": "/pos/<path:app_path>", "to_route": "pos"},
	{"from_route": "/pos", "to_route": "pos"},
]

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "servepos.utils.jinja_methods",
# 	"filters": "servepos.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "servepos.install.before_install"
# after_install = "servepos.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "servepos.uninstall.before_uninstall"
# after_uninstall = "servepos.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "servepos.utils.before_app_install"
# after_app_install = "servepos.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "servepos.utils.before_app_uninstall"
# after_app_uninstall = "servepos.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "servepos.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"POS Invoice": {
		"before_submit": "servepos.api.stock.create_manufacture_entries_before_submit",
		"on_submit": "servepos.api.kot.auto_generate_kot_on_submit",
		"on_cancel": "servepos.api.stock.reverse_stock_on_cancel"
	},
	"Sales Invoice": {
		"before_submit": "servepos.api.stock.create_manufacture_entries_before_submit",
		"on_submit": "servepos.api.kot.auto_generate_kot_on_submit",
		"on_cancel": "servepos.api.stock.reverse_stock_on_cancel"
	}
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"servepos.tasks.all"
# 	],
# 	"daily": [
# 		"servepos.tasks.daily"
# 	],
# 	"hourly": [
# 		"servepos.tasks.hourly"
# 	],
# 	"weekly": [
# 		"servepos.tasks.weekly"
# 	],
# 	"monthly": [
# 		"servepos.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "servepos.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "servepos.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "servepos.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "servepos.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["servepos.utils.before_request"]
# after_request = ["servepos.utils.after_request"]

# Job Events
# ----------
# before_job = ["servepos.utils.before_job"]
# after_job = ["servepos.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"servepos.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

