"""Day close: ingredients leave stock once per outlet per business day, from recipes.

The POS posts Sales Invoices for revenue only (menu items are service items). At day close the sold
quantity of every menu item is expanded through its recipe (and any prep recipe inside it), and one
Stock Entry ("POS Consumption", Material Issue) takes the ingredients out of the outlet warehouse.

Stock never goes negative: each line takes the lower of what the recipes need and what is in stock.
The rest is kept as a shortfall line. A shortfall is posted automatically when stock arrives at that
warehouse (receipt or transfer), and is settled without posting when a stock count is submitted, because
the count already reflects what was used.
"""
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate

from servepos.recipes.recipe import default_bom

DOCTYPE = "ServePOS Day Close"
MAX_DEPTH = 5


def _settings():
	return frappe.get_cached_doc("ServePOS Stock Settings")


def business_date(dt=None):
	"""The business day a moment belongs to: before the start hour it is still the day before."""
	dt = get_datetime(dt or now_datetime())
	start = cint(_settings().get("day_start_hour") or 0)
	return getdate(add_days(dt.date(), -1)) if dt.hour < start else dt.date()


# ---------------------------------------------------------------- what was sold and what it used

def sold(pos_profile, date):
	"""Quantity sold per item (in stock units) on POS invoices of that outlet and day; returns count as negative."""
	rows = frappe.db.sql("""select sii.item_code, sum(sii.stock_qty) as qty, count(distinct si.name) as invoices
		from `tabSales Invoice Item` sii join `tabSales Invoice` si on si.name = sii.parent
		where si.is_pos = 1 and si.docstatus = 1 and si.pos_profile = %(p)s and si.posting_date = %(d)s
		group by sii.item_code""", {"p": pos_profile, "d": date}, as_dict=True)
	invoices = frappe.db.sql("""select count(*) from `tabSales Invoice` where is_pos = 1 and docstatus = 1 and pos_profile = %(p)s
		and posting_date = %(d)s""", {"p": pos_profile, "d": date})[0][0]
	return {r.item_code: flt(r.qty) for r in rows}, invoices


class _Explode:
	def __init__(self):
		self.boms, self.stock = {}, {}

	def is_stock(self, code):
		if code not in self.stock:
			self.stock[code] = cint(frappe.get_cached_value("Item", code, "is_stock_item"))
		return self.stock[code]

	def bom(self, code):
		if code not in self.boms:
			name = default_bom(code)
			self.boms[code] = frappe.get_doc("BOM", name) if name else None
		return self.boms[code]

	def run(self, code, qty, need, no_recipe, depth=0):
		"""Add the stock ingredients of `qty` units of `code` to `need` (stock units)."""
		if self.is_stock(code):
			if depth:  # an ingredient
				need[code] += qty
			return  # a stock item sold directly is taken out by the invoice itself
		bom = self.bom(code)
		if not bom or depth > MAX_DEPTH:
			if depth == 0 or not bom:
				no_recipe.add(code)
			return
		per = flt(bom.quantity) or 1
		for b in bom.items:
			self.run(b.item_code, qty * flt(b.stock_qty) / per, need, no_recipe, depth + 1)


def needs(pos_profile, date):
	qtys, invoices = sold(pos_profile, date)
	need, no_recipe = defaultdict(float), set()
	ex = _Explode()
	for code, qty in qtys.items():
		ex.run(code, qty, need, no_recipe)
	return {k: v for k, v in need.items() if abs(v) > 1e-9}, sorted(no_recipe), invoices, sum(qtys.values())


def _available(item_codes, warehouse):
	if not item_codes:
		return {}
	return {r.item_code: flt(r.actual_qty) for r in frappe.get_all("Bin", filters={"warehouse": warehouse, "item_code": ["in", list(item_codes)]},
		fields=["item_code", "actual_qty"])}


def _pending_deliveries(pos_profile):
	loc = frappe.db.get_value("ServePOS Stock Location", {"pos_profile": pos_profile}, "name")
	if not loc:
		return []
	return frappe.get_all("ServePOS Stock Order", filters={"to_location": loc, "status": "Shipped"}, pluck="name")


def _accounts(pos_profile, company):
	s = _settings()
	expense = s.get("food_cost_account") or frappe.get_cached_value("Company", company, "stock_adjustment_account")
	cost_center = frappe.db.get_value("POS Profile", pos_profile, "cost_center") or frappe.get_cached_value("Company", company, "cost_center")
	return expense, cost_center


