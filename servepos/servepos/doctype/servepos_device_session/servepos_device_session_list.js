frappe.listview_settings["ServePOS Device Session"] = {
	add_fields: ["revoked", "expires_on"],
	get_indicator(doc) {
		if (doc.revoked) return [__("Revoked"), "red", "revoked,=,1"];
		if (doc.expires_on && frappe.datetime.str_to_obj(doc.expires_on) < new Date())
			return [__("Expired"), "gray", "revoked,=,0"];
		return [__("Active"), "green", "revoked,=,0"];
	},
};
