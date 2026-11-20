"""Sales analytics for the manager app.

Every figure is a GROUP BY in the database over submitted POS sales (Sales Invoice with is_pos),
so a year of sales costs a handful of indexed queries instead of loading each invoice into Python.
The desktop POS keeps its own endpoints in pos_session; nothing here is used by it.
"""

import frappe
from frappe.utils import add_days, add_months, date_diff, flt, getdate

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# Some POS terminals send sales without the time of sale (00:00:00). For those the time the sale
# reached ERPNext stands in: sales sync every few minutes, so the hour is right for busy-hour views.
HOUR = "hour(if(si.posting_time is null or si.posting_time = 0, si.creation, si.posting_time))"


def _where(profiles, from_date, to_date, alias="si"):
	cond = [f"{alias}.is_pos = 1", f"{alias}.docstatus = 1", f"{alias}.posting_date between %(f)s and %(t)s"]
	args = {"f": str(from_date), "t": str(to_date)}
	if profiles is not None:
		cond.append(f"{alias}.pos_profile in %(ps)s")
		args["ps"] = tuple(profiles) or ("-",)
	return " and ".join(cond), args


def _q(sql, args):
	return frappe.db.sql(sql, args, as_dict=True)


def totals(profiles, from_date, to_date):
	"""Headline numbers for a period: used for the period itself and for comparisons."""
	w, a = _where(profiles, from_date, to_date)
	r = _q(f"""select coalesce(sum(si.grand_total), 0) as total_sales, coalesce(sum(si.net_total), 0) as net_total,
			coalesce(sum(si.total_taxes_and_charges), 0) as total_tax, coalesce(sum(si.is_return = 0), 0) as order_count,
			coalesce(sum(si.servepos_guests), 0) as total_guests, coalesce(sum(si.servepos_tip), 0) as total_tips,
			coalesce(sum(si.discount_amount), 0) as total_discount, count(*) as invoices
		from `tabSales Invoice` si where {w}""", a)[0]
	out = {k: flt(v) for k, v in r.items()}
	out["order_count"] = int(out["order_count"])
	out["avg_order"] = out["total_sales"] / out["order_count"] if out["order_count"] else 0
	out["avg_guest"] = out["total_sales"] / out["total_guests"] if out["total_guests"] else 0
	return out


def _group(profiles, from_date, to_date, key, label, extra=""):
	w, a = _where(profiles, from_date, to_date)
	return _q(f"""select {key} as `{label}`, sum(si.is_return = 0) as count, sum(si.grand_total) as total {extra}
		from `tabSales Invoice` si where {w} group by 1 order by 1""", a)


def items(profiles, from_date, to_date):
	w, a = _where(profiles, from_date, to_date)
	rows = _q(f"""select sii.item_code, sum(sii.qty) as total_qty, sum(sii.amount) as total_amount, sum(sii.net_amount) as net_amount
		from `tabSales Invoice Item` sii join `tabSales Invoice` si on si.name = sii.parent
		where {w} group by sii.item_code""", a)
	# names and categories from Item: reading them off every invoice line would defeat the covering index
	info = {r.name: r for r in frappe.get_all("Item", filters={"name": ["in", [r.item_code for r in rows] or ["-"]]},
		fields=["name", "item_name", "item_group"], limit_page_length=0)} if rows else {}
	for r in rows:
		i = info.get(r.item_code) or {}
		r.item_name, r.item_group = i.get("item_name") or r.item_code, i.get("item_group")
	return rows


def payments(profiles, from_date, to_date):
	w, a = _where(profiles, from_date, to_date)
	return _q(f"""select sip.mode_of_payment, sum(sip.amount) as total
		from `tabSales Invoice Payment` sip join `tabSales Invoice` si on si.name = sip.parent
		where {w} and sip.amount != 0 group by sip.mode_of_payment order by total desc""", a)


