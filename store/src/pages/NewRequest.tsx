import { useState, useCallback } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { useNavigate } from "react-router-dom";
import { Search, X, Plus, Minus, Trash2, Send } from "lucide-react";

interface RequestItem {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  qty: number;
  branch_stock: number;
  central_stock: number;
  notes: string;
}

export default function NewRequest() {
  const { profile, profiles } = useProfile();
  const navigate = useNavigate();
  const selectedProfile = profiles.find((p) => p.name === profile);
  const warehouse = selectedProfile?.warehouse;
  const branch = selectedProfile?.branch;

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<RequestItem[]>([]);
  const [requiredBy, setRequiredBy] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: searchResults } = useFrappeGetCall(
    "servepos.api.store.search_items",
    search.length >= 2 ? { search, warehouse } : undefined,
    search.length >= 2 ? undefined : null
  );
  const results: any[] = searchResults?.message || [];

  const addItem = useCallback((item: any) => {
    if (items.find((i) => i.item_code === item.item_code)) return;
    setItems((prev) => [...prev, {
      item_code: item.item_code,
      item_name: item.item_name,
      item_group: item.item_group,
      stock_uom: item.stock_uom,
      qty: 1,
      branch_stock: item.branch_stock || 0,
      central_stock: item.central_stock || 0,
      notes: "",
    }]);
    setSearch("");
  }, [items]);

  const updateQty = (code: string, delta: number) => {
    setItems((prev) => prev.map((i) => i.item_code === code ? { ...i, qty: Math.max(0.5, i.qty + delta) } : i));
  };

  const removeItem = (code: string) => {
    setItems((prev) => prev.filter((i) => i.item_code !== code));
  };

  const { call } = useFrappePostCall("servepos.api.store.create_branch_request");

  async function handleSubmit() {
    if (!items.length || !branch || !warehouse) return;
    setSubmitting(true);
    try {
      const res = await call({
        branch,
        warehouse,
        required_by: requiredBy,
        notes,
        items: JSON.stringify(items.map((i) => ({
          item_code: i.item_code,
          qty: i.qty,
          uom: i.stock_uom,
          notes: i.notes,
        }))),
      });
      navigate("/requests");
    } catch (err: any) {
      alert(err.message || "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  }

  if (!warehouse || !branch) {
    return <div className="py-12 text-center text-sm text-gray-400">Select a branch to create a request</div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">New Request</h1>
        <p className="text-sm text-gray-500">{branch} — {warehouse}</p>
      </div>

      {/* Required By */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-gray-700">Required By</label>
          <input
            type="date"
            value={requiredBy}
            onChange={(e) => setRequiredBy(e.target.value)}
            className="rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items to add..."
          className="w-full rounded-md border border-gray-200 bg-white py-2.5 pl-9 pr-8 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          autoFocus
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Search dropdown */}
        {search.length >= 2 && results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {results.map((item) => {
              const alreadyAdded = items.some((i) => i.item_code === item.item_code);
              return (
                <button
                  key={item.item_code}
                  onClick={() => addItem(item)}
                  disabled={alreadyAdded}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 ${alreadyAdded ? "opacity-40" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-gray-900">{item.item_name}</p>
                    <p className="text-[11px] text-gray-400">{item.item_group} · {item.stock_uom}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[11px] text-gray-400">Branch: {item.branch_stock}</p>
                    <p className="text-[11px] text-gray-400">Central: {item.central_stock}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Items table */}
      {items.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Item</th>
                <th className="px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Qty</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">UOM</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Stock</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.item_code} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <p className="text-[13px] font-medium text-gray-900">{item.item_name}</p>
                    <p className="text-[11px] text-gray-400">{item.item_group}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => updateQty(item.item_code, -1)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setItems((prev) => prev.map((i) => i.item_code === item.item_code ? { ...i, qty: val } : i));
                        }}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-center text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none"
                        min={0.5}
                        step={0.5}
                      />
                      <button onClick={() => updateQty(item.item_code, 1)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-gray-500">{item.stock_uom}</td>
                  <td className="px-4 py-3 text-right">
                    <p className="text-[11px] text-gray-400">Branch: {item.branch_stock}</p>
                    <p className="text-[11px] text-gray-400">Central: {item.central_stock}</p>
                  </td>
                  <td className="px-2 py-3">
                    <button onClick={() => removeItem(item.item_code)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      <div className="mb-4">
        <label className="mb-1 block text-[12px] font-semibold text-gray-700">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none"
          placeholder="Any additional notes for the request..."
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!items.length || submitting}
        className="flex items-center gap-2 rounded-md bg-gray-900 px-6 py-2.5 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-40"
      >
        <Send className="h-3.5 w-3.5" />
        {submitting ? "Submitting..." : `Submit Request (${items.length} items)`}
      </button>
    </div>
  );
}
