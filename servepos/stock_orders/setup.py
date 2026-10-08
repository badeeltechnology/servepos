"""Setup for ServePOS Stock Orders: doctypes, custom fields, roles, seed data.

Runs from servepos.setup.setup_all (after_migrate). Safe to run repeatedly.
"""
import re
from collections import Counter, defaultdict

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

DOCTYPES = [
	"servepos_stock_role_access",
	"servepos_location_item_group",
	"servepos_stock_location",
	"servepos_stock_settings",
	"servepos_order_list_item",
	"servepos_order_list",
	"servepos_stock_order_item",
	"servepos_stock_order",
	"servepos_inventory_count_item",
	"servepos_inventory_count",
	"servepos_item_provider",
]

ROLES = ["ServePOS Outlet User", "ServePOS CK Provider", "ServePOS Pastry Provider"]

# Pastry products found among the CK "Semi Finished Goods" (by name); confirm with Nostalgia.
PASTRY_PATTERNS = re.compile(r"CROISSANT|PAIN AU|PAIN SUISSE|CAKE|SAN SEBASTIAN|TIRAMISU|COCO MANGO|CRUNCHY CHOCOLATE|COOKIES|BROWNIES|PROTEIN BAR", re.I)


def sync_doctypes():
	for dt in DOCTYPES:
		frappe.reload_doc("servepos", "doctype", dt, force=True)


def create_roles():
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def create_fields():
	create_custom_fields({
		"Item": [{
			"fieldname": "servepos_stock_provider", "label": "Stock Provider", "fieldtype": "Link",
			"options": "ServePOS Stock Location", "insert_after": "stock_uom",
			"description": "Where outlets order this item from by default (ServePOS Stock Orders)",
		}, {
			"fieldname": "servepos_also_from", "label": "Also Ordered From", "fieldtype": "Table MultiSelect",
			"options": "ServePOS Item Provider", "insert_after": "servepos_stock_provider",
			"description": "Other providers that also supply this item, for example both the Central Kitchen and the Store",
		}],
		"Stock Entry": [{
			"fieldname": "servepos_stock_order", "label": "ServePOS Stock Order", "fieldtype": "Link",
			"options": "ServePOS Stock Order", "insert_after": "stock_entry_type", "read_only": 1,
		}],
		"Stock Reconciliation": [{
			"fieldname": "servepos_inventory_count", "label": "ServePOS Inventory Count", "fieldtype": "Link",
			"options": "ServePOS Inventory Count", "insert_after": "purpose", "read_only": 1,
		}],
		"Purchase Order Item": [{
			"fieldname": "servepos_stock_orders", "label": "ServePOS Stock Orders", "fieldtype": "Small Text",
			"insert_after": "material_request", "read_only": 1,
		}],
	}, update=True)


PRINT_FORMATS = {
	"ServePOS Stock Order": "ServePOS Delivery Note",
	"ServePOS Inventory Count": "ServePOS Count Sheet",
}


def create_print_formats():
	"""Desk print formats that render the same layout as the PDF downloads."""
	for dt, name in PRINT_FORMATS.items():
		html = "{{ stock_print_html(doc) }}"
		if frappe.db.exists("Print Format", name):
			frappe.db.set_value("Print Format", name, {"html": html, "doc_type": dt, "disabled": 0})
			continue
		frappe.get_doc({"doctype": "Print Format", "name": name, "doc_type": dt, "module": "Servepos", "standard": "No",
			"custom_format": 1, "print_format_type": "Jinja", "html": html, "disabled": 0}).insert(ignore_permissions=True)
		frappe.make_property_setter({"doctype": dt, "doctype_or_field": "DocType", "property": "default_print_format",
			"value": name, "property_type": "Data"}, validate_fields_for_doctype=False)