def voids(profiles, from_date, to_date):
	cond = ["v.void_date between %(f)s and %(t)s"]
	args = {"f": f"{from_date} 00:00:00", "t": f"{to_date} 23:59:59"}
	if profiles is not None:
		cond.append("v.pos_profile in %(ps)s")
		args["ps"] = tuple(profiles) or ("-",)
	w = " and ".join(cond)

	def by(col, label, default, order="amount"):
		return [{label: r.k or default, "count": int(r.count), "amount": flt(r.amount)} for r in _q(
			f"""select v.{col} as k, count(*) as count, coalesce(sum(v.grand_total), 0) as amount
			from `tabServePOS Void Log` v where {w} group by v.{col} order by {order} desc""", args)]

	head = _q(f"select count(*) as count, coalesce(sum(v.grand_total), 0) as amount from `tabServePOS Void Log` v where {w}", args)[0]
	top = _q(f"""select vi.item_code, max(vi.item_name) as item_name, sum(vi.qty) as total_qty, sum(vi.amount) as total_amount
		from `tabServePOS Void Log Item` vi join `tabServePOS Void Log` v on v.name = vi.parent
		where {w} group by vi.item_code order by total_amount desc limit 20""", args)
	return {
		"count": int(head.count), "amount": flt(head.amount),
		"by_type": by("void_type", "type", "Other"),
		"by_reason": by("void_reason", "reason", "No reason", "count"),
		"by_disposition": by("void_disposition", "disposition", "Not specified"),
		"by_staff": by("voided_by", "staff", "Unknown"),
		"top_items": top,
	}


def _pass(profiles, from_date, to_date):
	"""One read of the period's invoices (only the columns the reports need), aggregated here:
	a single scan is far cheaper than a GROUP BY per breakdown on a year of sales."""
	w, a = _where(profiles, from_date, to_date)
	rows = frappe.db.sql(f"""select si.posting_date, {HOUR}, si.pos_profile, si.servepos_order_type, si.servepos_waiter,
			si.servepos_cashier, si.is_return, si.grand_total, si.net_total, si.total_taxes_and_charges,
			si.servepos_guests, si.servepos_tip, si.discount_amount
		from `tabSales Invoice` si where {w}""", a)
	tot = {"total_sales": 0.0, "net_total": 0.0, "total_tax": 0.0, "order_count": 0, "total_guests": 0.0, "total_tips": 0.0, "total_discount": 0.0, "invoices": 0}
	day, hour, heat, outlet, otype, waiter, cashier = {}, {}, {}, {}, {}, {}, {}

	def add(m, k, n, gt, extra=None):
		r = m.get(k)
		if r is None:
			r = m[k] = {"count": 0, "total": 0.0, "guests": 0.0, "tips": 0.0, "discount": 0.0}
		r["count"] += n
		r["total"] += gt
		if extra:
			r["guests"] += extra[0]
			r["tips"] += extra[1]
			r["discount"] += extra[2]

	for d, h, p, ot, wt, ca, ret, gt, nt, tx, g, tip, disc in rows:
		gt, n = flt(gt), 0 if ret else 1
		g, tip, disc = flt(g), flt(tip), flt(disc)
		tot["total_sales"] += gt
		tot["net_total"] += flt(nt)
		tot["total_tax"] += flt(tx)
		tot["order_count"] += n
		tot["total_guests"] += g
		tot["total_tips"] += tip
		tot["total_discount"] += disc
		tot["invoices"] += 1
		ex = (g, tip, disc)
		add(day, d, n, gt)
		add(hour, h or 0, n, gt)
		add(heat, (d.weekday(), h or 0), n, gt)
		add(outlet, p, n, gt, ex)
		add(otype, ot or "Other", n, gt)
		if wt:
			add(waiter, wt, n, gt, ex)
		if ca:
			add(cashier, ca, n, gt)
	tot["avg_order"] = tot["total_sales"] / tot["order_count"] if tot["order_count"] else 0
	tot["avg_guest"] = tot["total_sales"] / tot["total_guests"] if tot["total_guests"] else 0
	return tot, {"day": day, "hour": hour, "heat": heat, "outlet": outlet, "type": otype, "waiter": waiter, "cashier": cashier}


