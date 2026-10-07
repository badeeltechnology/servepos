// ServePOS Stock Orders: roles without Desk access are sent to their page.
(function () {
	var to = window.frappe && frappe.boot && frappe.boot.servepos_stock_redirect;
	if (to) window.location.replace(to);
})();