def add_desk_link():
	"""'Stock Orders' in the Desk user menu, for users who work in Desk (procurement, managers)."""
	try:
		nav = frappe.get_single("Navbar Settings")
	except Exception:
		return
	if any((r.item_label or "") == "Stock Orders" for r in nav.settings_dropdown):
		return
	nav.append("settings_dropdown", {"item_label": "Stock Orders", "item_type": "Route", "route": "/stock", "is_standard": 0})
	nav.flags.ignore_permissions = True
	nav.save()


def _company():
	return frappe.defaults.get_global_default("company") or frappe.get_all("Company", pluck="name", limit=1)[0]


def seed_settings():
	s = frappe.get_single("ServePOS Stock Settings")
	company = _company()
	if not s.transit_warehouse:
		s.transit_warehouse = frappe.db.get_value("Warehouse", {"warehouse_type": "Transit", "company": company, "is_group": 0}, "name")
	if not s.write_off_account:
		s.write_off_account = frappe.get_cached_value("Company", company, "stock_adjustment_account")
	if not s.role_access:
		for role, page, desk in [
			("ServePOS Outlet User", "/stock", 0),
			("ServePOS CK Provider", "/stock", 0),
			("ServePOS Pastry Provider", "/stock", 0),
			("Stock Manager", "/stock", 1),
			("Purchase User", "/stock/buy", 1),
		]:
			s.append("role_access", {"role": role, "landing_page": page, "allow_desk": desk})
	if not s.get("amount_access_seeded"):
		# prices and values: the Store and procurement yes, outlets and kitchens no
		for row in s.role_access:
			row.show_amounts = 1 if row.role in ("Stock Manager", "Purchase User", "Purchase Manager", "Accounts Manager") else 0
			if row.landing_page == "/stock/picking":
				row.landing_page = "/stock"  # providers now land on their Today dashboard
		s.amount_access_seeded = 1
	s.flags.ignore_mandatory = True
	s.save(ignore_permissions=True)


def _location(name, wh, ltype, **kw):
	if frappe.db.exists("ServePOS Stock Location", {"warehouse": wh}):
		return frappe.db.get_value("ServePOS Stock Location", {"warehouse": wh}, "name")
	if not frappe.db.exists("Warehouse", wh):
		return None
	doc = frappe.get_doc({"doctype": "ServePOS Stock Location", "location_name": name, "warehouse": wh, "location_type": ltype, **kw})
	doc.insert(ignore_permissions=True)
	return doc.name


def seed_locations():
	"""Providers from the known warehouses; outlets from POS Profiles and User Permissions."""
	if frappe.db.count("ServePOS Stock Location"):
		return
	ck_wh = frappe.db.get_value("Warehouse", {"name": ["like", "Central Kitchen%"], "is_group": 0}, "name")
	store = _location("Store", "Stores - N", "Provider", color="#5F9E45", buys_from_suppliers=1, ship_role="Stock Manager")
	if ck_wh:
		_location("Central Kitchen", ck_wh, "Provider", color="#D9432F", orders_from=store, markup_percent=2.5,
			ship_role="ServePOS CK Provider", record_production_for_shortfall=1)
	_location("Pastry", "PASTRY - N", "Provider", color="#E2B23B", orders_from=store,
		ship_role="ServePOS Pastry Provider", record_production_for_shortfall=1)

	excluded = {"Salt and Leaf - N"}
	labels = set()

	def label_of(wh):
		return re.sub(r"\s*-\s*N$", "", wh).replace("WBB - ", "WBB ").strip()

	# 1. Warehouses users actually work in (User Permissions) come first.
	for wh in frappe.get_all("User Permission", filters={"allow": "Warehouse"}, pluck="for_value", distinct=True):
		if wh in excluded or frappe.db.get_value("Warehouse", wh, "is_group") or frappe.db.exists("ServePOS Stock Location", {"warehouse": wh}):
			continue
		label = label_of(wh)
		profile = frappe.db.get_value("POS Profile", {"warehouse": wh, "disabled": 0}, ["name", "branch"], as_dict=True) or {}
		labels.add(label.lower())
		_location(label, wh, "Outlet", location_group="WBB" if label.upper().startswith("WBB") else "NAMI",
			pos_profile=profile.get("name"), branch=profile.get("branch"))
	# 2. POS Profile warehouses not already covered under the same outlet name.
	for p in frappe.get_all("POS Profile", fields=["name", "warehouse", "branch"], filters={"disabled": 0}):
		if not p.warehouse or p.warehouse in excluded or frappe.db.exists("ServePOS Stock Location", {"warehouse": p.warehouse}):
			continue
		if p.name.lower() in labels or label_of(p.warehouse).lower() in labels:
			frappe.log_error(f"POS Profile {p.name} uses {p.warehouse}, but users order for another warehouse with the same outlet name. Resolve the duplicate.", "ServePOS Stock Orders setup")
			continue
		labels.add(p.name.lower())
		_location(p.name, p.warehouse, "Outlet", branch=p.branch, pos_profile=p.name,
			location_group="WBB" if p.name.upper().startswith("WBB") else "NAMI")


