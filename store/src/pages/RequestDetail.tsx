import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, CheckCircle, Clock, ShoppingCart, Truck } from "lucide-react";

const itemStatusColors: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-700",
  "To Transfer": "bg-blue-50 text-blue-700",
  "To Purchase": "bg-purple-50 text-purple-700",
  Transferred: "bg-green-50 text-green-700",
  Ordered: "bg-indigo-50 text-indigo-700",
  Fulfilled: "bg-green-50 text-green-700",
};

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, mutate } = useFrappeGetCall(
    "servepos.api.store.get_request_detail",
    id ? { name: id } : undefined,
    id ? undefined : null
  );
  const req = data?.message;

  const { call: cancelCall } = useFrappePostCall("servepos.api.store.cancel_request");

  async function handleCancel() {
    if (!confirm("Cancel this request?")) return;
    try {
      await cancelCall({ name: id });
      mutate();
    } catch (err: any) {
      alert(err.message || "Failed to cancel");
    }
  }

  if (!req) return <div className="py-12 text-center text-sm text-gray-400">Loading...</div>;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{req.name}</h1>
            <p className="text-sm text-gray-500">{req.branch} · Required by {req.required_by}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          {req.status === "Pending" && req.docstatus === 1 && (
            <button onClick={handleCancel} className="rounded-md border border-red-200 px-3 py-2 text-[12px] font-medium text-red-600 hover:bg-red-50">
              Cancel Request
            </button>
          )}
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print-only mb-4">
        <h1 className="text-lg font-bold">{req.name} — Branch Request</h1>
        <p>{req.branch} · {req.warehouse} · Required by {req.required_by}</p>
      </div>

      {/* Status card */}
      <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <p className="text-[11px] font-medium text-gray-400">Status</p>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            req.status === "Fulfilled" ? "bg-green-50 text-green-700" :
            req.status === "Cancelled" ? "bg-red-50 text-red-500" :
            "bg-amber-50 text-amber-700"
          }`}>{req.status}</span>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-400">Requested</p>
          <p className="text-[13px] text-gray-900">{req.request_date}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-400">Warehouse</p>
          <p className="text-[13px] text-gray-900">{req.warehouse}</p>
        </div>
        {req.processed_by && (
          <div>
            <p className="text-[11px] font-medium text-gray-400">Processed By</p>
            <p className="text-[13px] text-gray-900">{req.processed_by}</p>
          </div>
        )}
      </div>

      {req.notes && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-400 mb-1">Notes</p>
          <p className="text-[13px] text-gray-700">{req.notes}</p>
        </div>
      )}

      {/* Items */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Item</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Qty</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">UOM</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Branch</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Central</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {req.items.map((item: any) => (
              <tr key={item.name} className="border-b border-gray-100">
                <td className="px-4 py-3">
                  <p className="text-[13px] font-medium text-gray-900">{item.item_name}</p>
                  <p className="text-[11px] text-gray-400">{item.item_group}</p>
                </td>
                <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-900">{item.qty}</td>
                <td className="px-4 py-3 text-[12px] text-gray-500">{item.uom}</td>
                <td className="px-4 py-3 text-right text-[12px] text-gray-500">{item.current_stock}</td>
                <td className="px-4 py-3 text-right text-[12px] text-gray-500">{item.central_stock}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${itemStatusColors[item.status] || "bg-gray-100 text-gray-600"}`}>
                    {item.status}
                  </span>
                  {item.reference_name && (
                    <p className="mt-0.5 text-[10px] text-gray-400">{item.reference_type}: {item.reference_name}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
