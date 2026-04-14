import { useState, useMemo, useCallback } from "react";
import { useFrappeGetDocList, useFrappeGetDocCount, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Link } from "react-router-dom";
import { Download, Calendar, ChevronDown, TrendingUp, ShoppingBag, CreditCard, Users, Clock, Utensils, ClipboardList, X, RefreshCw, Receipt } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type DatePreset = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "custom";

function getDateRange(preset: DatePreset, customFrom?: string, customTo?: string): [string, string] {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  switch (preset) {
    case "today": return [fmt(now), fmt(now)];
    case "yesterday": { const y = new Date(now); y.setDate(y.getDate() - 1); return [fmt(y), fmt(y)]; }
    case "this_week": { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return [fmt(d), fmt(now)]; }
    case "this_month": return [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, fmt(now)];
    case "last_month": { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); const le = new Date(now.getFullYear(), now.getMonth(), 0); return [fmt(lm), fmt(le)]; }
    case "custom": return [customFrom || fmt(now), customTo || fmt(now)];
  }
}

const presetLabels: Record<DatePreset, string> = {
  today: "Today", yesterday: "Yesterday", this_week: "This Week", this_month: "This Month", last_month: "Last Month", custom: "Custom",
};

const fmtCurrency = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHour = (h: number) => { const suffix = h >= 12 ? "PM" : "AM"; return `${h === 0 ? 12 : h > 12 ? h - 12 : h}${suffix}`; };

