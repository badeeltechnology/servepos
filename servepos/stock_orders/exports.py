"""PDF, Excel and print output for Stock Orders.

Every document is built once as a `sheet` (title, meta, columns, rows) and rendered either as a
PDF (servepos/templates/stock/base.html), an Excel file, or inside an ERPNext print format.
Downloads: /api/method/servepos.stock_orders.exports.download?kind=...&fmt=pdf|xlsx&...
"""
import json

import frappe
from frappe import _
from frappe.utils import flt, format_date, format_datetime, getdate, nowdate

from servepos.stock_orders import api
from servepos.stock_orders.utils import assert_can, can_act_for, item_info, location


def _n(v, d=3):
	if v in (None, ""):
		return ""
	v = round(flt(v), d)
	return f"{v:,.{d}f}".rstrip("0").rstrip(".") if d else f"{v:,.0f}"


def _who(u):
	return frappe.utils.get_fullname(u) if u else ""


def _dt(v):
	return format_datetime(v, "dd MMM HH:mm") if v else ""


# ---------------------------------------------------------------- sheets

def sheet_order(name):
	g = api.get_order(name)
	d = frappe._dict(g["doc"])
	kind = {"Order": "Stock order", "Transfer": "Transfer", "Return": "Return", "Delivery": "Delivery"}[d.order_type]
	shipped, received = bool(d.shipped_on), bool(d.received_on)
	cols = [("Item", "l"), ("Code", "l"), ("UOM", "l"), ("Ordered", "r"), ("Shipped", "r"), ("Received", "r"), ("Difference", "r"), ("Remark", "l")]
	rows = []
	for l in g["lines"]:
		rows.append([l["item_name"], l["item_code"], l["uom"], _n(l["qty_ordered"]),
			_n(l["qty_shipped"]) if shipped else "", _n(l["qty_received"]) if received else "",
			(_n(-l["difference"]) if flt(l["difference"]) else "0") if received else "",
			" ".join(filter(None, [_("Not available") if l["is_86"] and shipped else "", l["resolution"] or "", l["remark"] or ""]))])
	return {
		"title": f"{kind} {d.name}", "subtitle": d.status,
		"meta": [("From", d.from_location), ("To", d.to_location), ("For", format_date(d.for_date)),
			("Ordered", f"{_dt(d.submitted_on)} {_who(d.requested_by)}"), ("Shipped", f"{_dt(d.shipped_on)} {_who(d.shipped_by)}"),
			("Received", f"{_dt(d.received_on)} {_who(d.received_by)}")],
		"columns": cols, "rows": rows, "signatures": ["Prepared by", "Delivered by", "Received by"],
		"filename": d.name,
	}


def sheet_count(location_name, count_date=None):
	"""The count sheet: blank to count on paper, or filled once submitted."""
	inv = api.get_inventory(location_name, count_date)
	filled = inv["status"] != "Counting"
	cols = [("Item", "l"), ("Code", "l"), ("UOM", "l"), ("Counted", "r")]
	if filled and inv["show_system"]:
		cols += [("System", "r"), ("Difference", "r")]
	rows, last = [], None
	for l in sorted(inv["lines"], key=lambda x: ((x.get("provider") or "zz"), x["item_name"])):
		if (l.get("provider") or "Other") != last:
			last = l.get("provider") or "Other"
			rows.append({"group": last})
		row = [l["item_name"], l["item_code"], l["uom"], _n(l.get("counted")) if l.get("counted") is not None else ("" if filled else None)]
		if filled and inv["show_system"]:
			row += [_n(l.get("system")), _n(l.get("difference")) if l.get("counted") is not None else ""]
		rows.append(row)
	when = format_date(inv["count_date"]) + (" " + str(inv.get("count_time") or "")[:5] if inv.get("count_time") else "")
	return {
		"title": f"Inventory count: {location_name}", "subtitle": inv["status"] if filled else "Count sheet",
		"meta": [("Location", location_name), ("Count date", when), ("Status", inv["status"]), ("Reconciliation", inv.get("reconciliation") or "")],
		"columns": cols, "rows": rows, "signatures": ["Counted by", "Checked by", ""],
		"filename": f"Count {location_name} {inv['count_date']}",
		"import_hint": not filled,
	}