def seed_item_providers():
	"""Semi-finished pastry items -> Pastry, other semi-finished -> CK, every other stock item -> Store."""
	locs = {l.location_name: l.name for l in frappe.get_all("ServePOS Stock Location", fields=["name", "location_name"], filters={"location_type": "Provider"})}
	if not locs:
		return
	items = frappe.get_all("Item", fields=["name", "item_name", "item_group"],
		filters={"is_stock_item": 1, "disabled": 0, "servepos_stock_provider": ["is", "not set"]})
	for it in items:
		if it.item_group == "Semi Finished Goods":
			prov = locs.get("Pastry") if PASTRY_PATTERNS.search(it.item_name or "") else locs.get("Central Kitchen")
		else:
			prov = locs.get("Store")
		if prov:
			frappe.db.set_value("Item", it.name, "servepos_stock_provider", prov, update_modified=False)


def _norm(name):
	"""Branch names on site carry invisible characters and word order differs ('WBB Pizza & Burger')."""
	import unicodedata
	clean = "".join(ch for ch in (name or "") if unicodedata.category(ch)[0] != "C")
	return frozenset(w for w in re.split(r"[^a-z0-9]+", clean.lower()) if w)


def assign_branches():
	"""Branch accounting dimension per location: the POS Profile's branch for outlets, a branch of the
	same name otherwise (invisible characters and word order ignored); providers get a Branch of their
	own name when none exists. Existing values are never changed."""
	if not frappe.db.exists("DocType", "Branch"):
		return []
	branches = {_norm(b): b for b in frappe.get_all("Branch", pluck="name")}
	done = []
	for loc in frappe.get_all("ServePOS Stock Location", fields=["name", "location_name", "location_type", "pos_profile", "branch"]):
		if loc.branch:
			continue
		b = frappe.db.get_value("POS Profile", loc.pos_profile, "branch") if loc.pos_profile else None
		b = b or branches.get(_norm(loc.location_name))
		if not b and loc.location_type == "Provider":
			frappe.get_doc({"doctype": "Branch", "branch": loc.location_name}).insert(ignore_permissions=True)
			b = loc.location_name
		if b:
			frappe.db.set_value("ServePOS Stock Location", loc.name, "branch", b)
			done.append((loc.name, b))
	return done


def history_sources():
	"""Item -> Counter of providers it was actually requested from (Material Transfer requests)."""
	provs = {l.warehouse: l.name for l in frappe.get_all("ServePOS Stock Location",
		filters={"location_type": "Provider"}, fields=["name", "warehouse"])}
	rows = frappe.db.sql("""select mri.item_code, coalesce(nullif(mri.from_warehouse, ''), mr.set_from_warehouse) src
		from `tabMaterial Request Item` mri join `tabMaterial Request` mr on mr.name = mri.parent
		where mr.docstatus < 2 and mr.material_request_type = 'Material Transfer'""", as_dict=True)
	out = defaultdict(Counter)
	for r in rows:
		if provs.get(r.src):
			out[r.item_code][provs[r.src]] += 1
	return out


