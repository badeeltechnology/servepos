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
	return _q(f"""select sii.item_code, max(sii.item_name) as item_name, max(sii.item_group) as item_group,
			sum(sii.qty) as total_qty, sum(sii.amount) as total_amount, sum(sii.net_amount) as net_amount
		from `tabSales Invoice Item` sii join `tabSales Invoice` si on si.name = sii.parent
		where {w} group by sii.item_code""", a)


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


def sales(profiles, from_date, to_date, seed_profile=None):
	"""Everything the sales screens show for a period, in the shape the screens already use."""
	t = totals(profiles, from_date, to_date)

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
	people = ", sum(si.servepos_guests) as guests, sum(si.servepos_tip) as tips, sum(si.discount_amount) as discount"
	waiters = [r for r in _group(profiles, from_date, to_date, "si.servepos_waiter", "waiter", people) if r.waiter]
	void_staff = {r["staff"]: r for r in v["by_staff"]}
	for r in waiters:
		r["avg_order"] = flt(r.total) / r.count if r.count else 0
		vs = void_staff.get(r.waiter) or {}
		r["voids"], r["void_amount"] = vs.get("count", 0), vs.get("amount", 0)

	t.update({
		"total_items_sold": sum(it["total_qty"] for it in item_data if it["total_qty"] > 0),
		"payment_breakdown": [{"mode_of_payment": r.mode_of_payment, "total": flt(r.total)} for r in payments(profiles, from_date, to_date)],
		"top_items": sorted(item_data, key=lambda x: x["total_amount"], reverse=True),
		"category_breakdown": sorted(cats.values(), key=lambda x: x["amount"], reverse=True),
		"order_type_breakdown": sorted(({"type": r.type or "Other", "count": int(r.count), "total": flt(r.total)}
			for r in _group(profiles, from_date, to_date, "si.servepos_order_type", "type")), key=lambda x: -x["total"]),
		"hourly_sales": [{"hour": int(r.hour or 0), "count": int(r.count), "total": flt(r.total)}
			for r in _group(profiles, from_date, to_date, HOUR, "hour")],
		"daily_sales": [{"date": str(r.date), "count": int(r.count), "total": flt(r.total)}
			for r in _group(profiles, from_date, to_date, "si.posting_date", "date", people)],
		"heatmap": [{"weekday": int(r.wd), "hour": int(r.hour or 0), "count": int(r.count), "total": flt(r.total)}
			for r in _q(*_heat(profiles, from_date, to_date))],
		"waiter_breakdown": sorted(({"waiter": r.waiter, "count": int(r.count), "total": flt(r.total), "avg_order": flt(r.avg_order),
			"guests": int(flt(r.guests)), "tips": flt(r.tips), "discount": flt(r.discount), "voids": r.voids, "void_amount": flt(r.void_amount)}
			for r in waiters), key=lambda x: -x["total"]),
		"cashier_breakdown": sorted(({"cashier": r.cashier, "count": int(r.count), "total": flt(r.total)}
			for r in _group(profiles, from_date, to_date, "si.servepos_cashier", "cashier") if r.cashier), key=lambda x: -x["total"]),
		"void_summary": {**v, "void_rate": round(v["count"] / (t["order_count"] + v["count"]) * 100, 1) if (t["order_count"] + v["count"]) else 0},
	})
	return t


def _heat(profiles, from_date, to_date):
	w, a = _where(profiles, from_date, to_date)
	return (f"""select weekday(si.posting_date) as wd, {HOUR} as hour, sum(si.is_return = 0) as count, sum(si.grand_total) as total
		from `tabSales Invoice` si where {w} group by 1, 2""", a)


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