def sheet_picking(provider, for_date=None):
	p = api.get_picking(provider, for_date)
	cols = [("Item", "l"), ("UOM", "l")] + [(o, "r") for o in p["outlets"]] + [("Total", "r"), ("In stock", "r"), ("To make", "r")]
	rows = [[r["item_name"], r["uom"]] + [_n(r["per"].get(o)) for o in p["outlets"]] + [_n(r["total"]), _n(r["stock"]), _n(r["to_make"]) if r["to_make"] else ""] for r in p["rows"]]
	return {
		"title": f"Picking sheet: {provider}", "subtitle": format_date(p["for_date"]),
		"meta": [("Delivery", format_date(p["for_date"])), ("Orders", str(len(p["orders"]))), ("No order yet", ", ".join(p["not_ordered"]))],
		"columns": cols, "rows": rows, "landscape": len(p["outlets"]) > 5, "filename": f"Picking {provider} {p['for_date']}",
	}


def sheet_to_buy(for_date=None):
	rows = api.get_to_buy(for_date)
	return {
		"title": "To buy", "subtitle": "What the Store is short of for submitted orders",
		"meta": [("Orders due up to", format_date(for_date) if for_date else "All")],
		"columns": [("Item", "l"), ("Code", "l"), ("Needed", "r"), ("Stock UOM", "l"), ("Store has", "r"), ("On PO", "r"), ("Buy qty", "r"), ("Buy UOM", "l"), ("Last supplier", "l"), ("Last rate", "r"), ("For", "l")],
		"rows": [[r["item_name"], r["item_code"], _n(r["needed"]), r["stock_uom"], _n(r["store_has"]), _n(r["on_po"]), _n(r["buy_qty"]), r["buy_uom"],
			r["suggested_supplier"] or "", _n(r["last_rate"], 2), ", ".join(r["who"])] for r in rows],
		"landscape": True, "filename": f"To buy {nowdate()}",
	}


def sheet_markup(from_date, to_date):
	rows = api.markup_report(from_date, to_date)
	tot = [sum(flt(r[k]) for r in rows) for k in ("orders", "received_value", "markup_amount")]
	return {
		"title": "Provider markup by outlet", "subtitle": f"{format_date(from_date)} to {format_date(to_date)}",
		"meta": [("From", format_date(from_date)), ("To", format_date(to_date)), ("Mode", api.settings().markup_mode)],
		"columns": [("Outlet", "l"), ("Provider", "l"), ("Orders", "r"), ("Received at cost", "r"), ("Markup %", "r"), ("Markup", "r")],
		"rows": [[r.outlet, r.provider, str(r.orders), _n(r.received_value, 2), _n(r.markup_percent, 2), _n(r.markup_amount, 2)] for r in rows],
		"totals": ["Total", "", _n(tot[0], 0), _n(tot[1], 2), "", _n(tot[2], 2)] if rows else None,
		"filename": f"Markup {from_date} {to_date}",
	}


SHEETS = {"order": sheet_order, "count": sheet_count, "picking": sheet_picking, "to_buy": sheet_to_buy, "markup": sheet_markup}


# ---------------------------------------------------------------- renderers

def render_html(sheet):
	esc = frappe.utils.escape_html
	cols = sheet["columns"]
	h = ['<table class="lines"><thead><tr>']
	h += [f'<th class="{"r" if a == "r" else ""}">{esc(c)}</th>' for c, a in cols]
	h.append("</tr></thead><tbody>")
	for row in sheet["rows"]:
		if isinstance(row, dict):
			h.append(f'<tr class="group"><td colspan="{len(cols)}">{esc(row["group"])}</td></tr>')
			continue
		h.append("<tr>")
		for (c, a), v in zip(cols, row):
			v = '<span class="box"></span>' if v is None else esc(str(v))
			h.append(f'<td class="{"r" if a == "r" else ""}">{v}</td>')
		h.append("</tr>")
	if sheet.get("totals"):
		h.append('<tr class="total">' + "".join(f'<td class="{"r" if a == "r" else ""}">{esc(str(v))}</td>' for (c, a), v in zip(cols, sheet["totals"])) + "</tr>")
	h.append("</tbody></table>")
	if not sheet["rows"]:
		h.append('<p class="muted">Nothing to show.</p>')
	if sheet.get("signatures"):
		h.append('<table class="sign"><tr>' + "".join(f"<td>{esc(s)}</td>" for s in sheet["signatures"]) + "</tr></table>")
	company = frappe.defaults.get_global_default("company") or ""
	return frappe.render_template("servepos/templates/stock/base.html", {
		"title": sheet["title"], "subtitle": sheet.get("subtitle"), "company": company,
		"meta": sheet.get("meta"), "body": "".join(h),
		"printed": "Printed {0} by {1}".format(format_datetime(frappe.utils.now_datetime(), "dd MMM yyyy HH:mm"), frappe.utils.get_fullname(frappe.session.user))})


