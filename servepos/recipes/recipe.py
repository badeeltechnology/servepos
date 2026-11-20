"""Recipes for menu items: a recipe is the item's default BOM.

A menu item is a service (non-stock) item. Its recipe lists stock ingredients (or another menu item / prep
recipe, which is expanded). Each line keeps the usable amount the cook puts in the dish and a yield %;
the BOM quantity is the raw amount that leaves stock: usable / yield.
"""
import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from servepos.api.admin import _assert


def _company():
	return frappe.defaults.get_global_default("company") or frappe.get_all("Company", pluck="name", limit=1)[0]


def unit_cost(item_codes):
	"""Average valuation rate per stock unit across warehouses, else the item's valuation or last purchase rate."""
	out = {}
	codes = list({c for c in item_codes if c})
	if not codes:
		return out
	for r in frappe.db.sql("""select item_code, sum(stock_value) / nullif(sum(actual_qty), 0) as rate from `tabBin`
			where item_code in %(c)s and actual_qty > 0 group by item_code""", {"c": tuple(codes)}, as_dict=True):
		if r.rate:
			out[r.item_code] = flt(r.rate)
	for it in frappe.get_all("Item", filters={"name": ["in", codes]}, fields=["name", "valuation_rate", "last_purchase_rate"]):
		out.setdefault(it.name, flt(it.valuation_rate) or flt(it.last_purchase_rate))
	return out


def default_bom(item_code):
	return frappe.db.get_value("BOM", {"item": item_code, "is_default": 1, "is_active": 1, "docstatus": 1}, "name")


@frappe.whitelist()
def get_recipe(item):
	_assert()
	it = frappe.db.get_value("Item", item, ["name", "item_name", "standard_rate", "is_stock_item", "stock_uom"], as_dict=True)
	bom = default_bom(item)
	lines = []
	if bom:
		doc = frappe.get_doc("BOM", bom)
		per = flt(doc.quantity) or 1
		for b in doc.items:
			y = flt(b.get("servepos_yield_percent")) or 100
			usable = flt(b.get("servepos_usable_qty")) or flt(b.qty) * y / 100
			lines.append({"item_code": b.item_code, "item_name": b.item_name, "uom": b.uom, "stock_uom": b.stock_uom,
				"conversion_factor": flt(b.conversion_factor) or 1, "qty": usable / per, "yield_percent": y})
	costs = unit_cost([l["item_code"] for l in lines])
	info = {i.name: i for i in frappe.get_all("Item", filters={"name": ["in", [l["item_code"] for l in lines] or ["-"]]},
		fields=["name", "is_stock_item", "stock_uom"])}
	for l in lines:
		l["uoms"] = _uoms(l["item_code"])
		l["is_recipe"] = not cint((info.get(l["item_code"]) or {}).get("is_stock_item"))
		l["unit_cost"] = costs.get(l["item_code"], 0) if not l["is_recipe"] else recipe_cost(l["item_code"])
	versions = frappe.get_all("BOM", filters={"item": item, "docstatus": 1}, fields=["name", "creation", "is_default", "total_cost"], order_by="creation desc", limit=10)
	return {"item": it, "bom": bom, "lines": lines, "versions": versions}


def _uoms(item_code):
	stock_uom = frappe.get_cached_value("Item", item_code, "stock_uom")
	rows = frappe.get_all("UOM Conversion Detail", filters={"parent": item_code, "parenttype": "Item"}, fields=["uom", "conversion_factor"])
	out = [{"uom": stock_uom, "factor": 1}]
	out += [{"uom": r.uom, "factor": flt(r.conversion_factor)} for r in rows if r.uom != stock_uom]
	return out


def recipe_cost(item_code, depth=0):
	"""Cost of one unit of a menu item or prep recipe, from today's ingredient costs."""
	bom = default_bom(item_code)
	if not bom or depth > 5:
		return 0
	doc = frappe.get_doc("BOM", bom)
	costs = unit_cost([b.item_code for b in doc.items])
	total = 0
	for b in doc.items:
		rate = costs.get(b.item_code) if frappe.get_cached_value("Item", b.item_code, "is_stock_item") else recipe_cost(b.item_code, depth + 1)
		total += flt(b.stock_qty) * flt(rate)
	return total / (flt(doc.quantity) or 1)


@frappe.whitelist()
def search_ingredients(txt="", exclude=None):
	"""Stock items, and menu items or prep recipes that have a recipe of their own."""
	_assert()
	or_f = {"item_name": ["like", f"%{txt}%"], "name": ["like", f"%{txt}%"]} if txt else None
	rows = frappe.get_all("Item", filters={"disabled": 0, "has_variants": 0}, or_filters=or_f, fields=["name", "item_name", "stock_uom", "is_stock_item", "item_group"],
		order_by="is_stock_item desc, item_name asc", limit=60)
	out = []
	for r in rows:
		if r.name == exclude:
			continue
		if not r.is_stock_item and not default_bom(r.name):
			continue
		out.append(r)
		if len(out) >= 20:
			break
	costs = unit_cost([r.name for r in out if r.is_stock_item])
	for r in out:
		r.uoms = _uoms(r.name)
		r.unit_cost = costs.get(r.name, 0) if r.is_stock_item else recipe_cost(r.name)
		r.is_recipe = not r.is_stock_item
	return out


@frappe.whitelist(methods=["POST"])
def save_recipe(item, lines):
	"""Save a new recipe version (a submitted BOM) and make it the default."""
	_assert()
	lines = json.loads(lines) if isinstance(lines, str) else (lines or [])
	if frappe.db.get_value("Item", item, "is_stock_item"):
		frappe.throw(_("{0} is a stock item. Recipes are for menu items that are not kept in stock.").format(item))
	rows = []
	for l in lines:
		code = l.get("item_code")
		qty = flt(l.get("qty"))
		y = flt(l.get("yield_percent")) or 100
		if not code:
			continue
		if code == item:
			frappe.throw(_("A recipe cannot contain its own item"))
		if qty <= 0:
			frappe.throw(_("Enter a quantity for {0}").format(code))
		if y <= 0 or y > 100:
			frappe.throw(_("Yield for {0} must be between 1 and 100 %").format(code))
		uom = l.get("uom") or frappe.get_cached_value("Item", code, "stock_uom")
		rows.append({"item_code": code, "uom": uom, "qty": qty / (y / 100), "servepos_usable_qty": qty, "servepos_yield_percent": y,
			"rate": 0})
	if not rows:
		frappe.throw(_("Add at least one ingredient"))
	bom = frappe.get_doc({"doctype": "BOM", "item": item, "company": _company(), "quantity": 1, "uom": frappe.get_cached_value("Item", item, "stock_uom"),
		"rm_cost_as_per": "Valuation Rate", "is_active": 1, "is_default": 1, "with_operations": 0, "items": rows})
	bom.flags.ignore_permissions = True
	bom.insert()
	bom.submit()
	for old in frappe.get_all("BOM", filters={"item": item, "docstatus": 1, "name": ["!=", bom.name], "is_active": 1}, pluck="name"):
		frappe.db.set_value("BOM", old, {"is_default": 0, "is_active": 0})
	frappe.db.set_value("Item", item, "default_bom", bom.name)
	return get_recipe(item)


@frappe.whitelist(methods=["POST"])
def remove_recipe(item):
	_assert()
	for b in frappe.get_all("BOM", filters={"item": item, "docstatus": 1, "is_active": 1}, pluck="name"):
		frappe.db.set_value("BOM", b, {"is_default": 0, "is_active": 0})
	frappe.db.set_value("Item", item, "default_bom", None)
	return {"ok": 1}
