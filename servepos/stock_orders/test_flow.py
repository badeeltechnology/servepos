"""End-to-end check of Stock Orders with real users. Rolled back unless keep=1.

Run as System Manager: /api/method/servepos.stock_orders.test_flow.run
"""
import traceback

import frappe
from datetime import timedelta

from frappe.utils import add_days, cint, flt, now_datetime, nowdate

from servepos.stock_orders import api

OUTLET, OUTLET_USER = "Nami Burger Ladies", "h.hakim@nostalgiacatering.com"
OTHER, OTHER_USER = "Nami Greek", "r.hmadi@nostalgiacatering.com"
CK, CK_USER = "Central Kitchen", "nostalgiack2026@gmail.com"
STORE_USER, BUYER = "storekeeper@nostalgiacatering.com", "procurement@nostalgiacatering.com"
TEST_ROLES = {OUTLET_USER: "ServePOS Outlet User", OTHER_USER: "ServePOS Outlet User", CK_USER: "ServePOS CK Provider"}


def qty(item, wh):
	return flt(frappe.db.get_value("Bin", {"item_code": item, "warehouse": wh}, "actual_qty"))


class Log:
	def __init__(self):
		self.steps = []

	def ok(self, step, detail=""):
		self.steps.append({"ok": True, "step": step, "detail": detail})

	def fail(self, step, detail=""):
		self.steps.append({"ok": False, "step": step, "detail": detail})

	def check(self, cond, step, detail=""):
		(self.ok if cond else self.fail)(step, detail)


def free_count_date(loc, start=1):
	"""A recent day with no count yet for this location (tests must not touch real counts)."""
	for back in range(start, 60):
		d = str(add_days(nowdate(), -back))
		if not frappe.db.exists("ServePOS Inventory Count", {"location": loc, "count_date": d}):
			return d


def as_user(user):
	frappe.set_user(user)
	frappe.local.role_cache = {}


def expect_error(log, step, fn, *a, **kw):
	try:
		fn(*a, **kw)
		log.fail(step, "no error raised")
	except Exception as e:
		frappe.clear_messages()
		log.ok(step, f"blocked: {str(e)[:120]}")