def render_pdf(sheet):
	from frappe.utils.pdf import get_pdf
	html = f'<html><head><meta charset="utf-8"></head><body>{render_html(sheet)}</body></html>'
	return get_pdf(html, {"orientation": "Landscape" if sheet.get("landscape") else "Portrait", "page-size": "A4",
		"margin-top": "12mm", "margin-bottom": "12mm", "margin-left": "10mm", "margin-right": "10mm"})


def render_xlsx(sheet):
	from frappe.utils.xlsxutils import make_xlsx
	data = [[sheet["title"]], [k + ": " + (v or "-") for k, v in (sheet.get("meta") or [])], []]
	data.append([c for c, _a in sheet["columns"]])
	for row in sheet["rows"]:
		if isinstance(row, dict):
			continue  # Excel keeps one flat table so it can be filtered and imported back
		data.append(["" if v is None else _num(v) for v in row])
	if sheet.get("totals"):
		data.append([_num(v) for v in sheet["totals"]])
	return make_xlsx(data, sheet["title"][:31].replace(":", "")).getvalue()


def _num(v):
	if isinstance(v, str):
		s = v.replace(",", "")
		try:
			return float(s) if s and s.lstrip("-").replace(".", "", 1).isdigit() else v
		except ValueError:
			return v
	return v


@frappe.whitelist()
def download(kind, fmt="pdf", **kwargs):
	if kind not in SHEETS:
		frappe.throw(_("Unknown document"))
	kwargs.pop("cmd", None)
	sheet = SHEETS[kind](**kwargs)
	name = "".join(ch if ch.isalnum() or ch in " -_" else "-" for ch in sheet["filename"]).strip()
	if fmt == "xlsx":
		frappe.response["filecontent"] = render_xlsx(sheet)
		frappe.response["filename"] = name + ".xlsx"
	else:
		frappe.response["filecontent"] = render_pdf(sheet)
		frappe.response["filename"] = name + ".pdf"
	frappe.response["type"] = "download" if fmt == "xlsx" else "pdf"


def stock_print_html(doc):
	"""Jinja method used by the ServePOS print formats in Desk."""
	if doc.doctype == "ServePOS Stock Order":
		return render_html(sheet_order(doc.name))
	if doc.doctype == "ServePOS Inventory Count":
		return render_html(sheet_count(doc.location, str(doc.count_date)))
	return ""


# ---------------------------------------------------------------- count import

@frappe.whitelist(methods=["POST"])
def import_counts(location_name, count_date=None):
	"""Read a filled count sheet (the Excel from download kind=count) and return item -> counted.
	Nothing is saved: the screen fills the numbers in for the user to check and submit."""
	assert_can(can_act_for(location_name), _("Not your location"))
	f = frappe.request.files.get("file")
	if not f:
		frappe.throw(_("Choose the filled Excel file"))
	from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file
	rows = read_xlsx_file_from_attached_file(fcontent=f.stream.read())
	header_at = next((i for i, r in enumerate(rows) if r and "Code" in r and "Counted" in r), None)
	if header_at is None:
		frappe.throw(_("This is not a count sheet: download it from the Inventory screen first"))
	head = rows[header_at]
	ci, qi, ui = head.index("Code"), head.index("Counted"), head.index("UOM") if "UOM" in head else None
	out, bad = [], []
	for r in rows[header_at + 1:]:
		if not r or len(r) <= max(ci, qi) or not r[ci]:
			continue
		v = r[qi]
		if v in (None, ""):
			continue
		try:
			out.append({"item_code": str(r[ci]).strip(), "counted": flt(v), "uom": (r[ui] if ui is not None and len(r) > ui else None)})
		except Exception:
			bad.append(str(r[ci]))
	return {"lines": out, "skipped": bad}
