frappe.ui.form.on("ServePOS Waiter", {
	refresh(frm) {
		if (frm.is_new() || !frappe.user.has_role("System Manager")) return;
		frm.add_custom_button(__("Waiter Devices"), () => {
			frappe.set_route("List", "ServePOS Device Session", { waiter: frm.doc.name });
		});
		frm.add_custom_button(__("Revoke all devices"), () => {
			frappe.confirm(
				__("Log every phone of {0} out of the waiter app?", [frm.doc.waiter_name]),
				() =>
					frappe
						.call("servepos.api.mobile.auth.revoke_all_for_waiter", { waiter: frm.doc.name })
						.then((r) => {
							frappe.show_alert({
								message: __("{0} device(s) logged out", [(r.message || {}).revoked || 0]),
								indicator: "green",
							});
						})
			);
		});
	},
});
