import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Search, X, AlertTriangle, Download } from "lucide-react";

export default function StockOverview() {
  const { profile, profiles } = useProfile();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const selectedProfile = profiles.find((p) => p.name === profile);
  const warehouse = selectedProfile?.warehouse;

  const { data: settingsData } = useFrappeGetCall("servepos.api.store.get_store_settings");
  const settings = settingsData?.message;

  const { data: groupsData } = useFrappeGetCall("servepos.api.store.get_item_groups");
  const groups: string[] = groupsData?.message || [];

  const { data: stockData, isLoading } = useFrappeGetCall(
    "servepos.api.store.get_branch_stock",
    warehouse ? { warehouse, search: search || undefined, item_group: activeGroup || undefined } : undefined,
    warehouse ? undefined : null
  );
  const items: any[] = stockData?.message || [];

  function exportToCSV() {
    if (!items.length) return;
    const headers = ["Item Code", "Item Name", "Group", "Branch Stock", "Central Stock", "UOM", "Reorder Level"];
    const rows = items.map((i) => [i.item_code, i.item_name, i.item_group, i.branch_stock, i.central_stock, i.stock_uom, i.reorder_level]);
    const csv = [headers, ...rows].map((r) => r.map((c: any) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-${warehouse}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!warehouse) {
    return <div className="py-12 text-center text-sm text-gray-400">Select a branch to view stock</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Stock Overview</h1>
          <p className="text-sm text-gray-500">{warehouse} — {items.length} items</p>
        </div>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50 no-print"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Search */}
      <div className="mb-3 no-print">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full rounded-md border border-gray-200 bg-white py-2.5 pl-9 pr-8 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Group filters */}
      {groups.length > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 no-print">
          <button
            onClick={() => setActiveGroup(null)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium ${!activeGroup ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium ${activeGroup === g ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Item</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Group</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Branch Stock</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Central Stock</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">UOM</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const isLow = settings?.enable_low_stock_alerts && item.branch_stock <= item.reorder_level && item.branch_stock > 0;
                const isOut = item.branch_stock <= 0;
                return (
                  <tr key={item.item_code} className={`border-b border-gray-100 ${idx % 2 ? "bg-gray-50/30" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {(isLow || isOut) && (
                          <AlertTriangle className={`h-3.5 w-3.5 flex-shrink-0 ${isOut ? "text-red-500" : "text-amber-500"}`} />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-gray-900">{item.item_name}</p>
                          <p className="truncate text-[11px] text-gray-400">{item.item_code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-gray-500">{item.item_group}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-[13px] font-semibold ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-gray-900"}`}>
                        {item.branch_stock}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] text-gray-600">{item.central_stock}</td>
                    <td className="px-4 py-3 text-[12px] text-gray-500">{item.stock_uom}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading stock data...</div>}
        {!isLoading && items.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No items found</div>
        )}
      </div>
    </div>
  );
}
