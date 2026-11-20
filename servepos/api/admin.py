"""Backend for the manager app (/manage): every read and write the admin screens make.

All endpoints need a ServePOS Manager (or System Manager); sales reads also allow a ServePOS
Reporter. Writes go through documents (so validations and hooks run) and bump `modified`, so the
the POS picks changes up on their next sync. Outlet visibility reuses servepos.api.menu_admin, which is
the one place that knows the availability rules.
"""
import json
import re

import frappe
from frappe import _
from frappe.utils import cint, flt, get_url, getdate, nowdate

from servepos.api import menu_admin, registry

MANAGER_ROLES = {"System Manager", "ServePOS Manager"}
REPORT_ROLES = MANAGER_ROLES | {"ServePOS Reporter"}
NOT_MENU_GROUPS = {"All Item Groups", "Raw Material", "Sub Assemblies", "Consumable", "Services"}


# ---------------------------------------------------------------- helpers

def _assert(roles=MANAGER_ROLES):
	if frappe.session.user == "Administrator":
		return
	if not (set(frappe.get_roles()) & roles):
		frappe.throw(_("You need the ServePOS Manager role for this"), frappe.PermissionError)


def _data(data):
	return frappe._dict(json.loads(data) if isinstance(data, str) else (data or {}))


def _list(v):
	if v in (None, ""):
		return []
	if isinstance(v, str):
		v = v.strip()
		if v.startswith("["):
			return json.loads(v)
		return [x.strip() for x in v.split(",") if x.strip()]
	return list(v)


def _profiles():
	return frappe.get_all("POS Profile", filters={"disabled": 0}, fields=["name", "branch"], order_by="name asc")


def _has(doctype, field):
	return frappe.get_meta(doctype).has_field(field)


def _rename(doctype, old, new):
	"""Records named by a field (table_name, waiter_name...) are renamed when that field changes."""
	if old and new and old != new:
		if frappe.db.exists(doctype, new):
			frappe.throw(_("{0} {1} already exists").format(_(doctype), new))
		frappe.rename_doc(doctype, old, new, force=True)
	return new or old


def _delete(doctype, name):
	try:
		frappe.delete_doc(doctype, name)
	except frappe.LinkExistsError:
		frappe.throw(_("{0} is used elsewhere, so it cannot be deleted. Turn it off instead.").format(name))
	return {"ok": 1}