def sales(profiles, from_date, to_date, seed_profile=None):
	"""Everything the sales screens show for a period, in the shape the screens already use."""
	t, g = _pass(profiles, from_date, to_date)

	item_map = {}
	if seed_profile:
		# a single outlet: list its menu with zero sales too, so items that did not sell show up
		try:
			from servepos.api.registry import get_items
			for it in get_items(seed_profile) or []:
				code = it.get("item_code") or it.get("name")
				if code:
					item_map[code] = {"item_code": code, "item_name": it.get("item_name") or code, "item_group": it.get("item_group"),
						"total_qty": 0.0, "total_amount": 0.0}
		except Exception:
			pass
	for r in items(profiles, from_date, to_date):
		row = item_map.setdefault(r.item_code, {"item_code": r.item_code, "item_name": r.item_name, "item_group": r.item_group,
			"total_qty": 0.0, "total_amount": 0.0})
		row["total_qty"] += flt(r.total_qty)
		row["total_amount"] += flt(r.total_amount)
	item_data = list(item_map.values())

	cats = {}
	for it in item_data:
		if not it["total_qty"] and not it["total_amount"]:
			continue
		c = cats.setdefault(it.get("item_group") or "Uncategorized", {"category": it.get("item_group") or "Uncategorized", "qty": 0, "amount": 0, "items": 0})
		c["qty"] += it["total_qty"]
		c["amount"] += it["total_amount"]
		c["items"] += 1

	v = voids(profiles, from_date, to_date)
	void_staff = {r["staff"]: r for r in v["by_staff"]}
	waiters = []
	for name, r in g["waiter"].items():
		vs = void_staff.get(name) or {}
		waiters.append({"waiter": name, "count": r["count"], "total": r["total"], "avg_order": r["total"] / r["count"] if r["count"] else 0,
			"guests": int(r["guests"]), "tips": r["tips"], "discount": r["discount"], "voids": vs.get("count", 0), "void_amount": vs.get("amount", 0)})

	t.update({
		"total_items_sold": sum(it["total_qty"] for it in item_data if it["total_qty"] > 0),
		"payment_breakdown": [{"mode_of_payment": r.mode_of_payment, "total": flt(r.total)} for r in payments(profiles, from_date, to_date)],
		"top_items": sorted(item_data, key=lambda x: x["total_amount"], reverse=True),
		"category_breakdown": sorted(cats.values(), key=lambda x: x["amount"], reverse=True),
		"order_type_breakdown": sorted(({"type": k, "count": r["count"], "total": r["total"]} for k, r in g["type"].items()), key=lambda x: -x["total"]),
		"hourly_sales": [{"hour": int(k), "count": r["count"], "total": r["total"]} for k, r in sorted(g["hour"].items())],
		"daily_sales": [{"date": str(k), "count": r["count"], "total": r["total"]} for k, r in sorted(g["day"].items())],
		"heatmap": [{"weekday": k[0], "hour": int(k[1]), "count": r["count"], "total": r["total"]} for k, r in g["heat"].items()],
		"waiter_breakdown": sorted(waiters, key=lambda x: -x["total"]),
		"cashier_breakdown": sorted(({"cashier": k, "count": r["count"], "total": r["total"]} for k, r in g["cashier"].items()), key=lambda x: -x["total"]),
		"by_outlet": {k: {"total_sales": r["total"], "order_count": r["count"], "guests": r["guests"], "tips": r["tips"], "discount": r["discount"]}
			for k, r in g["outlet"].items()},
		"void_summary": {**v, "void_rate": round(v["count"] / (t["order_count"] + v["count"]) * 100, 1) if (t["order_count"] + v["count"]) else 0},
	})
	return t


def by_outlet(profiles, from_date, to_date):
	"""Per outlet: sales, orders, guests, tips and discounts."""
	w, a = _where(profiles, from_date, to_date)
	return {r.pos_profile: r for r in _q(f"""select si.pos_profile, sum(si.grand_total) as total_sales, sum(si.is_return = 0) as order_count,
			sum(si.servepos_guests) as guests, sum(si.servepos_tip) as tips, sum(si.discount_amount) as discount
		from `tabSales Invoice` si where {w} group by si.pos_profile""", a)}


def periods(from_date, to_date):
	"""The period before (same length) and the same dates a year earlier."""
	days = date_diff(to_date, from_date) + 1
	return {
		"previous": (str(add_days(from_date, -days)), str(add_days(from_date, -1))),
		"last_year": (str(add_months(getdate(from_date), -12)), str(add_months(getdate(to_date), -12))),
	}
