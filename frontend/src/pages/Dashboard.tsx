import { useState, useMemo, useRef, useCallback } from "react";
import { useFrappeGetDocList, useFrappeGetDocCount } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Link } from "react-router-dom";
import { Download, Calendar, ChevronDown } from "lucide-react";

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

export default function Dashboard() {
  const { profile, profileData } = useProfile();
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const [fromDate, toDate] = useMemo(() => getDateRange(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);

  // Fetch all POS profiles
  const { data: posProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "branch", "company"], limit: 50,
  });

  // Build invoice filters
  const invoiceFilters = useMemo(() => {
    const f: any[] = [["docstatus", "=", 1], ["posting_date", ">=", fromDate], ["posting_date", "<=", toDate]];
    if (profile && profile !== "__all__") f.push(["pos_profile", "=", profile]);
    return f;
  }, [profile, fromDate, toDate]);

  // Fetch POS Invoices
  const { data: posInvoices } = useFrappeGetDocList("POS Invoice", {
    fields: ["name", "pos_profile", "grand_total", "posting_date", "net_total", "total_taxes_and_charges"],
    filters: invoiceFilters, limit: 0,
  });

  // Also fetch Sales Invoices that are POS
  const salesInvFilters = useMemo(() => {
    const f: any[] = [["docstatus", "=", 1], ["is_pos", "=", 1], ["posting_date", ">=", fromDate], ["posting_date", "<=", toDate]];
    if (profile && profile !== "__all__") f.push(["pos_profile", "=", profile]);
    return f;
  }, [profile, fromDate, toDate]);

  const { data: salesInvoices } = useFrappeGetDocList("Sales Invoice", {
    fields: ["name", "pos_profile", "grand_total", "posting_date", "net_total", "total_taxes_and_charges"],
    filters: salesInvFilters, limit: 0,
  });

  // Combine all invoices
  const allInvoices = useMemo(() => [...(posInvoices || []), ...(salesInvoices || [])], [posInvoices, salesInvoices]);

  // Overall stats
  const totalSales = useMemo(() => allInvoices.reduce((sum, inv) => sum + (inv.grand_total || 0), 0), [allInvoices]);
  const totalNet = useMemo(() => allInvoices.reduce((sum, inv) => sum + (inv.net_total || 0), 0), [allInvoices]);
  const totalTax = useMemo(() => allInvoices.reduce((sum, inv) => sum + (inv.total_taxes_and_charges || 0), 0), [allInvoices]);
  const invoiceCount = allInvoices.length;
  const avgOrder = invoiceCount > 0 ? totalSales / invoiceCount : 0;

  // Per-profile breakdown
  const profileBreakdown = useMemo(() => {
    const map: Record<string, { count: number; total: number; net: number; tax: number }> = {};
    allInvoices.forEach((inv) => {
      const p = inv.pos_profile || "Unknown";
      if (!map[p]) map[p] = { count: 0, total: 0, net: 0, tax: 0 };
      map[p].count++;
      map[p].total += inv.grand_total || 0;
      map[p].net += inv.net_total || 0;
      map[p].tax += inv.total_taxes_and_charges || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [allInvoices]);

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

  const fmtCurrency = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // PDF download
  const handleDownloadPDF = useCallback(() => {
    const el = reportRef.current;
    if (!el) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const profileName = profile === "__all__" ? "All Shops" : profile;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Sales Report - ${profileName}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #111; font-size: 13px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .stat { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
        .stat-value { font-size: 20px; font-weight: 600; }
        .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
        th { font-weight: 600; color: #666; text-transform: uppercase; font-size: 11px; background: #f9fafb; }
        td.num { text-align: right; } th.num { text-align: right; }
        .section { margin-top: 20px; }
        .section-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>Sales Report — ${profileName}</h1>
      <div class="subtitle">${fromDate} to ${toDate}</div>
      <div class="stats">
        <div class="stat"><div class="stat-value">${fmtCurrency(totalSales)}</div><div class="stat-label">Total Sales</div></div>
        <div class="stat"><div class="stat-value">${invoiceCount}</div><div class="stat-label">Orders</div></div>
        <div class="stat"><div class="stat-value">${fmtCurrency(avgOrder)}</div><div class="stat-label">Avg Order</div></div>
        <div class="stat"><div class="stat-value">${fmtCurrency(totalTax)}</div><div class="stat-label">Tax</div></div>
      </div>
      ${profileBreakdown.length > 1 ? `
        <div class="section">
          <div class="section-title">Sales by POS Profile</div>
          <table>
            <thead><tr><th>Profile</th><th class="num">Orders</th><th class="num">Net</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
            <tbody>${profileBreakdown.map(([name, d]) => `<tr><td>${name}</td><td class="num">${d.count}</td><td class="num">${fmtCurrency(d.net)}</td><td class="num">${fmtCurrency(d.tax)}</td><td class="num">${fmtCurrency(d.total)}</td></tr>`).join("")}</tbody>
          </table>
        </div>` : ""}
      <script>window.print();</script>
    </body></html>`);
    printWindow.document.close();
  }, [profile, fromDate, toDate, totalSales, invoiceCount, avgOrder, totalTax, profileBreakdown]);

  return (
    <div className="p-6" ref={reportRef}>
      {/* Header with date picker */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{profile === "__all__" ? "All Shops" : profile}</h1>
          {profile !== "__all__" && (
            <p className="text-sm text-gray-500">
              {(profileData as any)?.company}
              {branch && ` · ${branch}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Date range selector */}
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
          <button onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
            <Download className="h-3.5 w-3.5 text-gray-400" /> PDF
          </button>
        </div>
      </div>

      {/* Sales Stats */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xl font-semibold text-gray-900">{fmtCurrency(totalSales)}</p>
          <p className="mt-0.5 text-[12px] text-gray-500">Total Sales</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xl font-semibold text-gray-900">{invoiceCount}</p>
          <p className="mt-0.5 text-[12px] text-gray-500">Orders</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xl font-semibold text-gray-900">{fmtCurrency(avgOrder)}</p>
          <p className="mt-0.5 text-[12px] text-gray-500">Avg Order Value</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xl font-semibold text-gray-900">{fmtCurrency(totalTax)}</p>
          <p className="mt-0.5 text-[12px] text-gray-500">Tax Collected</p>
        </div>
      </div>

      {/* Per-profile breakdown — shown when "All Profiles" or multiple profiles have data */}
      {profileBreakdown.length > 0 && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-3">
            <h2 className="text-[13px] font-semibold text-gray-700">
              {profile === "__all__" ? "Sales by Shop" : "Sales Summary"}
            </h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">POS Profile</th>
                <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Orders</th>
                <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Net Sales</th>
                <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Tax</th>
                <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody>
              {profileBreakdown.map(([name, d], idx) => (
                <tr key={name} className={`border-b border-gray-100 ${idx % 2 ? "bg-gray-50/30" : ""}`}>
                  <td className="px-5 py-3 text-[13px] font-medium text-gray-900">{name}</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-600">{d.count}</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-600">{fmtCurrency(d.net)}</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-600">{fmtCurrency(d.tax)}</td>
                  <td className="px-5 py-3 text-right text-[13px] font-semibold text-gray-900">{fmtCurrency(d.total)}</td>
                </tr>
              ))}
              {profileBreakdown.length > 1 && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-5 py-3 text-[13px] text-gray-900">Total</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-900">{invoiceCount}</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-900">{fmtCurrency(totalNet)}</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-900">{fmtCurrency(totalTax)}</td>
                  <td className="px-5 py-3 text-right text-[13px] text-gray-900">{fmtCurrency(totalSales)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {invoiceCount === 0 && (
        <div className="mb-5 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No sales data for {presetLabels[datePreset].toLowerCase()}</p>
          <p className="mt-1 text-[12px] text-gray-400">Try selecting a different date range</p>
        </div>
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
    </div>
  );
}