// Color palette for charts
const COLORS = ["#111827", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

export default function Dashboard() {
  const { profile, profileData } = useProfile();
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [fromDate, toDate] = useMemo(() => getDateRange(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);

  // Invoice summary state
  const [showInvoiceSummary, setShowInvoiceSummary] = useState(false);
  const [invoiceSummaryData, setInvoiceSummaryData] = useState<any[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const { call: getInvoiceSummary } = useFrappePostCall("servepos.api.pos_session.get_invoice_summary");

  const openInvoiceSummary = useCallback(async () => {
    setShowInvoiceSummary(true);
    setLoadingSummary(true);
    try {
      const res = await getInvoiceSummary({
        pos_profile: profile && profile !== "__all__" ? profile : undefined,
        from_date: fromDate,
        to_date: toDate,
      });
      setInvoiceSummaryData(res?.message || []);
    } catch {
      setInvoiceSummaryData([]);
    } finally {
      setLoadingSummary(false);
    }
  }, [profile, fromDate, toDate, getInvoiceSummary]);

  // Fetch analytics from API
  const { data: analytics } = useFrappeGetCall<{ message: any }>(
    "servepos.api.pos_session.get_sales_analytics",
    {
      pos_profile: profile && profile !== "__all__" ? profile : undefined,
      from_date: fromDate,
      to_date: toDate,
    }
  );
  const data = analytics?.message || {
    total_sales: 0, net_total: 0, total_tax: 0, order_count: 0, avg_order: 0, total_guests: 0,
    payment_breakdown: [], top_items: [], category_breakdown: [], order_type_breakdown: [],
    hourly_sales: [], daily_sales: [],
  };

  // Per-profile breakdown (fetch separately for "All Profiles" view)
  const { data: posProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "branch", "company"], limit: 50,
  });

  // Fetch individual profile data for all-profiles view
  const { data: allProfileAnalytics } = useFrappeGetCall<{ message: any }>(
    profile === "__all__" ? "servepos.api.pos_session.get_sales_analytics" : null as any,
    { from_date: fromDate, to_date: toDate }
  );
  const allData = allProfileAnalytics?.message;

  // Menu stats
  const { data: menuGroups } = useFrappeGetDocList("Item Group", {
    fields: ["name"], filters: [["servepos_is_menu_group", "=", 1]], limit: 100,
  });
  const menuGroupNames = menuGroups?.map((g: any) => g.name) || [];
  const { data: itemCount } = useFrappeGetDocCount("Item",
    menuGroupNames.length > 0 ? [["disabled", "=", 0], ["item_group", "in", menuGroupNames]] : [["disabled", "=", 0]]
  );
  const branch = (profileData as any)?.branch;
  const { data: tableCount } = useFrappeGetDocCount("ServePOS Table", branch ? [["branch", "=", branch]] : []);
  const { data: modGroupCount } = useFrappeGetDocCount("ServePOS Modifier Group");

  // Hourly chart max for scaling
  const hourlyMax = useMemo(() => Math.max(...(data.hourly_sales || []).map((h: any) => h.total), 1), [data.hourly_sales]);
  const paymentTotal = useMemo(() => (data.payment_breakdown || []).reduce((s: number, p: any) => s + p.total, 0), [data.payment_breakdown]);

  // PDF download
  const handleDownloadPDF = useCallback(() => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const profileName = profile === "__all__" ? "All Shops" : profile;
    const payHtml = (data.payment_breakdown || []).map((p: any) =>
      `<tr><td>${p.mode_of_payment}</td><td class="num">${fmtCurrency(p.total)}</td><td class="num">${paymentTotal ? ((p.total / paymentTotal) * 100).toFixed(1) : 0}%</td></tr>`
    ).join("");
    const itemsByQtyHtml = [...(data.top_items || [])].sort((a: any, b: any) => b.total_qty - a.total_qty).slice(0, 10).map((it: any, i: number) =>
      `<tr><td>${i + 1}</td><td>${it.item_name}</td><td class="num">${it.total_qty}</td><td class="num">${fmtCurrency(it.total_amount)}</td></tr>`
    ).join("");
    const itemsByRevHtml = (data.top_items || []).slice(0, 10).map((it: any, i: number) =>
      `<tr><td>${i + 1}</td><td>${it.item_name}</td><td class="num">${fmtCurrency(it.total_amount)}</td><td class="num">${it.total_qty}</td></tr>`
    ).join("");
    const catHtml = (data.category_breakdown || []).map((c: any) =>
      `<tr><td>${c.category}</td><td class="num">${c.items}</td><td class="num">${c.qty}</td><td class="num">${fmtCurrency(c.amount)}</td></tr>`
    ).join("");
    const orderTypeHtml = (data.order_type_breakdown || []).map((o: any) =>
      `<tr><td>${o.type}</td><td class="num">${o.count}</td><td class="num">${fmtCurrency(o.total)}</td></tr>`
    ).join("");
    const waiterHtml = (data.waiter_breakdown || []).map((w: any) =>
      `<tr><td>${w.waiter}</td><td class="num">${w.count}</td><td class="num">${fmtCurrency(w.total)}</td></tr>`
    ).join("");
    const cashierHtml = (data.cashier_breakdown || []).map((c: any) =>
      `<tr><td>${c.cashier}</td><td class="num">${c.count}</td><td class="num">${fmtCurrency(c.total)}</td></tr>`
    ).join("");
    const hourlyHtml = (data.hourly_sales || []).map((h: any) =>
      `<tr><td>${fmtHour(h.hour)}</td><td class="num">${h.count}</td><td class="num">${fmtCurrency(h.total)}</td></tr>`
    ).join("");
    const dailyHtml = (data.daily_sales || []).length > 1 ? (data.daily_sales || []).map((d: any) =>
      `<tr><td>${d.date}</td><td class="num">${d.count}</td><td class="num">${fmtCurrency(d.total)}</td></tr>`
    ).join("") : "";

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Sales Report - ${profileName}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #111; font-size: 13px; }
        h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 14px; margin: 20px 0 8px; }
        .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
        .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px; }
        .stat { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
        .stat b { font-size: 18px; display: block; } .stat span { font-size: 11px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
        th { font-weight: 600; color: #666; text-transform: uppercase; font-size: 10px; background: #f9fafb; }
        .num { text-align: right; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>Sales Report — ${profileName}</h1>
      <div class="sub">${fromDate}${fromDate !== toDate ? ` to ${toDate}` : ""}</div>
      <div class="stats">
        <div class="stat"><b>${fmtCurrency(data.total_sales)}</b><span>Total Sales</span></div>
        <div class="stat"><b>${data.order_count}</b><span>Orders</span></div>
        <div class="stat"><b>${fmtCurrency(data.avg_order)}</b><span>Avg Order</span></div>
        <div class="stat"><b>${fmtCurrency(data.total_tax)}</b><span>Tax</span></div>
        <div class="stat"><b>${data.total_guests}</b><span>Guests</span></div>
      </div>
      <div class="two-col">
        <div><h2>Payment Methods</h2><table><thead><tr><th>Method</th><th class="num">Amount</th><th class="num">%</th></tr></thead><tbody>${payHtml}</tbody></table></div>
        <div><h2>Order Types</h2><table><thead><tr><th>Type</th><th class="num">Orders</th><th class="num">Total</th></tr></thead><tbody>${orderTypeHtml}</tbody></table></div>
      </div>
      <div class="two-col">
        <div><h2>Top Items by Quantity</h2><table><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead><tbody>${itemsByQtyHtml}</tbody></table></div>
        <div><h2>Top Items by Revenue</h2><table><thead><tr><th>#</th><th>Item</th><th class="num">Revenue</th><th class="num">Qty</th></tr></thead><tbody>${itemsByRevHtml}</tbody></table></div>
      </div>
      <h2>Category Breakdown</h2>
      <table><thead><tr><th>Category</th><th class="num">Items</th><th class="num">Qty Sold</th><th class="num">Revenue</th></tr></thead><tbody>${catHtml}</tbody></table>
      ${waiterHtml || cashierHtml ? `<div class="two-col">${waiterHtml ? `<div><h2>Waiter Performance</h2><table><thead><tr><th>Waiter</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead><tbody>${waiterHtml}</tbody></table></div>` : "<div></div>"}${cashierHtml ? `<div><h2>Cashier Performance</h2><table><thead><tr><th>Cashier</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead><tbody>${cashierHtml}</tbody></table></div>` : ""}</div>` : ""}
      ${hourlyHtml ? `<h2>Sales by Hour</h2><table><thead><tr><th>Hour</th><th class="num">Orders</th><th class="num">Total</th></tr></thead><tbody>${hourlyHtml}</tbody></table>` : ""}
      ${dailyHtml ? `<h2>Daily Sales</h2><table><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Total</th></tr></thead><tbody>${dailyHtml}</tbody></table>` : ""}
      <script>window.print();</script>
    </body></html>`);
    printWindow.document.close();
  }, [profile, fromDate, toDate, data, paymentTotal]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{profile === "__all__" ? "All Shops" : profile}</h1>
          {profile !== "__all__" && (
            <p className="text-sm text-gray-500">
              {(profileData as any)?.company}{branch && ` · ${branch}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
              <Calendar className="h-3.5 w-3.5 text-gray-400" />
              {presetLabels[datePreset]}
              {datePreset === "custom" && ` (${fromDate} – ${toDate})`}
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>
            {showDatePicker && (
              <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                {(["today", "yesterday", "this_week", "this_month", "last_month"] as DatePreset[]).map((p) => (
                  <button key={p} onClick={() => { setDatePreset(p); setShowDatePicker(false); }}
                    className={`w-full rounded-md px-3 py-2 text-left text-[12px] font-medium ${datePreset === p ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
                    {presetLabels[p]}
                  </button>
                ))}
                <div className="mt-1 border-t border-gray-100 pt-2">
                  <p className="mb-1.5 px-3 text-[11px] font-medium text-gray-400">Custom Range</p>
                  <div className="flex gap-1.5 px-2">
                    <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setDatePreset("custom"); }}
                      className="w-full rounded border border-gray-200 px-2 py-1.5 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none" />
                    <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setDatePreset("custom"); }}
                      className="w-full rounded border border-gray-200 px-2 py-1.5 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none" />
                  </div>
                  {datePreset === "custom" && (
                    <button onClick={() => setShowDatePicker(false)}
                      className="mt-1.5 w-full rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-gray-800">Apply</button>
                  )}
                </div>
              </div>
            )}
          </div>
          <button onClick={openInvoiceSummary}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
            <ClipboardList className="h-3.5 w-3.5 text-gray-400" /> Invoices
          </button>
          <button onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
            <Download className="h-3.5 w-3.5 text-gray-400" /> PDF
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mb-5 grid grid-cols-5 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-green-50">
              <TrendingUp className="h-3.5 w-3.5 text-green-600" />
            </div>
            <span className="text-[11px] font-medium text-gray-500">Total Sales</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{fmtCurrency(data.total_sales)}</p>
          {data.total_tax > 0 && <p className="mt-0.5 text-[11px] text-gray-400">Net: {fmtCurrency(data.net_total)} + Tax: {fmtCurrency(data.total_tax)}</p>}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50">
              <ShoppingBag className="h-3.5 w-3.5 text-blue-600" />
            </div>
            <span className="text-[11px] font-medium text-gray-500">Orders</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{data.order_count}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-purple-50">
              <CreditCard className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <span className="text-[11px] font-medium text-gray-500">Avg Order</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{fmtCurrency(data.avg_order)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50">
              <Users className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <span className="text-[11px] font-medium text-gray-500">Guests</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{data.total_guests}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-50">
              <Utensils className="h-3.5 w-3.5 text-rose-600" />
            </div>
            <span className="text-[11px] font-medium text-gray-500">Items Sold</span>
          </div>
          <p className="text-xl font-bold text-gray-900">
            {(data.top_items || []).reduce((s: number, i: any) => s + (i.total_qty || 0), 0)}
          </p>
        </div>
      </div>

      {data.order_count === 0 && (
        <div className="mb-5 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No sales data for {presetLabels[datePreset].toLowerCase()}</p>
          <p className="mt-1 text-[12px] text-gray-400">Try selecting a different date range</p>
        </div>
      )}

      {data.order_count > 0 && (
        <>
          {/* Payment Methods + Order Types — side by side */}
          <div className="mb-5 grid grid-cols-2 gap-4">
            {/* Payment Methods */}
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Payment Methods</h2>
              </div>
              <div className="p-4">
                {(data.payment_breakdown || []).map((p: any, i: number) => {
                  const pct = paymentTotal ? (p.total / paymentTotal) * 100 : 0;
                  return (
                    <div key={p.mode_of_payment} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-[13px] font-medium text-gray-800">{p.mode_of_payment}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-400">{pct.toFixed(1)}%</span>
                          <span className="text-[13px] font-semibold text-gray-900">{fmtCurrency(p.total)}</span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                    </div>
                  );
                })}
                {(data.payment_breakdown || []).length === 0 && (
                  <p className="py-4 text-center text-[12px] text-gray-400">No payment data</p>
                )}
              </div>
            </div>

            {/* Order Types */}
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Order Types</h2>
              </div>
              <div className="p-4">
                {(data.order_type_breakdown || []).map((o: any, i: number) => {
                  const pct = data.order_count ? (o.count / data.order_count) * 100 : 0;
                  return (
                    <div key={o.type} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[(i + 3) % COLORS.length] }} />
                          <span className="text-[13px] font-medium text-gray-800">{o.type}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-400">{o.count} orders ({pct.toFixed(0)}%)</span>
                          <span className="text-[13px] font-semibold text-gray-900">{fmtCurrency(o.total)}</span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: COLORS[(i + 3) % COLORS.length] }} />
                      </div>
                    </div>
                  );
                })}
                {(data.order_type_breakdown || []).length === 0 && (
                  <p className="py-4 text-center text-[12px] text-gray-400">No order type data</p>
                )}
              </div>
            </div>
          </div>

          {/* Waiter & Cashier Breakdown — side by side */}
          {((data.waiter_breakdown || []).length > 0 || (data.cashier_breakdown || []).length > 0) && (
            <div className="mb-5 grid grid-cols-2 gap-4">
              {/* Waiter Performance */}
              {(data.waiter_breakdown || []).length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-gray-400" />
                    <h2 className="text-[13px] font-semibold text-gray-700">Waiter Performance</h2>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Waiter</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.waiter_breakdown || []).map((w: any, i: number) => (
                          <tr key={w.waiter} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold" style={{ backgroundColor: `${COLORS[i % COLORS.length]}15`, color: COLORS[i % COLORS.length] }}>
                                  {w.waiter.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-[12px] font-medium text-gray-900">{w.waiter}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right text-[12px] text-gray-600">{w.count}</td>
                            <td className="px-4 py-2.5 text-right text-[12px] font-semibold text-gray-900">{fmtCurrency(w.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Cashier Performance */}
              {(data.cashier_breakdown || []).length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-gray-400" />
                    <h2 className="text-[13px] font-semibold text-gray-700">Cashier Performance</h2>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Cashier</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.cashier_breakdown || []).map((c: any, i: number) => (
                          <tr key={c.cashier} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold" style={{ backgroundColor: `${COLORS[(i + 4) % COLORS.length]}15`, color: COLORS[(i + 4) % COLORS.length] }}>
                                  {c.cashier.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-[12px] font-medium text-gray-900">{c.cashier}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right text-[12px] text-gray-600">{c.count}</td>
                            <td className="px-4 py-2.5 text-right text-[12px] font-semibold text-gray-900">{fmtCurrency(c.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hourly Sales Chart */}
          {(data.hourly_sales || []).length > 0 && (
            <div className="mb-5 rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  <h2 className="text-[13px] font-semibold text-gray-700">Sales by Hour</h2>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-gray-400">
                  <span>Peak: <strong className="text-gray-700">{fmtHour((data.hourly_sales || []).reduce((max: any, h: any) => h.total > (max?.total || 0) ? h : max, { hour: 0, total: 0 }).hour)}</strong></span>
                  <span>Peak Revenue: <strong className="text-gray-700">{fmtCurrency(hourlyMax)}</strong></span>
                </div>
              </div>
              <div className="px-5 py-5">
                {/* Y-axis labels + bars */}
                <div className="flex gap-2">
                  {/* Y-axis */}
                  <div className="flex flex-col justify-between text-[10px] text-gray-400 text-right w-12 flex-shrink-0" style={{ height: 200 }}>
                    <span>{fmtCurrency(hourlyMax)}</span>
                    <span>{fmtCurrency(hourlyMax * 0.75)}</span>
                    <span>{fmtCurrency(hourlyMax * 0.5)}</span>
                    <span>{fmtCurrency(hourlyMax * 0.25)}</span>
                    <span>0</span>
                  </div>
                  {/* Bars */}
                  <div className="flex-1 relative">
                    {/* Grid lines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ height: 200 }}>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="border-b border-gray-100 w-full" />
                      ))}
                    </div>
                    <div className="flex items-end gap-[3px] relative" style={{ height: 200 }}>
                      {Array.from({ length: 24 }, (_, h) => {
                        const found = (data.hourly_sales || []).find((s: any) => s.hour === h);
                        const val = found ? found.total : 0;
                        const count = found ? found.count : 0;
                        const height = hourlyMax ? (val / hourlyMax) * 100 : 0;
                        const isActive = val > 0;
                        return (
                          <div key={h} className="flex-1 flex flex-col items-center group relative">
                            {isActive && (
                              <div className="absolute -top-16 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap rounded-lg bg-gray-900 px-3 py-2 text-[11px] text-white shadow-xl">
                                <div className="font-bold text-[13px]">{fmtCurrency(val)}</div>
                                <div className="text-gray-400 mt-0.5">{count} order{count !== 1 ? "s" : ""} · {fmtHour(h)}</div>
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45 h-2 w-2 bg-gray-900" />
                              </div>
                            )}
                            <div
                              className={`w-full rounded-t-sm transition-all duration-300 ${isActive ? "hover:opacity-75 cursor-pointer" : ""}`}
                              style={{
                                height: `${Math.max(height, isActive ? 3 : 0)}%`,
                                backgroundColor: isActive
                                  ? height > 75 ? "#111827" : height > 50 ? "#374151" : height > 25 ? "#6b7280" : "#9ca3af"
                                  : "transparent",
                                minHeight: isActive ? 6 : 0,
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {/* X-axis labels */}
                <div className="flex gap-[3px] ml-14 mt-2">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-gray-400 font-medium">
                      {h % 2 === 0 ? fmtHour(h) : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Top Items by Qty + Top Items by Revenue — side by side */}
          <div className="mb-5 grid grid-cols-2 gap-4">
            {/* Top by Quantity */}
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Top Items by Quantity</h2>
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase w-8">#</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Qty</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(data.top_items || [])].sort((a: any, b: any) => b.total_qty - a.total_qty).map((it: any, i: number) => (
                      <tr key={it.item_code} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            i < 3 ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500"
                          }`}>{i + 1}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-[12px] font-medium text-gray-900 truncate max-w-[180px]">{it.item_name}</p>
                          <p className="text-[10px] text-gray-400">{it.item_group}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[12px] font-bold text-gray-900">{it.total_qty}</td>
                        <td className="px-4 py-2.5 text-right text-[12px] text-gray-500">{fmtCurrency(it.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(data.top_items || []).length === 0 && (
                  <p className="py-6 text-center text-[12px] text-gray-400">No items sold</p>
                )}
              </div>
            </div>

            {/* Top by Revenue */}
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Top Items by Revenue</h2>
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase w-8">#</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.top_items || []).map((it: any, i: number) => (
                      <tr key={it.item_code} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            i < 3 ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"
                          }`}>{i + 1}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-[12px] font-medium text-gray-900 truncate max-w-[180px]">{it.item_name}</p>
                          <p className="text-[10px] text-gray-400">{it.item_group}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[12px] font-bold text-gray-900">{fmtCurrency(it.total_amount)}</td>
                        <td className="px-4 py-2.5 text-right text-[12px] text-gray-500">{it.total_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(data.top_items || []).length === 0 && (
                  <p className="py-6 text-center text-[12px] text-gray-400">No items sold</p>
                )}
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="mb-5">
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Category Breakdown</h2>
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Items</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Qty</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.category_breakdown || []).map((c: any, i: number) => {
                      const catTotal = (data.category_breakdown || []).reduce((s: number, x: any) => s + x.amount, 0);
                      const pct = catTotal ? (c.amount / catTotal) * 100 : 0;
                      return (
                        <tr key={c.category} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              <span className="text-[12px] font-medium text-gray-900">{c.category}</span>
                            </div>
                            <div className="mt-1 ml-4 h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-[12px] text-gray-600">{c.items}</td>
                          <td className="px-4 py-2.5 text-right text-[12px] text-gray-600">{c.qty}</td>
                          <td className="px-4 py-2.5 text-right text-[12px] font-semibold text-gray-900">{fmtCurrency(c.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {(data.category_breakdown || []).length === 0 && (
                  <p className="py-6 text-center text-[12px] text-gray-400">No category data</p>
                )}
              </div>
            </div>
          </div>

          {/* Daily Sales — shown for multi-day ranges */}
          {(data.daily_sales || []).length > 1 && (
            <div className="mb-5 rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Daily Sales</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-5 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Date</th>
                    <th className="px-5 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                    <th className="px-5 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Total</th>
                    <th className="px-5 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase w-40"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data.daily_sales || []).map((d: any) => {
                    const dayMax = Math.max(...(data.daily_sales || []).map((x: any) => x.total), 1);
                    const pct = (d.total / dayMax) * 100;
                    return (
                      <tr key={d.date} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-2.5 text-[12px] font-medium text-gray-900">
                          {new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                        </td>
                        <td className="px-5 py-2.5 text-right text-[12px] text-gray-600">{d.count}</td>
                        <td className="px-5 py-2.5 text-right text-[12px] font-semibold text-gray-900">{fmtCurrency(d.total)}</td>
                        <td className="px-5 py-2.5">
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-gray-900 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Setup Stats */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: "Menu Items", value: itemCount ?? 0, to: "/menu" },
          { label: "Categories", value: menuGroupNames.length, to: "/menu" },
          { label: "Modifiers", value: modGroupCount ?? 0, to: "/modifiers" },
          { label: "Tables", value: tableCount ?? 0, to: "/restaurant" },
        ].map((s) => (
          <Link key={s.label} to={s.to} className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors">
            <p className="text-xl font-semibold text-gray-900">{s.value}</p>
            <p className="mt-0.5 text-[12px] text-gray-500">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-gray-700">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-200">
          <Link to="/menu" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600 text-xs font-bold">+</span>
            Add menu item
          </Link>
          <Link to="/modifiers" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-600 text-xs font-bold">+</span>
            Create modifier group
          </Link>
          <Link to="/restaurant" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 border-t border-gray-200 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600 text-xs font-bold">+</span>
            Add table or room
          </Link>
          <Link to="/visibility" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 border-t border-gray-200 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-green-50 text-green-600 text-xs font-bold">→</span>
            Manage visibility
          </Link>
        </div>
      </div>

      {/* Invoice Summary Dialog */}
      {showInvoiceSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-5xl max-h-[85vh] rounded-xl flex flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-[14px] font-semibold text-gray-900">Invoice Summary</h2>
                  <p className="text-[11px] text-gray-500">
                    {invoiceSummaryData.length} invoices · {fromDate}{fromDate !== toDate ? ` to ${toDate}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openInvoiceSummary}
                  className="flex items-center justify-center rounded-md border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setShowInvoiceSummary(false)}
                  className="flex items-center justify-center rounded-md border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {loadingSummary ? (
                <div className="flex items-center justify-center py-16">
                  <LoadingSpinner />
                </div>
              ) : !invoiceSummaryData.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Receipt className="mb-3 h-10 w-10" />
                  <p className="text-[13px] font-medium">No invoices found</p>
                  <p className="text-[11px]">Invoices for the selected period will appear here</p>
                </div>
              ) : (
                <>
                  {/* Summary Totals */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                      <p className="text-[10px] font-medium text-gray-500 uppercase">Total Invoices</p>
                      <p className="text-xl font-bold text-gray-900">{invoiceSummaryData.length}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                      <p className="text-[10px] font-medium text-gray-500 uppercase">Grand Total</p>
                      <p className="text-xl font-bold text-gray-900">
                        {fmtCurrency(invoiceSummaryData.reduce((s, i) => s + i.grand_total, 0))}
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                      <p className="text-[10px] font-medium text-gray-500 uppercase">Total Paid</p>
                      <p className="text-xl font-bold text-green-600">
                        {fmtCurrency(invoiceSummaryData.reduce((s, i) => s + i.paid_amount, 0))}
                      </p>
                    </div>
                  </div>

                  {/* Invoice Table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">#</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Invoice No</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Order No</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Time</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Grand Total</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Paid Amount</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Mode of Payment</th>
                          <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceSummaryData.map((inv, idx) => (
                          <tr key={inv.name} className={`border-t border-gray-100 ${idx % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                            <td className="px-4 py-2.5 text-gray-400">{idx + 1}</td>
                            <td className="px-4 py-2.5 font-mono text-[11px] font-medium text-gray-900">{inv.name}</td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-gray-600">{inv.servepos_order_number || "-"}</td>
                            <td className="px-4 py-2.5 text-gray-500">{inv.posting_time?.slice(0, 5)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(inv.grand_total)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-green-600">{fmtCurrency(inv.paid_amount)}</td>
                            <td className="px-4 py-2.5 text-gray-600">{inv.mode_of_payment || "-"}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                inv.status === "Paid" ? "bg-green-50 text-green-700" :
                                inv.status === "Consolidated" ? "bg-blue-50 text-blue-700" :
                                inv.status === "Cancelled" ? "bg-red-50 text-red-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
