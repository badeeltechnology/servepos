import { useState, useMemo, useCallback } from "react";
import { useFrappeGetCall, useFrappePostCall, useFrappeGetDocList } from "frappe-react-sdk";
import {
  Download, Calendar, TrendingUp, ShoppingBag, CreditCard, Users, Clock,
  Utensils, Search, ArrowUpDown, BarChart3, Receipt, Filter, FileSpreadsheet,
  Ban, Coins, PackageX, RotateCcw, Trash2,
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type DatePreset = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "last_7_days" | "last_30_days" | "custom";

function getDateRange(preset: DatePreset, customFrom?: string, customTo?: string): [string, string] {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  switch (preset) {
    case "today": return [fmt(now), fmt(now)];
    case "yesterday": { const y = new Date(now); y.setDate(y.getDate() - 1); return [fmt(y), fmt(y)]; }
    case "this_week": { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return [fmt(d), fmt(now)]; }
    case "this_month": return [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, fmt(now)];
    case "last_month": { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); const le = new Date(now.getFullYear(), now.getMonth(), 0); return [fmt(lm), fmt(le)]; }
    case "last_7_days": { const d = new Date(now); d.setDate(d.getDate() - 6); return [fmt(d), fmt(now)]; }
    case "last_30_days": { const d = new Date(now); d.setDate(d.getDate() - 29); return [fmt(d), fmt(now)]; }
    case "custom": return [customFrom || fmt(now), customTo || fmt(now)];
  }
}

const presetLabels: Record<DatePreset, string> = {
  today: "Today", yesterday: "Yesterday", this_week: "This Week", this_month: "This Month",
  last_month: "Last Month", last_7_days: "Last 7 Days", last_30_days: "Last 30 Days", custom: "Custom Range",
};

const fmtCurrency = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHour = (h: number) => { const suffix = h >= 12 ? "PM" : "AM"; return `${h === 0 ? 12 : h > 12 ? h - 12 : h}${suffix}`; };