def menu_groups():
	flagged = frappe.get_all("Item Group", filters={"servepos_is_menu_group": 1, "is_group": 0}, pluck="name", order_by="name asc")
	if flagged:
		return flagged
	return [g for g in frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", order_by="name asc") if g not in NOT_MENU_GROUPS]


@frappe.whitelist()
def get_setup():
	"""Lists every admin screen needs: outlets, branches, menu categories, modifier groups."""
	_assert()
	return {
		"profiles": _profiles(),
		"branches": frappe.get_all("Branch", pluck="name", order_by="name asc") if frappe.db.exists("DocType", "Branch") else [],
		"groups": menu_groups(),
		"modifier_groups": frappe.get_all("ServePOS Modifier Group", pluck="name", order_by="name asc"),
		"site_url": get_url(),
		"is_system_manager": "System Manager" in frappe.get_roles() or frappe.session.user == "Administrator",
	}


# ---------------------------------------------------------------- menu items

ITEM_FIELDS = ["name", "item_name", "item_group", "standard_rate", "image", "servepos_item_name_ar",
	"servepos_is_disabled", "servepos_is_available", "disabled"]


@frappe.whitelist()
def list_items(search=None, item_group=None, status="all", outlet=None, start=0, page_length=50):
	"""Menu items for the admin list, with the outlets each is shown on (the same rule the POS uses)."""
	_assert()
	groups = menu_groups()
	filters = {"disabled": 0, "item_group": ["in", groups or ["-"]]}
	if item_group:
		filters["item_group"] = item_group
	if status == "active":
		filters.update({"servepos_is_disabled": 0, "servepos_is_available": 1})
	elif status == "unavailable":
		filters.update({"servepos_is_disabled": 0, "servepos_is_available": 0})
	elif status == "disabled":
		filters["servepos_is_disabled"] = 1
	or_filters = None
	if search:
		s = f"%{search.strip()}%"
		or_filters = {"item_name": ["like", s], "name": ["like", s], "servepos_item_name_ar": ["like", s]}
	rows = frappe.get_all("Item", filters=filters, or_filters=or_filters, fields=ITEM_FIELDS, order_by="item_name asc", limit_page_length=0)
	codes = [r.name for r in rows]
	matrix = menu_admin.get_visibility_matrix(codes) if codes else {}
	if outlet:
		rows = [r for r in rows if (matrix.get(r.name) or {}).get(outlet, {}).get("pos")]
	total = len(rows)
	start, page_length = cint(start), cint(page_length) or 50
	page = rows[start:start + page_length]
	pinned = set()
	if outlet and _has("POS Profile", "servepos_pinned_items"):
		try:
			pinned = set(json.loads(frappe.db.get_value("POS Profile", outlet, "servepos_pinned_items") or "[]"))
		except Exception:
			pinned = set()
	all_profiles = [p.name for p in _profiles()]
	for r in page:
		cells = matrix.get(r.name) or {}
		r.outlets = [p for p in all_profiles if (cells.get(p) or {}).get("pos")]
		r.web = [p for p in all_profiles if (cells.get(p) or {}).get("web")]
		r.pinned = r.name in pinned
	return {"rows": page, "total": total, "profile_count": len(all_profiles)}


@frappe.whitelist()
def get_item(name):
	_assert()
	doc = frappe.get_doc("Item", name)
	cells = menu_admin.get_visibility_matrix([name]).get(name) or {}
	rows = doc.get("servepos_availability") or []
	all_outlets = bool(rows) and any(not r.pos_profile and not r.branch and cint(r.show_on_pos) for r in rows)
	return {
		"name": doc.name, "item_name": doc.item_name, "item_group": doc.item_group, "standard_rate": flt(doc.standard_rate),
		"image": doc.image, "description": doc.description, "servepos_item_name_ar": doc.get("servepos_item_name_ar"),
		"servepos_description_ar": doc.get("servepos_description_ar"), "servepos_is_disabled": cint(doc.get("servepos_is_disabled")),
		"servepos_is_available": cint(doc.get("servepos_is_available")), "is_stock_item": cint(doc.is_stock_item),
		"servepos_kitchen_station": doc.get("servepos_kitchen_station"),
		"modifier_groups": [{"modifier_group": m.modifier_group, "is_required": cint(m.is_required)} for m in sorted(doc.get("servepos_modifier_groups") or [], key=lambda m: cint(m.display_order))],
		"outlets": {p: {"pos": bool(c.get("pos")), "web": bool(c.get("web"))} for p, c in cells.items()},
		"all_outlets": all_outlets,
	}


def _item_code(item_name):
	base = re.sub(r"[^A-Z0-9]+", "-", (item_name or "").upper()).strip("-")[:30] or "ITEM"
	code, n = base, 1
	while frappe.db.exists("Item", code):
		n += 1
		code = f"{base}-{n}"
	return code


def _availability_rows(outlets, all_outlets, web_all, profiles):
	if cint(all_outlets):
		return [{"branch": "", "pos_profile": "", "show_on_pos": 1, "show_on_website": cint(web_all)}]
	rows = []
	branch = {p.name: p.branch or "" for p in profiles}
	for p, c in (outlets or {}).items():
		if p in branch and (c.get("pos") or c.get("web")):
			rows.append({"branch": branch[p], "pos_profile": p, "show_on_pos": cint(c.get("pos")), "show_on_website": cint(c.get("web"))})
	return rows or [{"branch": "", "pos_profile": "", "show_on_pos": 0, "show_on_website": 0}]


@frappe.whitelist(methods=["POST"])
def save_item(data):
	"""Create or update a menu item with its outlets and modifier groups in one save."""
	_assert()
	d = _data(data)
	if not (d.item_name or "").strip():
		frappe.throw(_("Name is required"))
	if not d.item_group:
		frappe.throw(_("Category is required"))
	if flt(d.standard_rate) < 0:
		frappe.throw(_("Price cannot be negative"))
	if d.name:
		doc = frappe.get_doc("Item", d.name)
	else:
		doc = frappe.new_doc("Item")
		doc.item_code = (d.item_code or "").strip() or _item_code(d.item_name)
		doc.stock_uom = d.stock_uom or "Nos"
		doc.is_stock_item = 0
		doc.servepos_is_available = 1
	doc.update({
		"item_name": d.item_name.strip(), "item_group": d.item_group, "standard_rate": flt(d.standard_rate),
		"description": d.description or "", "servepos_item_name_ar": d.servepos_item_name_ar or "",
		"servepos_description_ar": d.servepos_description_ar or "", "servepos_is_disabled": cint(d.servepos_is_disabled),
	})
	if "servepos_is_available" in d:
		doc.servepos_is_available = cint(d.servepos_is_available)
	if "image" in d:
		doc.image = d.image or ""
	if "modifier_groups" in d:
		doc.set("servepos_modifier_groups", [])
		for i, m in enumerate(d.modifier_groups or []):
			doc.append("servepos_modifier_groups", {"modifier_group": m.get("modifier_group"), "is_required": cint(m.get("is_required")), "display_order": i})
	if "outlets" in d or "all_outlets" in d:
		doc.set("servepos_availability", [])
		for r in _availability_rows(d.outlets, d.all_outlets, d.web_all, _profiles()):
			doc.append("servepos_availability", r)
	doc.save() if d.name else doc.insert()
	return get_item(doc.name)


@frappe.whitelist(methods=["POST"])
def bulk_items(items, action, value=None):
	"""disable / enable / available / unavailable / move (value = category) for many items at once."""
	_assert()
	codes = _list(items)
	fields = {"disable": ("servepos_is_disabled", 1), "enable": ("servepos_is_disabled", 0),
		"available": ("servepos_is_available", 1), "unavailable": ("servepos_is_available", 0), "move": ("item_group", value)}
	if action not in fields:
		frappe.throw(_("Unknown action"))
	field, val = fields[action]
	if action == "move" and val not in menu_groups():
		frappe.throw(_("Choose a menu category"))
	for code in codes:
		frappe.db.set_value("Item", code, field, val)  # bumps modified, so the POS resyncs the item
	return {"updated": len(codes)}


@frappe.whitelist(methods=["POST"])
def delete_item(name):
	_assert()
	try:
		frappe.delete_doc("Item", name)
	except (frappe.LinkExistsError, frappe.ValidationError):
		frappe.throw(_("{0} has sales or stock history, so it cannot be deleted. Disable it instead.").format(name))
	return {"ok": 1}


@frappe.whitelist()
def list_categories(outlet=None):
	"""Menu categories with item counts, in the outlet's POS order when an outlet is chosen."""
	_assert()
	groups = menu_groups()
	counts = {}
	if groups:
		for r in frappe.db.sql("""select item_group, count(*) as n from `tabItem` where disabled = 0 and item_group in %(g)s
				group by item_group""", {"g": tuple(groups)}, as_dict=True):
			counts[r.item_group] = r.n
	order = []
	if outlet:
		raw = frappe.db.get_value("POS Profile", outlet, "servepos_menu_item_order")
		try:
			order = (json.loads(raw) if raw else {}).get("_category_order") or []
		except Exception:
			order = []
	pos = {g: i for i, g in enumerate(order)}
	out = sorted(groups, key=lambda g: (pos.get(g, 10**6), g.lower()))
	return [{"name": g, "items": counts.get(g, 0)} for g in out]


@frappe.whitelist(methods=["POST"])
def create_category(name):
	_assert()
	name = (name or "").strip()
	if not name:
		frappe.throw(_("Name is required"))
	if frappe.db.exists("Item Group", name):
		frappe.db.set_value("Item Group", name, "servepos_is_menu_group", 1)
	else:
		frappe.get_doc({"doctype": "Item Group", "item_group_name": name, "parent_item_group": "All Item Groups", "is_group": 0,
			"servepos_is_menu_group": 1}).insert()
	return {"name": name}


@frappe.whitelist(methods=["POST"])
def delete_category(name):
	_assert()
	if frappe.db.count("Item", {"item_group": name}):
		frappe.throw(_("Move or delete the items in {0} first").format(name))
	return _delete("Item Group", name)


@frappe.whitelist(methods=["POST"])
def save_category_order(pos_profile, categories):
	_assert()
	registry._assert_profile(pos_profile)
	return registry.save_category_order(pos_profile, json.dumps(_list(categories)))


@frappe.whitelist()
def get_item_order(pos_profile, item_group):
	"""Items of one category as the POS lists them on this outlet."""
	_assert()
	return [{"name": i.get("item_code") or i.get("name"), "item_name": i.get("item_name"), "image": i.get("image")}
		for i in registry.get_items(pos_profile, item_group=item_group)]


@frappe.whitelist(methods=["POST"])
def save_item_order(pos_profile, item_group, items):
	_assert()
	registry._assert_profile(pos_profile)
	return registry.save_menu_item_order(pos_profile, item_group, json.dumps(_list(items)))


# ---------------------------------------------------------------- modifiers

@frappe.whitelist()
def list_modifier_groups():
	_assert()
	groups = frappe.get_all("ServePOS Modifier Group", fields=["name", "group_name", "selection_type", "is_required", "max_selections",
		"servepos_visible_profiles" if _has("ServePOS Modifier Group", "servepos_visible_profiles") else "name as _x"], order_by="group_name asc")
	options = {}
	for m in frappe.get_all("ServePOS Modifier", filters={"parenttype": "ServePOS Modifier Group"},
			fields=["name", "parent", "modifier_name", "price", "is_default", "idx"], order_by="idx asc", limit_page_length=0):
		options.setdefault(m.parent, []).append(m)
	used = {}
	for r in frappe.db.sql("""select modifier_group, count(distinct parent) as n from `tabServePOS Item Modifier Group`
			where parenttype = 'Item' group by modifier_group""", as_dict=True):
		used[r.modifier_group] = r.n
	for g in groups:
		g.options = options.get(g.name, [])
		g.items = used.get(g.name, 0)
		g.outlets = _list(g.get("servepos_visible_profiles"))
		g.pop("_x", None)
	return groups


@frappe.whitelist(methods=["POST"])
def save_modifier_group(data):
	"""Create or update a group and its options, keeping existing option rows (and their ids)."""
	_assert()
	d = _data(data)
	name = (d.group_name or "").strip()
	if not name:
		frappe.throw(_("Name is required"))
	opts = [o for o in (d.options or []) if (o.get("modifier_name") or "").strip()]
	if not opts:
		frappe.throw(_("Add at least one option"))
	if d.selection_type == "Single" and sum(1 for o in opts if cint(o.get("is_default"))) > 1:
		frappe.throw(_("A single-choice group can have only one default option"))
	if d.name:
		name = _rename("ServePOS Modifier Group", d.name, name)
		doc = frappe.get_doc("ServePOS Modifier Group", name)
	else:
		doc = frappe.new_doc("ServePOS Modifier Group")
		doc.group_name = name
	doc.selection_type = d.selection_type or "Single"
	doc.is_required = cint(d.is_required)
	doc.max_selections = cint(d.max_selections) if doc.selection_type == "Multiple" else 0
	existing = {r.name: r for r in doc.get("modifiers") or []}
	rows = []
	for o in opts:
		row = existing.get(o.get("name")) or frappe._dict()
		row.update({"modifier_name": o["modifier_name"].strip(), "price": flt(o.get("price")), "is_default": cint(o.get("is_default"))})
		rows.append(row)
	doc.set("modifiers", [])
	for r in rows:
		doc.append("modifiers", {k: v for k, v in dict(r).items() if k in ("name", "modifier_name", "price", "is_default")})
	if _has("ServePOS Modifier Group", "servepos_visible_profiles") and "outlets" in d:
		doc.servepos_visible_profiles = ",".join(_list(d.outlets))
	doc.save() if d.name else doc.insert()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def delete_modifier_group(name):
	_assert()
	n = frappe.db.count("ServePOS Item Modifier Group", {"modifier_group": name})
	if n:
		frappe.throw(_("{0} is used on {1} items. Remove it from those items first.").format(name, n))
	return _delete("ServePOS Modifier Group", name)


@frappe.whitelist(methods=["POST"])
def assign_modifier_group(group, items, mode="add"):
	"""Add a modifier group to many items at once (or take it off)."""
	_assert()
	done = 0
	for code in _list(items):
		doc = frappe.get_doc("Item", code)
		rows = [r for r in doc.get("servepos_modifier_groups") or [] if r.modifier_group != group]
		if mode == "add":
			rows.append(frappe._dict({"modifier_group": group, "is_required": 0, "display_order": len(rows)}))
		doc.set("servepos_modifier_groups", [{"modifier_group": r.modifier_group, "is_required": cint(r.is_required), "display_order": i} for i, r in enumerate(rows)])
		doc.save()
		done += 1
	return {"updated": done}


# ---------------------------------------------------------------- floor: rooms, tables, QR

@frappe.whitelist()
def list_floor(branch=None):
	_assert()
	f = {"branch": branch} if branch else {}
	rooms = frappe.get_all("ServePOS Room", filters=f, fields=["name", "room_name", "description", "is_active", "branch"], order_by="room_name asc")
	tables = frappe.get_all("ServePOS Table", filters=f, fields=["name", "table_name", "room", "capacity", "is_active", "branch", "shape", "status"],
		order_by="table_name asc", limit_page_length=0)
	return {"rooms": rooms, "tables": tables}


@frappe.whitelist(methods=["POST"])
def save_room(data):
	_assert()
	d = _data(data)
	name = (d.room_name or "").strip()
	if not name:
		frappe.throw(_("Name is required"))
	if d.name:
		name = _rename("ServePOS Room", d.name, name)
		doc = frappe.get_doc("ServePOS Room", name)
	else:
		doc = frappe.new_doc("ServePOS Room")
		doc.room_name = name
		doc.is_active = 1
	doc.description = d.description or ""
	doc.branch = d.branch or None
	if "is_active" in d:
		doc.is_active = cint(d.is_active)
	doc.save() if d.name else doc.insert()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def delete_room(name):
	_assert()
	if frappe.db.count("ServePOS Table", {"room": name}):
		frappe.throw(_("Move or delete the tables in {0} first").format(name))
	return _delete("ServePOS Room", name)


@frappe.whitelist(methods=["POST"])
def save_table(data):
	_assert()
	d = _data(data)
	name = (d.table_name or "").strip()
	if not name:
		frappe.throw(_("Name is required"))
	if not d.room:
		frappe.throw(_("Choose a room"))
	if d.name:
		name = _rename("ServePOS Table", d.name, name)
		doc = frappe.get_doc("ServePOS Table", name)
	else:
		doc = frappe.new_doc("ServePOS Table")
		doc.table_name = name
		doc.is_active = 1
	doc.room = d.room
	doc.capacity = max(cint(d.capacity) or 4, 1)
	doc.branch = d.branch or frappe.db.get_value("ServePOS Room", d.room, "branch") or None
	if d.shape:
		doc.shape = d.shape
	if "is_active" in d:
		doc.is_active = cint(d.is_active)
	doc.save() if d.name else doc.insert()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def add_tables(room, prefix, start, count, capacity=4):
	"""Add a run of tables at once: prefix T, start 1, count 10 makes T1 to T10."""
	_assert()
	made = []
	branch = frappe.db.get_value("ServePOS Room", room, "branch")
	for i in range(cint(start), cint(start) + min(cint(count), 200)):
		name = f"{(prefix or '').strip()}{i}"
		if frappe.db.exists("ServePOS Table", name):
			continue
		frappe.get_doc({"doctype": "ServePOS Table", "table_name": name, "room": room, "capacity": max(cint(capacity), 1),
			"branch": branch, "is_active": 1}).insert()
		made.append(name)
	return {"created": made}


@frappe.whitelist(methods=["POST"])
def delete_table(name):
	_assert()
	return _delete("ServePOS Table", name)


def table_url(name):
	from urllib.parse import quote
	return f"{get_url()}/call-waiter/{quote(name)}"


@frappe.whitelist()
def table_qr(tables):
	"""SVG QR codes for tables, made on this server (no outside service)."""
	_assert()
	import io

	import qrcode
	import qrcode.image.svg

	out = []
	for name in _list(tables)[:1000]:
		url = table_url(name)
		img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
		buf = io.BytesIO()
		img.save(buf)
		out.append({"name": name, "url": url, "svg": buf.getvalue().decode()})
	return out


# ---------------------------------------------------------------- staff (waiters)

@frappe.whitelist()
def list_waiters():
	_assert()
	from servepos.api.mobile import admin as mobile_admin

	waiters = frappe.get_all("ServePOS Waiter", fields=["name", "waiter_name", "phone", "is_active", "branch", "servepos_visible_profiles", "user"],
		order_by="waiter_name asc", limit_page_length=0)
	logins = mobile_admin.app_login_overview() or {}
	for w in waiters:
		w.outlets = _list(w.pop("servepos_visible_profiles", None))
		w.login = logins.get(w.name)
	return waiters


@frappe.whitelist(methods=["POST"])
def save_waiter(data):
	_assert()
	d = _data(data)
	name = (d.waiter_name or "").strip()
	if not name:
		frappe.throw(_("Name is required"))
	pin = str(d.pin or "").strip()
	if pin and not re.fullmatch(r"\d{4,6}", pin):
		frappe.throw(_("PIN must be 4 to 6 digits"))
	if not d.name and not pin:
		frappe.throw(_("Set a PIN for the new waiter"))
	if d.name:
		name = _rename("ServePOS Waiter", d.name, name)
		doc = frappe.get_doc("ServePOS Waiter", name)
	else:
		doc = frappe.new_doc("ServePOS Waiter")
		doc.waiter_name = name
		doc.is_active = 1
	doc.phone = d.phone or None
	if pin:
		doc.pin = pin
	if "branch" in d:
		doc.branch = d.branch or None
	if "is_active" in d:
		doc.is_active = cint(d.is_active)
	if "outlets" in d:
		doc.servepos_visible_profiles = ",".join(_list(d.outlets))
	doc.save() if d.name else doc.insert()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def delete_waiter(name):
	_assert()
	if frappe.db.get_value("ServePOS Waiter", name, "user"):
		from servepos.api.mobile import admin as mobile_admin

		mobile_admin.remove_app_login(name)
	return _delete("ServePOS Waiter", name)


# ---------------------------------------------------------------- offers: promos and vouchers

@frappe.whitelist()
def list_promos():
	_assert()
	extra = ["servepos_visible_profiles"] if _has("ServePOS Promo", "servepos_visible_profiles") else []
	rows = frappe.get_all("ServePOS Promo", fields=["name", "promo_name", "enabled", "pos_profile", "discount_type", "discount_value", "description"] + extra,
		order_by="promo_name asc")
	for r in rows:
		outlets = _list(r.pop("servepos_visible_profiles", None))
		r.outlets = outlets or ([r.pos_profile] if r.pos_profile else [])
	return rows


@frappe.whitelist(methods=["POST"])
def save_promo(data):
	_assert()
	d = _data(data)
	name = (d.promo_name or "").strip()
	if not name:
		frappe.throw(_("Name is required"))
	value = flt(d.discount_value)
	if value <= 0 or (d.discount_type == "Percentage" and value > 100):
		frappe.throw(_("Discount must be more than 0, and at most 100 for a percentage"))
	if d.name:
		name = _rename("ServePOS Promo", d.name, name)
		doc = frappe.get_doc("ServePOS Promo", name)
	else:
		doc = frappe.new_doc("ServePOS Promo")
		doc.promo_name = name
		doc.enabled = 1
	doc.discount_type = d.discount_type or "Percentage"
	doc.discount_value = value
	doc.description = d.description or ""
	if "enabled" in d:
		doc.enabled = cint(d.enabled)
	outlets = _list(d.outlets)
	if _has("ServePOS Promo", "servepos_visible_profiles"):
		doc.servepos_visible_profiles = ",".join(outlets)
		doc.pos_profile = None
	else:
		doc.pos_profile = outlets[0] if len(outlets) == 1 else None
	doc.save() if d.name else doc.insert()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def delete_promo(name):
	_assert()
	return _delete("ServePOS Promo", name)


@frappe.whitelist()
def list_vouchers(search=None):
	_assert()
	f = {"code": ["like", f"%{search.strip()}%"]} if search else {}
	rows = frappe.get_all("ServePOS Voucher", filters=f, fields=["name", "code", "is_active", "pos_profile", "discount_percent", "max_uses",
		"times_used", "expires_on", "description", "creation"], order_by="creation desc", limit_page_length=0)
	today = getdate(nowdate())
	for r in rows:
		if not r.is_active:
			r.state = "Off"
		elif r.expires_on and getdate(r.expires_on) < today:
			r.state = "Expired"
		elif cint(r.max_uses) and cint(r.times_used) >= cint(r.max_uses):
			r.state = "Used up"
		else:
			r.state = "Active"
	return rows


def _check_voucher(d):
	pct = flt(d.discount_percent)
	if pct <= 0 or pct > 100:
		frappe.throw(_("Discount must be between 1 and 100 %"))
	if cint(d.max_uses) < 0:
		frappe.throw(_("Max uses cannot be negative"))
	if not d.expires_on:
		frappe.throw(_("Set an expiry date"))


@frappe.whitelist(methods=["POST"])
def save_voucher(data):
	_assert()
	d = _data(data)
	_check_voucher(d)
	if d.name:
		doc = frappe.get_doc("ServePOS Voucher", d.name)
	else:
		doc = frappe.new_doc("ServePOS Voucher")
		code = str(d.code or "").strip()
		if code:
			if not re.fullmatch(r"\d{6}", code):
				frappe.throw(_("Code must be 6 digits, or leave it empty to generate one"))
			if frappe.db.exists("ServePOS Voucher", {"code": code}):
				frappe.throw(_("Code {0} is already used").format(code))
			doc.code = code
		doc.is_active = 1
	doc.update({"discount_percent": flt(d.discount_percent), "max_uses": cint(d.max_uses), "expires_on": d.expires_on,
		"pos_profile": d.pos_profile or None, "description": d.description or ""})
	if "is_active" in d:
		doc.is_active = cint(d.is_active)
	doc.save() if d.name else doc.insert()
	return {"name": doc.name, "code": doc.code}


@frappe.whitelist(methods=["POST"])
def generate_vouchers(data):
	"""Make many single-code vouchers with the same terms (e.g. 50 one-time 10 % codes)."""
	_assert()
	d = _data(data)
	_check_voucher(d)
	count = min(max(cint(d.count), 1), 500)
	codes = []
	for _i in range(count):
		doc = frappe.get_doc({"doctype": "ServePOS Voucher", "is_active": 1, "discount_percent": flt(d.discount_percent),
			"max_uses": cint(d.max_uses), "expires_on": d.expires_on, "pos_profile": d.pos_profile or None, "description": d.description or ""})
		doc.insert()
		codes.append(doc.code)
	return {"codes": codes}


@frappe.whitelist(methods=["POST"])
def delete_voucher(name):
	_assert()
	if cint(frappe.db.get_value("ServePOS Voucher", name, "times_used")):
		frappe.throw(_("This voucher has been used, so it is kept for the records. Turn it off instead."))
	return _delete("ServePOS Voucher", name)