def _issue(company, warehouse, lines, posting, remarks, day_close, pos_profile, entry_type="POS Consumption"):
	"""Submit one Material Issue for {item: qty}; returns the Stock Entry or None."""
	lines = {k: v for k, v in lines.items() if v > 1e-9}
	if not lines:
		return None
	expense, cost_center = _accounts(pos_profile, company)
	se = frappe.new_doc("Stock Entry")
	se.stock_entry_type = entry_type
	se.purpose = "Material Issue"
	se.company = company
	se.from_warehouse = warehouse
	if posting:
		se.set_posting_time = 1
		se.posting_date, se.posting_time = posting
	se.remarks = remarks
	se.servepos_day_close = day_close
	for code, qty in sorted(lines.items()):
		se.append("items", {"item_code": code, "qty": qty, "s_warehouse": warehouse, "expense_account": expense, "cost_center": cost_center,
			"uom": frappe.get_cached_value("Item", code, "stock_uom"), "conversion_factor": 1})
	se.flags.ignore_permissions = True
	se.insert()
	se.submit()
	return se


# ---------------------------------------------------------------- closing a day

def close_day(pos_profile, date, user=None, force=False):
	"""Close one outlet's business day. Running it again returns the existing close."""
	date = getdate(date)
	existing = frappe.db.get_value(DOCTYPE, {"pos_profile": pos_profile, "business_date": date, "status": ["!=", "Cancelled"]}, "name")
	if existing:
		return frappe.get_doc(DOCTYPE, existing)
	if date >= business_date() and not force:
		frappe.throw(_("{0} is still the current business day. Close it after it ends, or confirm closing now.").format(date))
	prof = frappe.db.get_value("POS Profile", pos_profile, ["warehouse", "company"], as_dict=True)
	if not prof or not prof.warehouse:
		frappe.throw(_("POS Profile {0} has no warehouse").format(pos_profile))
	warnings = []
	pending = _pending_deliveries(pos_profile)
	if pending:
		if cint(_settings().get("close_waits_for_deliveries")) and not force:
			frappe.throw(_("Deliveries not yet received: {0}. Receive them first, or confirm closing anyway.").format(", ".join(pending)))
		warnings.append(_("Deliveries not yet received: {0}").format(", ".join(pending)))

	need, no_recipe, invoices, items_sold = needs(pos_profile, date)
	have = _available(need.keys(), prof.warehouse)
	dc = frappe.new_doc(DOCTYPE)
	dc.update({"pos_profile": pos_profile, "business_date": date, "warehouse": prof.warehouse, "company": prof.company,
		"invoices": invoices, "items_sold": items_sold, "closed_by": user or frappe.session.user,
		"no_recipe": ", ".join(no_recipe), "warnings": "\n".join(warnings)})
	post = {}
	for code, qty in sorted(need.items()):
		qty = round(qty, 6)
		if qty < 0:  # more returned than sold: nothing to take out
			continue
		take = max(0.0, min(qty, have.get(code, 0)))
		post[code] = take
		short = round(qty - take, 6)
		dc.append("lines", {"item_code": code, "item_name": frappe.get_cached_value("Item", code, "item_name"),
			"stock_uom": frappe.get_cached_value("Item", code, "stock_uom"), "needed_qty": qty, "posted_qty": take,
			"short_qty": short if short > 1e-9 else 0, "status": "Short" if short > 1e-9 else "Posted"})
	dc.short_lines = sum(1 for l in dc.lines if l.status == "Short")
	dc.status = "Nothing to post" if not dc.lines else ("Closed with shortfall" if dc.short_lines else "Closed")
	dc.flags.ignore_permissions = True
	dc.insert()
	# posted at the moment of closing, never dated back: a back-dated issue could meet stock that was only
	# received later and would make ERPNext revalue every later entry. The business day stays on this record.
	se = _issue(prof.company, prof.warehouse, post, None, _("Day close {0}: {1} on {2}").format(dc.name, pos_profile, date), dc.name, pos_profile)
	if se:
		rates = {d.item_code: flt(d.valuation_rate) for d in se.items}
		for l in dc.lines:
			l.valuation_rate = rates.get(l.item_code, 0)
		dc.consumption_entry = se.name
		dc.consumed_value = flt(se.total_outgoing_value)
		dc.save(ignore_permissions=True)
	return dc


def cancel_day_close(name):
	dc = frappe.get_doc(DOCTYPE, name)
	if dc.status == "Cancelled":
		return dc
	for se in {dc.consumption_entry} | {l.resolved_by for l in dc.lines if l.status == "Posted later" and (l.resolved_by or "").startswith("MAT-STE")}:
		if se and frappe.db.get_value("Stock Entry", se, "docstatus") == 1:
			frappe.get_doc("Stock Entry", se).cancel()
	dc.status = "Cancelled"
	dc.save(ignore_permissions=True)
	return dc


# ---------------------------------------------------------------- shortfalls

