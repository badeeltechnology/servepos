import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Truck, ShoppingCart, CheckCircle, Loader2, Printer } from "lucide-react";

export default function ProcessRequest() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, mutate } = useFrappeGetCall(
    "servepos.api.store.get_request_detail",
    id ? { name: id } : undefined,
    id ? undefined : null
  );
  const req = data?.message;

  const [actions, setActions] = useState<Record<string, "transfer" | "purchase">>({});
  const [processing, setProcessing] = useState(false);

  const { call: processCall } = useFrappePostCall("servepos.api.store.process_request_items");

  function setAction(itemRow: string, action: "transfer" | "purchase") {
    setActions((prev) => {
      if (prev[itemRow] === action) {
        const next = { ...prev };
        delete next[itemRow];
        return next;
      }
      return { ...prev, [itemRow]: action };
    });
  }

  function autoSelect() {
    if (!req) return;
    const newActions: Record<string, "transfer" | "purchase"> = {};
    for (const item of req.items) {
      if (item.status !== "Pending") continue;
      if (item.central_stock >= item.qty) {
        newActions[item.name] = "transfer";
      } else {
        newActions[item.name] = "purchase";
      }
    }
    setActions(newActions);
  }

  async function handleProcess() {
    const actionList = Object.entries(actions).map(([item_row, action]) => ({
      item_row,
      request: id,
      action,
    }));

    if (!actionList.length) {
      alert("Select at least one action");
      return;
    }

    setProcessing(true);
    try {
      const res = await processCall({ actions: JSON.stringify(actionList) });
      const result = res.message || res;
      alert(`Created ${result.stock_entries?.length || 0} Stock Entry(s) and ${result.material_requests?.length || 0} Material Request(s).`);
      setActions({});
      mutate();
    } catch (err: any) {
      alert(err.message || "Failed to process");
    } finally {
      setProcessing(false);
    }
  }

  if (!req) return <div className="py-12 text-center text-sm text-gray-400">Loading...</div>;

  const pendingItems = req.items.filter((i: any) => i.status === "Pending");
  const processedItems = req.items.filter((i: any) => i.status !== "Pending");
  const selectedCount = Object.keys(actions).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/manage")} className="rounded p-1.5 text-gray-400 hover:bg-gray-100">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Process: {req.name}</h1>
            <p className="text-sm text-gray-500">{req.branch} · Required by {req.required_by}</p>
          </div>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
          <Printer className="h-3.5 w-3.5" /> Print
        </button>
      </div>

      {/* Action bar */}
      {pendingItems.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 no-print">
          <button onClick={autoSelect} className="rounded-md bg-gray-100 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-200">
            Auto-Select (Transfer if available)
          </button>
          <button
            onClick={handleProcess}
            disabled={!selectedCount || processing}
            className="flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            {processing ? "Processing..." : `Process ${selectedCount} items`}
          </button>
        </div>
      )}

      {/* Pending items */}
      {pendingItems.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
            <p className="text-[12px] font-semibold text-gray-600">Pending Items ({pendingItems.length})</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Item</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Qty</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Central</th>
                <th className="px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 no-print">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingItems.map((item: any) => (
                <tr key={item.name} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <p className="text-[13px] font-medium text-gray-900">{item.item_name}</p>
                    <p className="text-[11px] text-gray-400">{item.item_group}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-900">{item.qty} {item.uom}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[13px] font-semibold ${item.central_stock >= item.qty ? "text-green-600" : item.central_stock > 0 ? "text-amber-600" : "text-red-600"}`}>
                      {item.central_stock}
                    </span>
                  </td>
                  <td className="px-4 py-3 no-print">
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => setAction(item.name, "transfer")}
                        className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-medium ${actions[item.name] === "transfer" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500 hover:bg-green-50"}`}
                      >
                        <Truck className="h-3 w-3" /> Transfer
                      </button>
                      <button
                        onClick={() => setAction(item.name, "purchase")}
                        className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-medium ${actions[item.name] === "purchase" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500 hover:bg-purple-50"}`}
                      >
                        <ShoppingCart className="h-3 w-3" /> Purchase
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Already processed items */}
      {processedItems.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
            <p className="text-[12px] font-semibold text-gray-600">Processed Items ({processedItems.length})</p>
          </div>
          <table className="w-full">
            <tbody>
              {processedItems.map((item: any) => (
                <tr key={item.name} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <p className="text-[13px] font-medium text-gray-900">{item.item_name}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] text-gray-600">{item.qty} {item.uom}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.status === "Transferred" || item.status === "Fulfilled" ? "bg-green-50 text-green-700" :
                      item.status === "To Transfer" ? "bg-blue-50 text-blue-700" :
                      "bg-purple-50 text-purple-700"
                    }`}>{item.status}</span>
                    {item.reference_name && (
                      <span className="ml-2 text-[10px] text-gray-400">{item.reference_name}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
