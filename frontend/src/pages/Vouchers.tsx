import { useState } from "react";
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { Plus, Trash2, Edit3, X, Ticket, ToggleLeft, ToggleRight, Search, Copy, Check } from "lucide-react";

export default function Vouchers() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState<number>(10);
  const [maxUses, setMaxUses] = useState<number>(1);
  const [expiresOn, setExpiresOn] = useState("");
  const [posProfile, setPosProfile] = useState("");
  const [description, setDescription] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const { data: posProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name"], limit: 50, orderBy: { field: "name", order: "asc" },
  });

  const filters: any[] = [];
  if (search) filters.push(["code", "like", `%${search}%`]);

  const { data: vouchers, mutate: refresh } = useFrappeGetDocList("ServePOS Voucher", {
    fields: ["name", "code", "is_active", "discount_percent", "max_uses", "times_used", "expires_on", "pos_profile", "description"],
    filters,
    limit: 200,
    orderBy: { field: "creation", order: "desc" },
  });

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  const activeCount = vouchers?.filter((v) => v.is_active).length || 0;

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setCode("");
    setDiscountPercent(10);
    setMaxUses(1);
    setExpiresOn("");
    setPosProfile("");
    setDescription("");
  }

  function startEdit(v: any) {
    setEditing(v.name);
    setCode(v.code || "");
    setDiscountPercent(v.discount_percent || 10);
    setMaxUses(v.max_uses || 1);
    setExpiresOn(v.expires_on || "");
    setPosProfile(v.pos_profile || "");
    setDescription(v.description || "");
    setShowForm(true);
  }

  async function handleSave() {
    if (!discountPercent || !expiresOn) return;
    try {
      if (editing) {
        await updateDoc("ServePOS Voucher", editing, {
          discount_percent: discountPercent,
          max_uses: maxUses,
          expires_on: expiresOn,
          pos_profile: posProfile || null,
          description: description || null,
        });
      } else {
        const doc: any = {
          discount_percent: discountPercent,
          max_uses: maxUses,
          expires_on: expiresOn,
          pos_profile: posProfile || null,
          description: description || null,
        };
        if (code.trim()) doc.code = code.trim();
        await createDoc("ServePOS Voucher", doc);
      }
      resetForm();
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to save");
    }
  }

  async function toggleActive(v: any) {
    try {
      await updateDoc("ServePOS Voucher", v.name, { is_active: v.is_active ? 0 : 1 });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function handleDelete(name: string) {
    if (!confirm("Delete this voucher?")) return;
    try {
      await deleteDoc("ServePOS Voucher", name);
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to delete");
    }
  }

  function copyCode(c: string) {
    navigator.clipboard.writeText(c);
    setCopiedCode(c);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  const isExpired = (d: string) => d && new Date(d) < new Date(new Date().toISOString().split("T")[0]);
  const isExhausted = (v: any) => v.max_uses > 0 && v.times_used >= v.max_uses;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Vouchers</h1>
          <p className="text-sm text-gray-500">
            {vouchers?.length || 0} total · {activeCount} active
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800"
        >
          <Plus className="h-3.5 w-3.5" /> Create Voucher
        </button>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code..."
            className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
      </div>

      {/* Create/edit form */}
      {showForm && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-gray-700">
              {editing ? "Edit Voucher" : "New Voucher"}
            </span>
            <button onClick={resetForm} className="rounded p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {!editing && (
              <div>
                <label className="mb-1 block text-[12px] font-medium text-gray-500">Code (auto if blank)</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] font-mono tracking-widest text-center focus:border-gray-400 focus:outline-none"
                  placeholder="Auto-generated"
                  maxLength={6}
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Discount %</label>
              <input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                min={1}
                max={100}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Max Uses (0=unlimited)</label>
              <input
                type="number"
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
                min={0}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Expires On</label>
              <input
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">POS Profile (empty=all)</label>
              <select
                value={posProfile}
                onChange={(e) => setPosProfile(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
              >
                <option value="">All Profiles</option>
                {posProfiles?.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
                placeholder="e.g., Summer promo"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={resetForm} className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!discountPercent || !expiresOn}
              className="rounded-md bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Voucher list */}
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-gray-500">Code</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold uppercase text-gray-500">Active</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase text-gray-500">Discount</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase text-gray-500">Usage</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-gray-500">Expires</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-gray-500">Profile</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-gray-500">Description</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {!vouchers?.length && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-400">
                  <Ticket className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  No vouchers yet
                </td>
              </tr>
            )}
            {vouchers?.map((v, idx) => {
              const expired = isExpired(v.expires_on);
              const exhausted = isExhausted(v);
              const inactive = !v.is_active || expired || exhausted;
              return (
                <tr key={v.name} className={`${idx > 0 ? "border-t" : ""} hover:bg-gray-50/60`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm font-bold tracking-widest ${inactive ? "text-gray-400" : "text-gray-900"}`}>
                        {v.code}
                      </span>
                      <button
                        onClick={() => copyCode(v.code)}
                        className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                        title="Copy code"
                      >
                        {copiedCode === v.code ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(v)} title={v.is_active ? "Active" : "Inactive"}>
                      {v.is_active
                        ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                        : <ToggleLeft className="h-5 w-5 text-gray-300" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                      {v.discount_percent}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-medium ${exhausted ? "text-red-500" : "text-gray-600"}`}>
                      {v.times_used}
                    </span>
                    <span className="text-gray-400">/{v.max_uses || "\u221e"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[12px] ${expired ? "font-medium text-red-500" : "text-gray-600"}`}>
                      {v.expires_on}
                    </span>
                    {expired && <span className="ml-1 text-[10px] text-red-400">expired</span>}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-gray-600">{v.pos_profile || "All"}</td>
                  <td className="px-4 py-3 text-[12px] text-gray-500 max-w-[150px] truncate">{v.description || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(v)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(v.name)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