const COLORS = ["#111827", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

export default function Reports() {
  // Filters
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [itemSearch, setItemSearch] = useState("");
  const [itemSort, setItemSort] = useState<"qty" | "revenue">("revenue");

  const [fromDate, toDate] = useMemo(() => getDateRange(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);

  // Fetch POS Profiles
  const { data: profiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "company", "branch"],
    limit: 50,
  });

  // Fetch analytics
  const { data: analytics, isLoading } = useFrappeGetCall<{ message: any }>(
    "servepos.api.pos_session.get_sales_analytics",
    {
      pos_profile: selectedProfile || undefined,
      from_date: fromDate,
      to_date: toDate,
    }
  );
  const data = analytics?.message || {
    total_sales: 0, net_total: 0, total_tax: 0, order_count: 0, avg_order: 0, total_guests: 0,
    total_tips: 0, total_items_sold: 0,
    payment_breakdown: [], top_items: [], category_breakdown: [], order_type_breakdown: [],
    hourly_sales: [], daily_sales: [], waiter_breakdown: [], cashier_breakdown: [],
    void_summary: { count: 0, amount: 0, void_rate: 0, by_type: [], by_reason: [], by_disposition: [], by_staff: [], top_items: [] },
  };
  const voidData = data.void_summary || { count: 0, amount: 0, void_rate: 0, by_type: [], by_reason: [], by_disposition: [], by_staff: [], top_items: [] };

  // Fetch invoice list
  const { call: fetchInvoices } = useFrappePostCall("servepos.api.pos_session.get_invoice_summary");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoadingInvoices(true);
    try {
      const res = await fetchInvoices({
        pos_profile: selectedProfile || undefined,
        from_date: fromDate,
        to_date: toDate,
      });
      setInvoices(res?.message || []);
      setInvoicesLoaded(true);
    } catch {
      setInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, [selectedProfile, fromDate, toDate, fetchInvoices]);

  // Profile summary
  const { data: profileSummaryData } = useFrappeGetCall<{ message: any }>(
    "servepos.api.pos_session.get_profile_summary",
    { from_date: fromDate, to_date: toDate }
  );
  const profileSummary = profileSummaryData?.message || { rows: [], payment_modes: [] };

  // Derived
  const paymentTotal = useMemo(() => (data.payment_breakdown || []).reduce((s: number, p: any) => s + p.total, 0), [data.payment_breakdown]);
  const hourlyMax = useMemo(() => Math.max(...(data.hourly_sales || []).map((h: any) => h.total), 1), [data.hourly_sales]);

  const filteredItems = useMemo(() => {
    let items = [...(data.top_items || [])];
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      items = items.filter((it: any) => it.item_name?.toLowerCase().includes(q) || it.item_code?.toLowerCase().includes(q));
    }
    items.sort((a: any, b: any) => itemSort === "qty" ? b.total_qty - a.total_qty : b.total_amount - a.total_amount);
    return items;
  }, [data.top_items, itemSearch, itemSort]);

  // PDF Export
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Excel/CSV Export
  const handleExportExcel = useCallback(() => {
    const escape = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const sheets: string[] = [];

    // Summary
    sheets.push("--- SUMMARY ---");
    sheets.push(`Period,${fromDate}${fromDate !== toDate ? ` to ${toDate}` : ""}`);
    sheets.push(`Profile,${selectedProfile || "All Profiles"}`);
    sheets.push(`Total Sales,${data.total_sales}`);
    sheets.push(`Net Sales,${data.net_total}`);
    sheets.push(`Tax,${data.total_tax}`);
    sheets.push(`Orders,${data.order_count}`);
    sheets.push(`Avg Order,${data.avg_order}`);
    sheets.push(`Guests,${data.total_guests}`);
    sheets.push("");

    // Payment Methods
    if ((data.payment_breakdown || []).length > 0) {
      sheets.push("--- PAYMENT METHODS ---");
      sheets.push("Method,Amount,%");
      for (const p of data.payment_breakdown) {
        const pct = paymentTotal ? ((p.total / paymentTotal) * 100).toFixed(1) : "0";
        sheets.push(`${escape(p.mode_of_payment)},${p.total},${pct}%`);
      }
      sheets.push("");
    }

    // Order Types
    if ((data.order_type_breakdown || []).length > 0) {
      sheets.push("--- ORDER TYPES ---");
      sheets.push("Type,Orders,Revenue,%");
      for (const o of data.order_type_breakdown) {
        const pct = data.order_count ? ((o.count / data.order_count) * 100).toFixed(1) : "0";
        sheets.push(`${escape(o.type)},${o.count},${o.total},${pct}%`);
      }
      sheets.push("");
    }

    // Hourly Sales
    if ((data.hourly_sales || []).length > 0) {
      sheets.push("--- HOURLY SALES ---");
      sheets.push("Hour,Orders,Revenue");
      for (const h of data.hourly_sales) {
        sheets.push(`${fmtHour(h.hour)},${h.count},${h.total}`);
      }
      sheets.push("");
    }

    // Daily Sales
    if ((data.daily_sales || []).length > 1) {
      sheets.push("--- DAILY SALES ---");
      sheets.push("Date,Orders,Revenue,Avg Order");
      for (const d of data.daily_sales) {
        sheets.push(`${d.date},${d.count},${d.total},${d.count ? (d.total / d.count).toFixed(2) : 0}`);
      }
      sheets.push("");
    }

    // Waiter Performance
    if ((data.waiter_breakdown || []).length > 0) {
      sheets.push("--- WAITER PERFORMANCE ---");
      sheets.push("Waiter,Orders,Revenue,Avg Order");
      for (const w of data.waiter_breakdown) {
        sheets.push(`${escape(w.waiter)},${w.count},${w.total},${w.count ? (w.total / w.count).toFixed(2) : 0}`);
      }
      sheets.push("");
    }

    // Cashier Performance
    if ((data.cashier_breakdown || []).length > 0) {
      sheets.push("--- CASHIER PERFORMANCE ---");
      sheets.push("Cashier,Orders,Revenue,Avg Order");
      for (const c of data.cashier_breakdown) {
        sheets.push(`${escape(c.cashier)},${c.count},${c.total},${c.count ? (c.total / c.count).toFixed(2) : 0}`);
      }
      sheets.push("");
    }

    // Category Breakdown
    if ((data.category_breakdown || []).length > 0) {
      sheets.push("--- CATEGORY BREAKDOWN ---");
      sheets.push("Category,Items,Qty Sold,Revenue");
      for (const c of data.category_breakdown) {
        sheets.push(`${escape(c.category)},${c.items},${c.qty},${c.amount}`);
      }
      sheets.push("");
    }

    // Item-wise Sales
    sheets.push("--- ITEM-WISE SALES ---");
    sheets.push("Item Code,Item Name,Category,Qty Sold,Revenue");
    for (const it of filteredItems) {
      sheets.push(`${escape(it.item_code)},${escape(it.item_name)},${escape(it.item_group || "")},${it.total_qty},${it.total_amount}`);
    }
    sheets.push("");

    // Invoices (if loaded)
    if (invoicesLoaded && invoices.length > 0) {
      sheets.push("--- INVOICES ---");
      sheets.push("Invoice,Order #,Customer,Date,Time,Grand Total,Paid Amount,Payment Mode,Status");
      for (const inv of invoices) {
        sheets.push(`${escape(inv.name)},${escape(inv.servepos_order_number || "")},${escape(inv.customer_name || "")},${inv.posting_date},${(inv.posting_time || "").slice(0, 5)},${inv.grand_total},${inv.paid_amount},${escape(inv.mode_of_payment || "")},${inv.status}`);
      }
    }

    const csv = sheets.join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-report-${fromDate}${fromDate !== toDate ? `-to-${toDate}` : ""}${selectedProfile ? `-${selectedProfile}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, fromDate, toDate, selectedProfile, paymentTotal, filteredItems, invoices, invoicesLoaded]);

  return (
    <div className="p-6 print:p-0">
      {/* Header & Filters */}
      <div className="mb-6 print:mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Sales Report</h1>
              <p className="text-[12px] text-gray-500">
                {fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`}
                {selectedProfile && ` · ${selectedProfile}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={handleExportExcel}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
              <FileSpreadsheet className="h-3.5 w-3.5 text-gray-400" /> Export Excel
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
              <Download className="h-3.5 w-3.5 text-gray-400" /> Print / PDF
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 print:hidden">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">POS Profile</label>
            <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-medium text-gray-800 focus:border-gray-400 focus:outline-none min-w-[180px]">
              <option value="">All Profiles</option>
              {profiles?.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">Period</label>
            <select value={datePreset} onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-medium text-gray-800 focus:border-gray-400 focus:outline-none">
              {Object.entries(presetLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">From</label>
            <input type="date" value={datePreset === "custom" ? customFrom : fromDate}
              onChange={(e) => { setCustomFrom(e.target.value); setDatePreset("custom"); }}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 focus:border-gray-400 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">To</label>
            <input type="date" value={datePreset === "custom" ? customTo : toDate}
              onChange={(e) => { setCustomTo(e.target.value); setDatePreset("custom"); }}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 focus:border-gray-400 focus:outline-none" />
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {!isLoading && (
        <>
          {/* KPI Cards */}
          <div className="mb-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-green-50"><TrendingUp className="h-3.5 w-3.5 text-green-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Total Sales</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{fmtCurrency(data.total_sales)}</p>
              {data.total_tax > 0 && <p className="mt-0.5 text-[10px] text-gray-400">Net: {fmtCurrency(data.net_total)} + Tax: {fmtCurrency(data.total_tax)}</p>}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50"><ShoppingBag className="h-3.5 w-3.5 text-blue-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Orders</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{data.order_count}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">Avg: {fmtCurrency(data.avg_order)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50"><Users className="h-3.5 w-3.5 text-amber-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Guests</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{data.total_guests}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{data.total_guests > 0 ? fmtCurrency(data.total_sales / data.total_guests) : '0.00'} / guest</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-50"><Utensils className="h-3.5 w-3.5 text-rose-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Items Sold</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{data.total_items_sold || (data.top_items || []).reduce((s: number, i: any) => s + (i.total_qty || 0), 0)}</p>
            </div>
          </div>

          {/* Tips & Void Summary Row */}
          <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50"><Coins className="h-3.5 w-3.5 text-emerald-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Tips</span>
              </div>
              <p className="text-lg font-bold text-emerald-700">{fmtCurrency(data.total_tips || 0)}</p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-red-100"><Ban className="h-3.5 w-3.5 text-red-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Voids</span>
              </div>
              <p className="text-lg font-bold text-red-700">{voidData.count}</p>
              <p className="mt-0.5 text-[10px] text-red-400">{fmtCurrency(voidData.amount)} ({voidData.void_rate}%)</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50"><RotateCcw className="h-3.5 w-3.5 text-blue-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Return to Inventory</span>
              </div>
              <p className="text-lg font-bold text-blue-700">{(voidData.by_disposition || []).find((d: any) => d.disposition === 'Return to Inventory')?.count || 0}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{fmtCurrency((voidData.by_disposition || []).find((d: any) => d.disposition === 'Return to Inventory')?.amount || 0)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-50"><Trash2 className="h-3.5 w-3.5 text-orange-600" /></div>
                <span className="text-[11px] font-medium text-gray-500">Waste</span>
              </div>
              <p className="text-lg font-bold text-orange-700">{(voidData.by_disposition || []).find((d: any) => d.disposition === 'Waste')?.count || 0}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{fmtCurrency((voidData.by_disposition || []).find((d: any) => d.disposition === 'Waste')?.amount || 0)}</p>
            </div>
          </div>

          {/* Shop Summary Table */}
          {!selectedProfile && profileSummary.rows.length > 0 && (
            <div className="mb-5 rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-3">
                <h2 className="text-[13px] font-semibold text-gray-700">Sales by Shop</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Shop</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Total Sales</th>
                      {profileSummary.payment_modes.map((mode: string) => (
                        <th key={mode} className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">{mode}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {profileSummary.rows.map((row: any, idx: number) => (
                      <tr key={row.profile} className={`border-b border-gray-100 ${idx % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{row.profile}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{row.order_count}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(row.total_sales)}</td>
                        {profileSummary.payment_modes.map((mode: string) => (
                          <td key={mode} className="px-4 py-2.5 text-right text-gray-600">{fmtCurrency(row[mode] || 0)}</td>
                        ))}
                      </tr>
                    ))}
                    {profileSummary.rows.length > 1 && (
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                        <td className="px-4 py-2.5 text-gray-700">Total</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">
                          {profileSummary.rows.reduce((s: number, r: any) => s + r.order_count, 0)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-900">
                          {fmtCurrency(profileSummary.rows.reduce((s: number, r: any) => s + r.total_sales, 0))}
                        </td>
                        {profileSummary.payment_modes.map((mode: string) => (
                          <td key={mode} className="px-4 py-2.5 text-right text-gray-700">
                            {fmtCurrency(profileSummary.rows.reduce((s: number, r: any) => s + (r[mode] || 0), 0))}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.order_count === 0 && (
            <div className="mb-5 rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
              <BarChart3 className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No sales data for this period</p>
              <p className="mt-1 text-[12px] text-gray-400">Try selecting a different date range or profile</p>
            </div>
          )}

          {data.order_count > 0 && (
            <>
              {/* Payment + Order Type side by side */}
              <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Payment Methods */}
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3">
                    <h2 className="text-[13px] font-semibold text-gray-700">Payment Methods</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Method</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Amount</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">%</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.payment_breakdown || []).map((p: any, i: number) => {
                          const pct = paymentTotal ? (p.total / paymentTotal) * 100 : 0;
                          return (
                            <tr key={p.mode_of_payment} className="border-b border-gray-50">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                  <span className="font-medium text-gray-800">{p.mode_of_payment}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(p.total)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500">{pct.toFixed(1)}%</td>
                              <td className="px-4 py-2.5">
                                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {(data.payment_breakdown || []).length > 1 && (
                          <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                            <td className="px-4 py-2.5 text-gray-700">Total</td>
                            <td className="px-4 py-2.5 text-right text-gray-900">{fmtCurrency(paymentTotal)}</td>
                            <td className="px-4 py-2.5 text-right text-gray-500">100%</td>
                            <td></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Order Types */}
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3">
                    <h2 className="text-[13px] font-semibold text-gray-700">Order Types</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Type</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.order_type_breakdown || []).map((o: any, i: number) => {
                          const pct = data.order_count ? (o.count / data.order_count) * 100 : 0;
                          return (
                            <tr key={o.type} className="border-b border-gray-50">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[(i + 3) % COLORS.length] }} />
                                  <span className="font-medium text-gray-800">{o.type}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{o.count}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(o.total)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500">{pct.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Hourly Sales */}
              {(data.hourly_sales || []).length > 0 && (
                <div className="mb-5 rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-gray-400" />
                      <h2 className="text-[13px] font-semibold text-gray-700">Sales by Hour</h2>
                    </div>
                    <span className="text-[11px] text-gray-400">
                      Peak: <strong className="text-gray-700">{fmtHour((data.hourly_sales || []).reduce((max: any, h: any) => h.total > (max?.total || 0) ? h : max, { hour: 0, total: 0 }).hour)}</strong>
                    </span>
                  </div>
                  <div className="px-5 py-5">
                    <div className="flex gap-2">
                      <div className="flex flex-col justify-between text-[10px] text-gray-400 text-right w-12 flex-shrink-0" style={{ height: 180 }}>
                        <span>{fmtCurrency(hourlyMax)}</span>
                        <span>{fmtCurrency(hourlyMax * 0.5)}</span>
                        <span>0</span>
                      </div>
                      <div className="flex-1 relative">
                        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ height: 180 }}>
                          {[0, 1, 2].map((i) => <div key={i} className="border-b border-gray-100 w-full" />)}
                        </div>
                        <div className="flex items-end gap-[3px] relative" style={{ height: 180 }}>
                          {Array.from({ length: 24 }, (_, h) => {
                            const found = (data.hourly_sales || []).find((s: any) => s.hour === h);
                            const val = found ? found.total : 0;
                            const count = found ? found.count : 0;
                            const height = hourlyMax ? (val / hourlyMax) * 100 : 0;
                            const isActive = val > 0;
                            return (
                              <div key={h} className="flex-1 flex flex-col items-center group relative">
                                {isActive && (
                                  <div className="absolute -top-14 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-[10px] text-white shadow-xl">
                                    <div className="font-bold">{fmtCurrency(val)}</div>
                                    <div className="text-gray-400">{count} orders</div>
                                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45 h-2 w-2 bg-gray-900" />
                                  </div>
                                )}
                                <div
                                  className={`w-full rounded-t-sm transition-all ${isActive ? "hover:opacity-75 cursor-pointer" : ""}`}
                                  style={{
                                    height: `${Math.max(height, isActive ? 3 : 0)}%`,
                                    backgroundColor: isActive ? (height > 66 ? "#111827" : height > 33 ? "#4b5563" : "#9ca3af") : "transparent",
                                    minHeight: isActive ? 4 : 0,
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-[3px] ml-14 mt-2">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="flex-1 text-center text-[9px] text-gray-400">{h % 3 === 0 ? fmtHour(h) : ""}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Daily Sales */}
              {(data.daily_sales || []).length > 1 && (
                <div className="mb-5 rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3">
                    <h2 className="text-[13px] font-semibold text-gray-700">Daily Sales</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Date</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Avg Order</th>
                          <th className="px-4 py-2 w-32"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.daily_sales || []).map((d: any) => {
                          const dayMax = Math.max(...(data.daily_sales || []).map((x: any) => x.total), 1);
                          const pct = (d.total / dayMax) * 100;
                          return (
                            <tr key={d.date} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-4 py-2.5 font-medium text-gray-900">
                                {new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{d.count}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(d.total)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500">{d.count ? fmtCurrency(d.total / d.count) : "—"}</td>
                              <td className="px-4 py-2.5">
                                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                  <div className="h-full rounded-full bg-gray-900" style={{ width: `${pct}%` }} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                          <td className="px-4 py-2.5 text-gray-700">Total</td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{(data.daily_sales || []).reduce((s: number, d: any) => s + d.count, 0)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-900">{fmtCurrency((data.daily_sales || []).reduce((s: number, d: any) => s + d.total, 0))}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{fmtCurrency(data.avg_order)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Waiter & Cashier Performance */}
              {((data.waiter_breakdown || []).length > 0 || (data.cashier_breakdown || []).length > 0) && (
                <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {(data.waiter_breakdown || []).length > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-white">
                      <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-gray-400" />
                        <h2 className="text-[13px] font-semibold text-gray-700">Waiter Performance</h2>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Waiter</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Avg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(data.waiter_breakdown || []).map((w: any) => (
                              <tr key={w.waiter} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="px-4 py-2.5 font-medium text-gray-900">{w.waiter}</td>
                                <td className="px-4 py-2.5 text-right text-gray-600">{w.count}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(w.total)}</td>
                                <td className="px-4 py-2.5 text-right text-gray-500">{w.count ? fmtCurrency(w.total / w.count) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {(data.cashier_breakdown || []).length > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-white">
                      <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5 text-gray-400" />
                        <h2 className="text-[13px] font-semibold text-gray-700">Cashier Performance</h2>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Cashier</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Orders</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Avg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(data.cashier_breakdown || []).map((c: any) => (
                              <tr key={c.cashier} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="px-4 py-2.5 font-medium text-gray-900">{c.cashier}</td>
                                <td className="px-4 py-2.5 text-right text-gray-600">{c.count}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(c.total)}</td>
                                <td className="px-4 py-2.5 text-right text-gray-500">{c.count ? fmtCurrency(c.total / c.count) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Category Breakdown */}
              {(data.category_breakdown || []).length > 0 && (
                <div className="mb-5 rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3">
                    <h2 className="text-[13px] font-semibold text-gray-700">Category Breakdown</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Category</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Items</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Qty Sold</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">% of Revenue</th>
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
                                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                  <span className="font-medium text-gray-900">{c.category}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{c.items}</td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{c.qty}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(c.amount)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500">{pct.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Item-wise Sales (full, searchable, sortable) */}
              <div className="mb-5 rounded-lg border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-gray-700">Item-wise Sales</h2>
                  <div className="flex items-center gap-2 print:hidden">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input type="text" placeholder="Search items..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)}
                        className="rounded-md border border-gray-200 bg-gray-50 pl-8 pr-3 py-1.5 text-[12px] text-gray-800 focus:border-gray-400 focus:outline-none w-48" />
                    </div>
                    <button onClick={() => setItemSort(itemSort === "qty" ? "revenue" : "qty")}
                      className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                      <ArrowUpDown className="h-3 w-3" />
                      {itemSort === "qty" ? "By Qty" : "By Revenue"}
                    </button>
                  </div>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase w-8">#</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Item Code</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Item Name</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Qty Sold</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((it: any, i: number) => (
                        <tr key={it.item_code} className={`border-b border-gray-50 hover:bg-gray-50 ${it.total_qty === 0 ? "opacity-40" : ""}`}>
                          <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-4 py-2 font-mono text-[11px] text-gray-600">{it.item_code}</td>
                          <td className="px-4 py-2 font-medium text-gray-900">{it.item_name}</td>
                          <td className="px-4 py-2 text-gray-500">{it.item_group || "—"}</td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-900">{it.total_qty}</td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmtCurrency(it.total_amount)}</td>
                        </tr>
                      ))}
                      {filteredItems.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No items found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Void Analytics */}
              {voidData.count > 0 && (
                <div className="mb-5 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-200 bg-white">
                    <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
                      <Ban className="h-3.5 w-3.5 text-red-500" />
                      <h2 className="text-[13px] font-semibold text-gray-700">Void Reasons</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {(voidData.by_reason || []).map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] text-gray-700">{r.reason}</span>
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">{r.count}</span>
                          </div>
                          <span className="text-[12px] font-semibold text-red-600">{fmtCurrency(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-lg border border-gray-200 bg-white">
                      <div className="border-b border-gray-200 px-5 py-3">
                        <h2 className="text-[13px] font-semibold text-gray-700">Void by Type</h2>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {(voidData.by_type || []).map((t: any, i: number) => (
                          <div key={i} className="flex items-center justify-between px-5 py-2.5">
                            <span className="text-[12px] text-gray-700">{t.type}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-gray-400">{t.count}</span>
                              <span className="text-[12px] font-semibold text-gray-900">{fmtCurrency(t.amount)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {(voidData.by_staff || []).length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white">
                        <div className="border-b border-gray-200 px-5 py-3">
                          <h2 className="text-[13px] font-semibold text-gray-700">Voided By</h2>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {(voidData.by_staff || []).map((s: any, i: number) => (
                            <div key={i} className="flex items-center justify-between px-5 py-2.5">
                              <span className="text-[12px] text-gray-700">{s.staff}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-gray-400">{s.count} voids</span>
                                <span className="text-[12px] font-semibold text-gray-900">{fmtCurrency(s.amount)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Top Voided Items */}
              {(voidData.top_items || []).length > 0 && (
                <div className="mb-5 rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
                    <PackageX className="h-3.5 w-3.5 text-red-500" />
                    <h2 className="text-[13px] font-semibold text-gray-700">Top Voided Items</h2>
                  </div>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">
                        <th className="px-5 py-2 text-left">Item</th>
                        <th className="px-5 py-2 text-right">Qty</th>
                        <th className="px-5 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(voidData.top_items || []).map((item: any, i: number) => (
                        <tr key={i}>
                          <td className="px-5 py-2.5 text-gray-700">{item.item_name || item.item_code}</td>
                          <td className="px-5 py-2.5 text-right text-gray-600">{item.total_qty}</td>
                          <td className="px-5 py-2.5 text-right font-semibold text-red-600">{fmtCurrency(item.total_amount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Invoice List */}
              <div className="mb-5 rounded-lg border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-gray-700">Invoice List</h2>
                  {!invoicesLoaded && (
                    <button onClick={loadInvoices}
                      className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 print:hidden">
                      <Receipt className="h-3 w-3" /> Load Invoices
                    </button>
                  )}
                </div>
                {!invoicesLoaded && !loadingInvoices && (
                  <div className="px-5 py-8 text-center text-[12px] text-gray-400">
                    Click "Load Invoices" to view the full invoice list
                  </div>
                )}
                {loadingInvoices && (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner />
                  </div>
                )}
                {invoicesLoaded && !loadingInvoices && (
                  <div className="max-h-[500px] overflow-y-auto">
                    {invoices.length === 0 ? (
                      <div className="px-5 py-8 text-center text-[12px] text-gray-400">No invoices found</div>
                    ) : (
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">#</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Invoice</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Order #</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Customer</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Date</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Time</th>
                            <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Total</th>
                            <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Paid</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Payment</th>
                            <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((inv, idx) => (
                            <tr key={inv.name} className={`border-b border-gray-50 hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/30" : ""}`}>
                              <td className="px-4 py-2 text-gray-400">{idx + 1}</td>
                              <td className="px-4 py-2 font-mono text-[11px] font-medium text-gray-900">{inv.name}</td>
                              <td className="px-4 py-2 font-mono text-[11px] text-gray-600">{inv.servepos_order_number || "—"}</td>
                              <td className="px-4 py-2 text-gray-700">{inv.customer_name || "—"}</td>
                              <td className="px-4 py-2 text-gray-500">{inv.posting_date}</td>
                              <td className="px-4 py-2 text-gray-500">{inv.posting_time?.slice(0, 5) || ""}</td>
                              <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmtCurrency(inv.grand_total)}</td>
                              <td className="px-4 py-2 text-right font-semibold text-green-700">{fmtCurrency(inv.paid_amount)}</td>
                              <td className="px-4 py-2 text-gray-600">{inv.mode_of_payment || "—"}</td>
                              <td className="px-4 py-2 text-center">
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
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
