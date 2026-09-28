import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { Layers, Printer, Download, ChevronRight, CheckCircle, ShoppingCart, Truck, Loader2 } from "lucide-react";

export default function ConsolidatedView() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"consolidated" | "by-request">("consolidated");

  // Consolidated items view
  const { data: consolidatedData, isLoading: loadingConsolidated, mutate: refreshConsolidated } = useFrappeGetCall("servepos.api.store.get_consolidated_items");
  const consolidatedItems: any[] = consolidatedData?.message || [];

  // By-request view
  const { data: requestsData, isLoading: loadingRequests, mutate: refreshRequests } = useFrappeGetCall("servepos.api.store.get_all_pending_requests");
  const requests: any[] = requestsData?.message || [];

  const [selected, setSelected] = useState<Record<string, "transfer" | "purchase">>({});
  const [processing, setProcessing] = useState(false);

  const { call: processCall } = useFrappePostCall("servepos.api.store.process_request_items");

  function toggleAction(key: string, action: "transfer" | "purchase") {
    setSelected((prev) => {
      if (prev[key] === action) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: action };
    });
  }

  async function handleProcessAll() {
    const actions: any[] = [];
    for (const item of consolidatedItems) {
      for (const bd of item.branch_breakdown || []) {
        const key = bd.item_row;
        const action = selected[key];
        if (action) {
          actions.push({ item_row: bd.item_row, request: bd.request, action, qty: bd.qty });
        }
      }
    }

    if (!actions.length) {
      alert("Select at least one item to process");
      return;
    }

    setProcessing(true);
    try {
      const res = await processCall({ actions: JSON.stringify(actions) });
      const result = res.message || res;
      const seCount = result.stock_entries?.length || 0;
      const mrCount = result.material_requests?.length || 0;
      alert(`Done! Created ${seCount} Stock Entry(s) and ${mrCount} Material Request(s).`);
      setSelected({});
      refreshConsolidated();
      refreshRequests();
    } catch (err: any) {
      alert(err.message || "Failed to process");
    } finally {
      setProcessing(false);
    }
  }

  function smartSelectAll() {
    const newSelected: Record<string, "transfer" | "purchase"> = {};
    for (const item of consolidatedItems) {
      let remaining = item.central_stock;
      for (const bd of item.branch_breakdown || []) {
        if (remaining >= bd.qty) {
          newSelected[bd.item_row] = "transfer";
          remaining -= bd.qty;
        } else {
          newSelected[bd.item_row] = "purchase";
        }
      }
    }
    setSelected(newSelected);
  }

  function exportToCSV() {
    const rows = [["Item Code", "Item Name", "Group", "Branch", "Qty", "UOM", "Central Stock", "Action"]];
    for (const item of consolidatedItems) {
      for (const bd of item.branch_breakdown || []) {
        rows.push([
          item.item_code, item.item_name, item.item_group, bd.branch,
          String(bd.qty), item.uom, String(item.central_stock),
          selected[bd.item_row] || "Pending",
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consolidated-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedCount = Object.keys(selected).length;
  const isLoading = loadingConsolidated || loadingRequests;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">All Requests</h1>
          <p className="text-sm text-gray-500">
            {viewMode === "consolidated"
              ? `${consolidatedItems.length} items from ${requests.length} requests`
              : `${requests.length} pending requests`}
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button onClick={exportToCSV} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {/* View toggle */}
      <div className="mb-4 flex gap-1.5 no-print">
        <button
          onClick={() => setViewMode("consolidated")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ${viewMode === "consolidated" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
        >
          Consolidated
        </button>
        <button
          onClick={() => setViewMode("by-request")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ${viewMode === "by-request" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
        >
          By Request
        </button>
      </div>

      {viewMode === "consolidated" ? (
        <>
          {/* Smart select + process bar */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-gray-200 bg-white p-3 no-print">
            <div className="flex gap-2">
              <button onClick={smartSelectAll} className="rounded-md bg-gray-100 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-200">
                Smart Select All
              </button>
              {selectedCount > 0 && (
                <button onClick={() => setSelected({})} className="rounded-md px-3 py-1.5 text-[12px] text-gray-400 hover:bg-gray-100">
                  Clear
                </button>
              )}
            </div>
            <button
              onClick={handleProcessAll}
              disabled={!selectedCount || processing}
              className="flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              {processing ? "Processing..." : `Process ${selectedCount} items`}
            </button>
          </div>

          {/* Consolidated table */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Item</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Total Qty</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Central Stock</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Branches</th>
                    <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 no-print">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidatedItems.map((item) => {
                    const canFulfill = item.central_stock >= (item.total_qty - item.total_fulfilled);
                    return (
                      <tr key={item.item_code} className="border-b border-gray-100">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-medium text-gray-900">{item.item_name}</p>
                          <p className="text-[11px] text-gray-400">{item.item_group} · {item.uom}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-900">
                          {item.total_qty - item.total_fulfilled}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-[13px] font-semibold ${canFulfill ? "text-green-600" : item.central_stock > 0 ? "text-amber-600" : "text-red-600"}`}>
                            {item.central_stock}
                          </span>
                        </td>
                        <td className="px-4 py-3" colSpan={1}>
                          <div className="space-y-1">
                            {(item.branch_breakdown || []).map((bd: any) => (
                              <div key={bd.item_row} className="flex items-center gap-2 text-[12px]">
                                <span className="text-gray-600">{bd.branch}</span>
                                <span className="font-medium text-gray-900">{bd.qty}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 no-print">
                          <div className="space-y-1">
                            {(item.branch_breakdown || []).map((bd: any) => (
                              <div key={bd.item_row} className="flex gap-1 justify-center">
                                <button
                                  onClick={() => toggleAction(bd.item_row, "transfer")}
                                  className={`rounded px-2 py-1 text-[10px] font-medium ${selected[bd.item_row] === "transfer" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500 hover:bg-green-50"}`}
                                  title="Transfer from central"
                                >
                                  <Truck className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => toggleAction(bd.item_row, "purchase")}
                                  className={`rounded px-2 py-1 text-[10px] font-medium ${selected[bd.item_row] === "purchase" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500 hover:bg-purple-50"}`}
                                  title="Create purchase request"
                                >
                                  <ShoppingCart className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading...</div>}
            {!isLoading && consolidatedItems.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">No pending items</div>
            )}
          </div>
        </>
      ) : (
        /* By-request view */
        <div className="space-y-2">
          {requests.map((req) => (
            <button
              key={req.name}
              onClick={() => navigate(`/requests/${req.name}`)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-gray-300"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-gray-900">{req.name}</p>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">{req.status}</span>
                </div>
                <p className="text-[12px] text-gray-500">
                  {req.branch} · {req.item_count} items ({req.pending_count} pending) · Required by {req.required_by}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
            </button>
          ))}
          {!loadingRequests && requests.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">No pending requests</div>
          )}
        </div>
      )}
    </div>
  );
}