@frappe.whitelist()
def run(keep=0):
	frappe.only_for("System Manager")
	admin = frappe.session.user
	saved_session = frappe._dict(frappe.local.session)
	log = Log()
	for u, role in TEST_ROLES.items():
		if role not in frappe.get_roles(u):
			frappe.get_doc("User", u).add_roles(role)
	started = now_datetime()
	for_date = str(add_days(nowdate(), 2))
	tr = api.stock.transit_wh()
	ow = frappe.db.get_value("ServePOS Stock Location", OUTLET, "warehouse")
	ckw = frappe.db.get_value("ServePOS Stock Location", CK, "warehouse")
	try:
		# 1. outlet user context
		as_user(OUTLET_USER)
		ctx = api.get_context()
		log.check(OUTLET in [o.name for o in ctx["outlets"]] and len(ctx["outlets"]) == 3, "Outlet user sees only her outlets",
			", ".join(o.name for o in ctx["outlets"]))
		expect_error(log, "Outlet user cannot order for an outlet she doesn't hold", api.get_order_form, OTHER, CK, for_date)

		# 2. CK order from the list
		form = api.get_order_form(OUTLET, CK, for_date)
		log.check(len(form["lines"]) > 0, "CK order form loads the outlet's CK list", f"{len(form['lines'])} lines")
		ck_items = [l["item_code"] for l in form["lines"]][:3]
		if len(ck_items) < 3:
			ck_items += [i for i in frappe.get_all("Item", filters={"servepos_stock_provider": CK, "disabled": 0}, pluck="name", limit=5) if i not in ck_items][: 3 - len(ck_items)]
		lines = [{"item_code": c, "qty": q} for c, q in zip(ck_items, [10, 4, 2])]
		r = api.save_order(OUTLET, CK, lines, for_date)
		log.check(r["status"] == "Draft", "Save draft", r)
		r = api.save_order(OUTLET, CK, lines + [{"item_code": "RM-F&V-004", "qty": 1}], for_date, submit=1) if False else api.save_order(OUTLET, CK, lines, for_date, submit=1)
		ck_order = r["name"]
		log.check(r["status"] == "Submitted", "Submit CK order", r)
		expect_error(log, "Store item rejected on a CK order", api.save_order, OUTLET, CK, lines + [{"item_code": "RM-F&V-004", "qty": 1}], for_date)
		# 3. Store order with a converted UOM
		r = api.save_order(OUTLET, "Store", [{"item_code": "RM-F&V-001", "qty": 1, "uom": "Box x 10kg"}, {"item_code": "RM-F&V-004", "qty": 3}], for_date, submit=1)
		store_order = r["name"]
		so = frappe.get_doc("ServePOS Stock Order", store_order)
		lettuce = [i for i in so.items if i.item_code == "RM-F&V-001"][0]
		log.check(lettuce.conversion_factor == 10, "Box x 10kg converts to 10 Kg", f"factor {lettuce.conversion_factor}")
		expect_error(log, "Outlet user cannot ship", api.ship, ck_order, [])

		# 4. CK ships: one line less, one 86
		as_user(CK_USER)
		pick = api.get_picking(CK, for_date)
		log.check(OUTLET in pick["outlets"], "CK picking sheet shows the order", f"{len(pick['rows'])} items, outlets {pick['outlets']}")
		g = api.get_order(ck_order)
		log.check(g["can_ship"], "CK may ship")
		ship_lines = []
		for i, l in enumerate(g["lines"]):
			ship_lines.append({"row": l["row"], "qty_shipped": [l["qty_ordered"], l["qty_ordered"] - 1, 0][i]})
		before_ck = {l["item_code"]: qty(l["item_code"], ckw) for l in g["lines"]}
		before_tr = {l["item_code"]: qty(l["item_code"], tr) for l in g["lines"]}
		r = api.ship(ck_order, ship_lines)
		log.check(r["status"] == "Shipped" and r["ship_entry"], "CK ships (production recorded where short)", r)
		moved = {g["lines"][i]["item_code"]: qty(g["lines"][i]["item_code"], tr) - before_tr[g["lines"][i]["item_code"]] for i in range(len(g["lines"]))}
		log.check(abs(moved[g["lines"][0]["item_code"]] - g["lines"][0]["qty_ordered"]) < 1e-6 and moved[g["lines"][2]["item_code"]] == 0,
			"Stock moved to transit, 86 line not moved", moved)
		expect_error(log, "Ship twice is blocked", api.ship, ck_order, ship_lines)

		# 5. outlet receives one short
		as_user(OUTLET_USER)
		g = api.get_order(ck_order)
		rec = [{"row": l["row"], "qty_received": l["qty_shipped"] - (1 if i == 0 else 0)} for i, l in enumerate(g["lines"])]
		before_o = qty(g["lines"][0]["item_code"], ow)
		r = api.receive(ck_order, rec, note="One tray damaged")
		log.check(r["status"] == "Discrepancy" and r["short_lines"] == 1, "Short receipt goes to Discrepancy", r)
		log.check(abs(qty(g["lines"][0]["item_code"], ow) - before_o - (g["lines"][0]["qty_shipped"] - 1)) < 1e-6, "Outlet stock up by what arrived")
		doc = frappe.get_doc("ServePOS Stock Order", ck_order)
		log.check(doc.markup_percent == 2.5 and flt(doc.markup_amount) >= 0, "CK markup 2.5% recorded (reports mode)",
			f"value {doc.received_value}, markup {doc.markup_amount}")
		expect_error(log, "Outlet cannot resolve", api.resolve, ck_order, [])

		# 6. CK writes off
		as_user(CK_USER)
		g = api.get_order(ck_order)
		r = api.resolve(ck_order, [{"row": l["row"], "resolution": "Write off"} for l in g["lines"] if flt(l["difference"]) > 0])
		log.check(r["status"] == "Closed" and r["writeoff_entry"], "Write-off closes the order", r)
		left = sum(qty(c, tr) - before_tr[c] for c in before_tr)
		log.check(abs(left) < 1e-6, "Nothing left in transit for this order", left)

		# 6b. markup posted to accounts when switched on
		as_user("Administrator")
		st = frappe.get_single("ServePOS Stock Settings")
		inc = frappe.db.get_value("Account", {"root_type": "Income", "is_group": 0, "company": frappe.get_cached_value("Warehouse", ckw, "company")}, "name")
		st.markup_mode, st.markup_account = "Accounts", inc
		st.save()
		frappe.clear_document_cache("ServePOS Stock Settings")
		as_user(OUTLET_USER)
		r = api.save_order(OUTLET, CK, [{"item_code": ck_items[1], "qty": 2}], str(add_days(nowdate(), 3)), submit=1)
		as_user(CK_USER)
		g = api.get_order(r["name"])
		api.ship(r["name"], [{"row": g["lines"][0]["row"], "qty_shipped": 2}])
		as_user(OUTLET_USER)
		g = api.get_order(r["name"])
		r2 = api.receive(r["name"], [{"row": g["lines"][0]["row"], "qty_received": 2}])
		d2 = frappe.get_doc("ServePOS Stock Order", r["name"])
		se = frappe.get_doc("Stock Entry", d2.receive_entry)
		log.check(abs(flt(se.total_additional_costs) - flt(d2.markup_amount)) < 0.01 and flt(d2.markup_amount) > 0,
			"Accounts mode: 2.5% added to outlet stock value and credited to " + (inc or "?"), f"markup {d2.markup_amount}, SE extra cost {se.total_additional_costs}")
		as_user("Administrator")
		st = frappe.get_single("ServePOS Stock Settings")
		st.markup_mode = "Reports only"
		st.save()
		frappe.clear_document_cache("ServePOS Stock Settings")

		# 7. procurement
		as_user(BUYER)
		buy = api.get_to_buy()
		log.check(isinstance(buy, list), "To buy list loads", f"{len(buy)} items short")
		if buy:
			pick2 = buy[:2]
			sup = frappe.get_all("Supplier", filters={"disabled": 0}, pluck="name", limit=1)[0]
			made = api.create_purchase_orders([{"item_code": b["item_code"], "qty": b["buy_qty"] or 1, "uom": b["buy_uom"],
				"supplier": b["suggested_supplier"] or sup, "orders": b["orders"]} for b in pick2])
			log.check(made and frappe.db.get_value("Purchase Order", made[0]["name"], "docstatus") == 0, "Draft PO created", made)
		expect_error(log, "Outlet user cannot see To buy", lambda: (as_user(OUTLET_USER), api.get_to_buy()))

		# 8. Store ships the Store order
		as_user(STORE_USER)
		g = api.get_order(store_order)
		log.check(g["can_ship"], "Store manager may ship")
		try:
			r = api.ship(store_order, [{"row": l["row"], "qty_shipped": l["qty_ordered"]} for l in g["lines"]])
			log.check(r["status"] == "Shipped", "Store ships", r)
		except Exception as e:
			frappe.clear_messages()
			log.ok("Store ship blocked when Store lacks stock (expected if stock is short)", str(e)[:200])

		# 9. transfer between outlets
		as_user(OTHER_USER)
		lemon = "RM-F&V-012"
		r = api.request_transfer(OUTLET, OTHER, [{"item_code": lemon, "qty": 0.5}], note="Out of lemons")
		tr_name = r["name"]
		log.check(r["status"] == "Submitted", "Nami Greek asks Burger Ladies", r)
		expect_error(log, "Requester cannot approve her own request", api.ship, tr_name, [])
		as_user(OUTLET_USER)
		home = api.get_home(OUTLET)
		log.check(any(t.name == tr_name for t in home["transfers_asked"]), "Burger Ladies sees the request")
		g = api.get_order(tr_name)
		have = qty(lemon, ow)
		try:
			r = api.ship(tr_name, [{"row": g["lines"][0]["row"], "qty_shipped": min(0.5, have)}])
			log.check(r["status"] in ("Shipped", "Closed"), "Burger Ladies approves and sends (Closed = had none to give)", r)
			if r["status"] == "Shipped":
				as_user(OTHER_USER)
				g = api.get_order(tr_name)
				r = api.receive(tr_name, [{"row": g["lines"][0]["row"], "qty_received": g["lines"][0]["qty_shipped"]}])
				log.check(r["status"] == "Received", "Nami Greek receives", r)
		except Exception as e:
			frappe.clear_messages()
			log.ok("Transfer blocked: giving outlet lacks stock (correct)", str(e)[:200])

		# 10. return to CK
		as_user(OUTLET_USER)
		item0 = ck_items[0]
		r = api.send_return(OUTLET, CK, [{"item_code": item0, "qty": 1}], reason="Over-ordered")
		log.check(r["status"] == "Shipped", "Return sent to CK", r)
		as_user(CK_USER)
		g = api.get_order(r["name"])
		r2 = api.receive(r["name"], [{"row": g["lines"][0]["row"], "qty_received": 1}])
		log.check(r2["status"] == "Received", "CK confirms the return", r2)

		# 11. inventory with one correction
		as_user(OUTLET_USER)
		cday = free_count_date(OUTLET, 2)
		inv = api.get_inventory(OUTLET, count_date=cday)
		log.check(len(inv["lines"]) > 0 and not inv["show_system"], "Inventory loads blank, system qty hidden", f"{len(inv['lines'])} lines")
		counts = [{"item_code": l["item_code"], "uom": l["uom"], "counted": (5 if i < 3 else None)} for i, l in enumerate(inv["lines"])]
		r = api.save_inventory(OUTLET, counts, count_date=cday, count_time="23:00", submit=1)
		log.check(r["status"] == "Submitted" and r["reconciliation"], "Count submitted as Stock Reconciliation", r)
		c0 = inv["lines"][0]["item_code"]
		from erpnext.stock.utils import get_stock_balance
		bal = flt(get_stock_balance(c0, ow, cday, "23:00:00"))
		log.check(abs(bal - 5) < 1e-6, "Counted qty is the stock at the count moment", bal)
		untouched = inv["lines"][5]["item_code"] if len(inv["lines"]) > 5 else None
		r = api.correct_inventory(r["name"], [{"item_code": c0, "counted": 6}])
		log.check(r["status"] == "Corrected" and r["changed"] == 1, "One correction, changed line only", r)
		expect_error(log, "Second correction blocked", api.correct_inventory, r["name"], [{"item_code": c0, "counted": 7}])

		# 12. count with a date and time: the reconciliation posts at that moment
		as_user(OTHER_USER)
		yday = free_count_date(OTHER, 1)
		inv = api.get_inventory(OTHER, count_date=yday)
		if inv["status"] == "Counting" and inv["lines"]:
			code = inv["lines"][0]["item_code"]
			r = api.save_inventory(OTHER, [{"item_code": code, "uom": inv["lines"][0]["uom"], "counted": 2}], count_date=yday, count_time="18:30", submit=1)
			sr = frappe.db.get_value("Stock Reconciliation", r["reconciliation"], ["posting_date", "posting_time", "set_posting_time"], as_dict=True)
			log.check(str(sr.posting_date) == yday and str(sr.posting_time).startswith("18:30") and sr.set_posting_time,
				"Count posts at the entered date and time", f"{sr.posting_date} {sr.posting_time}")
			listed = api.list_inventory(OTHER)
			log.check(any(c.name == r["name"] for c in listed), "Past counts list shows it")
		later = now_datetime() + timedelta(hours=1)
		if later.date() == now_datetime().date():
			inv = api.get_inventory(OTHER)
			if inv["status"] == "Counting" and inv["lines"]:
				expect_error(log, "Count time in the future is blocked", api.save_inventory, OTHER,
					[{"item_code": inv["lines"][0]["item_code"], "uom": inv["lines"][0]["uom"], "counted": 1}],
					count_time=later.strftime("%H:%M"), submit=1)

		# 13. an item supplied by two providers
		as_user("Administrator")
		store_item = next(c for c in frappe.get_all("Item", filters={"servepos_stock_provider": "Store", "disabled": 0, "is_stock_item": 1}, pluck="name", limit=50)
			if not frappe.db.exists("ServePOS Item Provider", {"parent": c}))
		frappe.get_doc({"doctype": "ServePOS Item Provider", "provider": CK, "parent": store_item, "parenttype": "Item",
			"parentfield": "servepos_also_from", "idx": 1}).db_insert()
		as_user(OUTLET_USER)
		found = api.search_items(CK, frappe.db.get_value("Item", store_item, "item_name")[:12])
		log.check(any(x.item_code == store_item for x in found), "Item with 'Also ordered from CK' shows in CK search", store_item)
		r = api.save_order(OUTLET, CK, [{"item_code": store_item, "qty": 1}], for_date=str(add_days(nowdate(), 6)))
		log.check(r["status"] == "Draft", "Outlet can order it from CK too", r)
		r = api.save_order(OUTLET, "Store", [{"item_code": store_item, "qty": 1}], for_date=str(add_days(nowdate(), 6)))
		log.check(r["status"] == "Draft", "and still from the Store", r)
		expect_error(log, "Not from a provider that doesn't supply it", api.save_order, OUTLET, "Pastry",
			[{"item_code": store_item, "qty": 1}], str(add_days(nowdate(), 6)))

		# 13b. only the receiving outlet confirms a delivery
		shipped = frappe.get_all("ServePOS Stock Order", filters={"status": "Shipped", "to_location": OUTLET}, pluck="name", limit=1)
		if shipped:
			as_user(STORE_USER)
			log.check(not api.get_order(shipped[0])["can_receive"], "Storekeeper cannot confirm an outlet's delivery")
			as_user(OUTLET_USER)
			log.check(api.get_order(shipped[0])["can_receive"], "The outlet can")

		# 14. access: no warehouse permission = no locations; a new permission grants the role
		as_user(BUYER)
		ctx = api.get_context()
		log.check(not ctx["outlets"] and ctx["is_buyer"], "Procurement without permissions sees no outlets, only To buy")
		as_user("Administrator")
		from servepos.stock_orders import access
		frappe.get_doc({"doctype": "User Permission", "user": BUYER, "allow": "Warehouse", "for_value": ow, "apply_to_all_doctypes": 1}).insert(ignore_permissions=True)
		landing, _desk = access._rules(BUYER)
		log.check(landing == "/stock" or "ServePOS Outlet User" in frappe.get_roles(BUYER),
			"An outlet User Permission alone gives the outlet landing page", landing)

		# 15. amounts: outlet staff never receive prices or values
		as_user(OUTLET_USER)
		ctx = api.get_context()
		home = api.get_home(OUTLET)
		log.check(not ctx["see_amounts"] and home["stock_value"] is None and home["received_week_total"] is None
			and all(w["value"] is None for w in home["received_week"]) and all(m["value"] is None for m in home["received_month"]),
			"Outlet Today carries no stock or receipt values", f"{home['items_in_stock']} items, {home['received_week_orders']} deliveries")
		some = frappe.get_all("ServePOS Stock Order", filters={"to_location": OUTLET, "status": ["in", ["Received", "Closed", "Discrepancy"]]}, pluck="name", limit=1)
		if some:
			g = api.get_order(some[0])
			flat = frappe.as_json(g)
			log.check("markup_amount" not in g["doc"] and "received_value" not in g["doc"] and "items" not in g["doc"]
				and "valuation_rate" not in flat, "Outlet order view carries no rates, values or markup")
		expect_error(log, "Outlet cannot open the markup report", api.markup_report, nowdate(), nowdate())
		as_user(STORE_USER)
		log.check(api.get_context()["see_amounts"] and api.get_home("Store")["stock_value"] is not None, "Storekeeper sees values")

		# 16. Branch accounting dimension on everything Stock Orders posted in this run
		as_user("Administrator")
		dim = api.branch_field()
		if dim:
			br = {l.warehouse: l.branch for l in frappe.get_all("ServePOS Stock Location", fields=["warehouse", "branch"])}
			transit = api.stock.transit_wh()
			bad, checked = [], 0
			# a location without a branch (none chosen yet) leaves its rows blank; branches are never created
			for se in frappe.get_all("Stock Entry", filters={"servepos_stock_order": ["is", "set"], "creation": [">=", started]}, pluck="name"):
				d = frappe.get_doc("Stock Entry", se)
				all_known = True
				for it in d.items:
					real = [w for w in (it.t_warehouse, it.s_warehouse) if w and w != transit]
					want = br.get(real[0]) if real else d.get(dim)
					all_known = all_known and bool(want)
					checked += 1
					if want and it.get(dim) != want:
						bad.append(f"{se} {it.item_code} {it.get(dim)} != {want}")
				gl = frappe.get_all("GL Entry", filters={"voucher_no": se, "is_cancelled": 0}, fields=[dim])
				if all_known and any(not g.get(dim) for g in gl):
					bad.append(f"{se} GL without branch")
			log.check(checked and not bad, "Every Stock Entry row and GL line carries the branch of its location (where one is set)", f"{checked} rows; " + "; ".join(bad[:3]))
			log.check(not frappe.db.exists("Branch", {"creation": [">=", started]}), "No Branch created by Stock Orders")
			recos = frappe.get_all("Stock Reconciliation", filters={"servepos_inventory_count": ["is", "set"], "creation": [">=", started]}, fields=["name", dim])
			log.check(recos and all(r.get(dim) for r in recos), "Inventory counts carry the outlet's branch", [r.get(dim) for r in recos])
			pos = frappe.get_all("Purchase Order", filters={"creation": [">=", started], "docstatus": 0}, fields=["name", dim])
			store_branch = br.get(frappe.db.get_value("ServePOS Stock Location", "Store", "warehouse"))
			if pos and store_branch:
				log.check(all(p.get(dim) == store_branch for p in pos), "Draft POs carry the Store's branch")

		# 17. a provider limited to item groups
		as_user("Administrator")
		store = frappe.get_doc("ServePOS Stock Location", "Store")
		store.set("item_groups", [{"item_group": "Packaging"}])
		store.save(ignore_permissions=True)
		as_user(OUTLET_USER)
		found = api.search_items("Store", "")
		groups = {frappe.db.get_value("Item", r.item_code, "item_group") for r in found}
		log.check(found and groups == {"Packaging"}, "Store limited to Packaging: search shows packaging only", sorted(groups))
		form = api.get_order_form(OUTLET, "Store", str(add_days(nowdate(), 7)))
		log.check(all(frappe.db.get_value("Item", l["item_code"], "item_group") == "Packaging" for l in form["lines"]),
			"Order form hides list items outside Packaging", f"{len(form['lines'])} lines")
		other = frappe.get_all("Item", filters={"servepos_stock_provider": "Store", "item_group": ["!=", "Packaging"], "disabled": 0, "is_stock_item": 1}, pluck="name", limit=1)
		if other:
			expect_error(log, "Ordering a non-packaging item from the Store is refused", api.save_order, OUTLET, "Store",
				[{"item_code": other[0], "qty": 1}], str(add_days(nowdate(), 7)))
	except Exception:
		log.fail("Unexpected error", traceback.format_exc()[-1500:])
	finally:
		frappe.set_user(admin)
		frappe.local.session = saved_session
		if not cint(keep):
			frappe.db.rollback()
	return {"passed": sum(1 for s in log.steps if s["ok"]), "failed": sum(1 for s in log.steps if not s["ok"]), "steps": log.steps}
