// Previous items: pull what was last ordered from this supplier, one line per item with its latest
// description, UOM and rate, into the item table.
frappe.ui.form.on("Purchase Order", {
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;
		frm.add_custom_button(
			__("Previous Items of Supplier"),
			() => servepos_previous_items(frm),
			__("Get Items From")
		);
	},
	supplier(frm) {
		if (frm.doc.docstatus === 0 && frm.doc.supplier && !(frm.doc.items || []).some((r) => r.item_code)) {
			frappe.show_alert(
				{
					message: __(
						"Get Items From > Previous Items of Supplier fills the items last ordered from {0}",
						[frm.doc.supplier]
					),
					indicator: "blue",
				},
				6
			);
		}
	},
});

function servepos_previous_items(frm) {
	if (!frm.doc.supplier) {
		frappe.msgprint(__("Choose the supplier first"));
		return;
	}
	frappe.call({
		method: "servepos.stock_orders.purchase.supplier_items",
		args: { supplier: frm.doc.supplier, company: frm.doc.company },
		freeze: true,
		callback: (r) => {
			const rows = r.message || [];
			if (!rows.length) {
				frappe.msgprint(
					__("No submitted Purchase Orders for {0} in the last 12 months", [frm.doc.supplier])
				);
				return;
			}
			servepos_items_dialog(frm, rows);
		},
	});
}

function servepos_items_dialog(frm, rows) {
	const esc = frappe.utils.escape_html;
	const have = new Set((frm.doc.items || []).map((r) => r.item_code).filter(Boolean));
	const d = new frappe.ui.Dialog({
		title: __("Previous items of {0}", [frm.doc.supplier]),
		size: "extra-large",
		fields: [
			{
				fieldtype: "Data",
				fieldname: "q",
				label: __("Search"),
				placeholder: __("Item name, code or description"),
			},
			{ fieldtype: "Column Break" },
			{ fieldtype: "Check", fieldname: "use_qty", label: __("Use last quantities"), default: 1 },
			{ fieldtype: "Section Break" },
			{ fieldtype: "HTML", fieldname: "list" },
		],
		primary_action_label: __("Pull into the order"),
		primary_action: async () => {
			const picked = rows.filter((r) =>
				d.$wrapper.find(`input[data-code="${CSS.escape(r.item_code)}"]`).prop("checked")
			);
			if (!picked.length) {
				frappe.msgprint(__("Tick at least one item"));
				return;
			}
			d.hide();
			await servepos_pull(frm, picked, d.get_value("use_qty"));
		},
	});
	const render = () => {
		const q = (d.get_value("q") || "").toLowerCase();
		const shown = rows.filter(
			(r) =>
				!q ||
				[r.item_code, r.item_name, r.description_text].some((v) =>
					(v || "").toLowerCase().includes(q)
				)
		);
		const body = shown
			.map((r) => {
				const dup = have.has(r.item_code);
				return `<tr class="${dup ? "text-muted" : ""}">
				<td><input type="checkbox" data-code="${esc(r.item_code)}" ${dup ? "" : "checked"}></td>
				<td><b>${esc(r.item_name || r.item_code)}</b><div class="small text-muted">${esc(r.item_code)}${
					dup ? " · " + __("already in this order") : ""
				}</div></td>
				<td style="max-width:340px; white-space:pre-wrap">${esc(r.description_text)}</td>
				<td class="text-right">${format_number(r.qty)} ${esc(r.uom || "")}</td>
				<td class="text-right">${format_currency(r.rate, frm.doc.currency)}</td>
				<td class="small">${frappe.datetime.str_to_user(r.transaction_date)}<div class="text-muted">${esc(
					r.purchase_order
				)} · ${__("{0} orders", [r.times_ordered])}</div></td>
			</tr>`;
			})
			.join("");
		d.fields_dict.list.$wrapper.html(`
			<div class="small text-muted mb-2">${__(
				"Each item once, as in its latest order (last 12 months). Untick what you do not need."
			)}
				<a class="sp-all ml-2">${__("Tick all")}</a> · <a class="sp-none">${__("Untick all")}</a></div>
			<div style="max-height:55vh; overflow:auto"><table class="table table-sm table-hover">
				<thead><tr><th></th><th>${__("Item")}</th><th>${__("Description")}</th><th class="text-right">${__(
			"Last qty"
		)}</th><th class="text-right">${__("Last rate")}</th><th>${__("Last ordered")}</th></tr></thead>
				<tbody>${
					body || `<tr><td colspan="6" class="text-muted">${__("Nothing matches")}</td></tr>`
				}</tbody></table></div>`);
		d.fields_dict.list.$wrapper
			.find(".sp-all")
			.on("click", () =>
				d.fields_dict.list.$wrapper.find("input[type=checkbox]").prop("checked", true)
			);
		d.fields_dict.list.$wrapper
			.find(".sp-none")
			.on("click", () =>
				d.fields_dict.list.$wrapper.find("input[type=checkbox]").prop("checked", false)
			);
	};
	d.fields_dict.q.$input.on("input", frappe.utils.debounce(render, 200));
	render();
	d.show();
}

async function servepos_pull(frm, picked, use_qty) {
	// drop the empty first row a new order starts with
	(frm.doc.items || [])
		.filter((r) => !r.item_code)
		.forEach((r) => frm.get_field("items").grid.grid_rows_by_docname[r.name]?.remove());
	frappe.dom.freeze(__("Adding {0} items...", [picked.length]));
	const wanted = [];
	try {
		for (const r of picked) {
			const row = frm.add_child("items");
			if (frm.doc.schedule_date) row.schedule_date = frm.doc.schedule_date;
			await frappe.model.set_value(row.doctype, row.name, "item_code", r.item_code);
			await frappe.after_ajax();
			if (r.uom && r.uom !== row.uom) {
				await frappe.model.set_value(row.doctype, row.name, "uom", r.uom);
				await frappe.after_ajax();
			}
			await frappe.model.set_value(row.doctype, row.name, {
				qty: use_qty ? r.qty : row.qty || 1,
				description: r.description || row.description,
			});
			await frappe.after_ajax();
			await frappe.model.set_value(row.doctype, row.name, "rate", r.rate);
			wanted.push([row.name, r.rate]);
		}
		// ERPNext's own price lookup can land after our rate: put the last rates back once it has settled
		await frappe.after_ajax();
		await new Promise((resolve) => setTimeout(resolve, 600));
		await frappe.after_ajax();
		for (const [name, rate] of wanted) {
			const row = locals["Purchase Order Item"][name];
			if (row && flt(row.rate) !== flt(rate)) {
				await frappe.model.set_value(row.doctype, name, "rate", rate);
				await frappe.after_ajax();
			}
		}
	} finally {
		frappe.dom.unfreeze();
	}
	frm.refresh_field("items");
	frappe.show_alert({
		message: __("{0} items added. Change or remove lines, then save.", [picked.length]),
		indicator: "green",
	});
}