def _open_short(warehouse, items=None, until=None):
	cond = {"status": "Short"}
	rows = frappe.db.sql("""select l.name, l.parent, l.item_code, l.short_qty, l.posted_qty, d.business_date, d.pos_profile, d.company
		from `tabServePOS Day Close Line` l join `tabServePOS Day Close` d on d.name = l.parent
		where l.status = 'Short' and d.status != 'Cancelled' and d.warehouse = %(w)s
		{items} {until} order by d.business_date asc, l.idx asc""".format(
			items="and l.item_code in %(i)s" if items else "", until="and d.business_date <= %(u)s" if until else ""),
		{"w": warehouse, "i": tuple(items or []) or ("",), "u": until}, as_dict=True)
	return rows


def retry_shortfalls(warehouse, items=None):
	"""Post open shortfalls of a warehouse as far as stock now allows (oldest day first)."""
	rows = _open_short(warehouse, items)
	if not rows:
		return []
	have = _available({r.item_code for r in rows}, warehouse)
	post, done = defaultdict(float), []
	for r in rows:
		take = max(0.0, min(r.short_qty, have.get(r.item_code, 0) - post[r.item_code]))
		if take > 1e-9:
			post[r.item_code] += take
			done.append((r, take))
	if not done:
		return []
	r0 = done[0][0]
	se = _issue(r0.company, warehouse, dict(post), None, _("Shortfalls from day close posted after stock arrived"), None, r0.pos_profile)
	for r, take in done:
		left = round(r.short_qty - take, 6)
		frappe.db.set_value("ServePOS Day Close Line", r.name, {"posted_qty": r.posted_qty + take, "short_qty": left if left > 1e-9 else 0,
			"status": "Short" if left > 1e-9 else "Posted later", "resolved_by": se.name, "resolved_on": now_datetime()})
	_refresh({r.parent for r, _t in done})
	return [se.name]


def settle_by_count(warehouse, items, count_date, reference):
	"""A stock count already reflects what was used: open shortfalls up to that day are closed without posting."""
	rows = _open_short(warehouse, items, count_date)
	for r in rows:
		frappe.db.set_value("ServePOS Day Close Line", r.name, {"status": "Settled by count", "resolved_by": reference, "resolved_on": now_datetime()})
	_refresh({r.parent for r in rows})
	return len(rows)


def _refresh(parents):
	for p in parents:
		n = frappe.db.count("ServePOS Day Close Line", {"parent": p, "status": "Short"})
		status = frappe.db.get_value(DOCTYPE, p, "status")
		if status in ("Closed", "Closed with shortfall"):
			frappe.db.set_value(DOCTYPE, p, {"short_lines": n, "status": "Closed with shortfall" if n else "Closed"})


# ---------------------------------------------------------------- hooks and scheduler

def on_stock_in(doc, method=None):
	"""Stock arrived somewhere: post shortfalls waiting for it (after the transaction commits)."""
	targets = defaultdict(set)
	for d in doc.get("items") or []:
		wh = d.get("t_warehouse") or (d.get("warehouse") if doc.doctype == "Purchase Receipt" else None)
		if wh and flt(d.get("qty")) > 0:
			targets[wh].add(d.item_code)
	if doc.doctype == "Stock Entry" and doc.get("servepos_day_close"):
		return
	for wh, items in targets.items():
		if frappe.db.exists("ServePOS Day Close Line", {"status": "Short", "item_code": ["in", list(items)]}):
			frappe.enqueue("servepos.recipes.day_close.retry_shortfalls", warehouse=wh, items=list(items), enqueue_after_commit=True)


def on_stock_count(doc, method=None):
	by_wh = defaultdict(set)
	for d in doc.get("items") or []:
		by_wh[d.warehouse].add(d.item_code)
	for wh, items in by_wh.items():
		settle_by_count(wh, list(items), doc.posting_date, doc.name)


def auto_close():
	"""Hourly: close yesterday (and the two days before, if missed) for every outlet with sales."""
	s = _settings()
	if not cint(s.get("auto_day_close")):
		return
	today = business_date()
	for p in frappe.get_all("POS Profile", filters={"disabled": 0}, fields=["name", "warehouse"]):
		if not p.warehouse:
			continue
		for back in (1, 2, 3):
			d = add_days(today, -back)
			if frappe.db.exists(DOCTYPE, {"pos_profile": p.name, "business_date": d, "status": ["!=", "Cancelled"]}):
				continue
			if not frappe.db.exists("Sales Invoice", {"is_pos": 1, "docstatus": 1, "pos_profile": p.name, "posting_date": d}):
				continue
			try:
				close_day(p.name, d, user="Administrator")
				frappe.db.commit()
			except Exception:
				frappe.db.rollback()
				frappe.log_error(title=f"ServePOS day close {p.name} {d}")