def apply_history_providers():
	"""Where an item was really requested from wins over the name-based guess: the most frequent
	provider becomes the default and any other one goes to 'Also Ordered From'."""
	changed = []
	for code, counts in history_sources().items():
		if not frappe.db.exists("Item", code):
			continue
		ranked = [p for p, _n in counts.most_common()]
		current = frappe.db.get_value("Item", code, "servepos_stock_provider")
		if current != ranked[0]:
			frappe.db.set_value("Item", code, "servepos_stock_provider", ranked[0], update_modified=False)
		have = set(frappe.get_all("ServePOS Item Provider", filters={"parent": code, "parenttype": "Item"}, pluck="provider"))
		idx = len(have)
		for p in ranked[1:]:
			if p in have:
				continue
			idx += 1
			frappe.get_doc({"doctype": "ServePOS Item Provider", "provider": p, "parent": code, "parenttype": "Item",
				"parentfield": "servepos_also_from", "idx": idx}).db_insert()
		if current != ranked[0] or len(ranked) > 1:
			changed.append((code, current, ranked))
	return changed


def seed_order_lists():
	"""Each location's lists from what it actually requested in Material Requests."""
	if frappe.db.count("ServePOS Order List"):
		return
	loc_by_wh = {l.warehouse: l.name for l in frappe.get_all("ServePOS Stock Location", fields=["name", "warehouse"])}
	rows = frappe.db.sql("""
		select mri.warehouse, mri.item_code, mri.uom, mri.qty,
			coalesce(src.name, i.servepos_stock_provider) provider
		from `tabMaterial Request Item` mri
		join `tabMaterial Request` mr on mr.name = mri.parent
		join `tabItem` i on i.name = mri.item_code
		left join `tabServePOS Stock Location` src on src.location_type = 'Provider'
			and src.warehouse = coalesce(nullif(mri.from_warehouse, ''), mr.set_from_warehouse)
		where mr.docstatus < 2 and i.disabled = 0 and i.is_stock_item = 1""", as_dict=True)
	lists = defaultdict(lambda: defaultdict(list))
	for r in rows:
		loc = loc_by_wh.get(r.warehouse)
		if not loc or not r.provider or r.provider == loc:
			continue
		lists[(loc, r.provider)][r.item_code].append((r.uom, r.qty))
	for (loc, prov), items in lists.items():
		doc = frappe.new_doc("ServePOS Order List")
		doc.location, doc.provider = loc, prov
		# most frequently requested first
		for code, hist in sorted(items.items(), key=lambda kv: -len(kv[1])):
			uom = Counter(u for u, _ in hist).most_common(1)[0][0]
			qtys = sorted(q for u, q in hist if u == uom)
			doc.append("items", {"item_code": code, "uom": uom, "usual_qty": qtys[len(qtys) // 2]})
		doc.insert(ignore_permissions=True)


def setup(seed=True, sync=True):
	"""sync=False during bench migrate, which already syncs doctypes from JSON."""
	if sync:
		sync_doctypes()
	create_roles()
	create_fields()
	create_print_formats()
	add_desk_link()
	frappe.clear_cache()
	seed_settings()
	if seed:
		seed_locations()
		assign_branches()
		first_time = not frappe.db.count("ServePOS Order List")
		seed_item_providers()
		if first_time:
			apply_history_providers()
		seed_order_lists()
	from servepos.stock_orders.access import sync_roles
	sync_roles()
	frappe.db.commit()


@frappe.whitelist()
def run():
	"""Re-run setup from the browser (System Manager): schema, fields, roles, print formats, seeds."""
	frappe.only_for("System Manager")
	setup(seed=True, sync=True)
	return "done"
