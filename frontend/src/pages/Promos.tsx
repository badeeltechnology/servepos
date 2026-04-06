import { useState, useMemo } from "react";
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Plus, Trash2, Edit3, X, Tag, ToggleLeft, ToggleRight } from "lucide-react";

export default function Promos() {
  const { profile } = useProfile();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [promoName, setPromoName] = useState("");
  const [discountType, setDiscountType] = useState("Percentage");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [posProfile, setPosProfile] = useState("");

  // Fetch all POS profiles for the dropdown
  const { data: posProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name"], limit: 50,
  });

  // Fetch promos — filter by selected profile (show profile-specific + global ones)
  const promoFilters = useMemo(() => {
    if (profile && profile !== "__all__") {
      return [["pos_profile", "in", [profile, "", null]]] as any;
    }
    return [] as any;
  }, [profile]);

  const { data: promos, mutate: refresh } = useFrappeGetDocList("ServePOS Promo", {
    fields: ["name", "promo_name", "discount_type", "discount_value", "enabled", "description", "pos_profile"],
    filters: promoFilters,
    limit: 100,
    orderBy: { field: "promo_name", order: "asc" },
  });

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  const enabledCount = promos?.filter((p) => p.enabled).length || 0;
  const totalCount = promos?.length || 0;

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setPromoName("");
    setDiscountType("Percentage");
    setDiscountValue(0);
    setDescription("");
    setPosProfile(profile && profile !== "__all__" ? profile : "");
  }

  function startEdit(promo: any) {
    setEditing(promo.name);
    setPromoName(promo.promo_name);
    setDiscountType(promo.discount_type);
    setDiscountValue(promo.discount_value);
    setDescription(promo.description || "");
    setPosProfile(promo.pos_profile || "");
    setShowForm(true);
  }

  async function handleSave() {
    if (!promoName.trim() || !discountValue) return;
    try {
      if (editing) {
        await updateDoc("ServePOS Promo", editing, {
          promo_name: promoName,
          discount_type: discountType,
          discount_value: discountValue,
          description,
          pos_profile: posProfile || "",
        });
      } else {
        await createDoc("ServePOS Promo", {
          promo_name: promoName,
          discount_type: discountType,
          discount_value: discountValue,
          enabled: 1,
          description,
          pos_profile: posProfile || "",
        });
      }
      resetForm();
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to save");
    }
  }

  async function toggleEnabled(name: string, current: number) {
    try {
      await updateDoc("ServePOS Promo", name, { enabled: current ? 0 : 1 });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function handleDelete(name: string) {
    if (!confirm("Delete this promo?")) return;
    try {
      await deleteDoc("ServePOS Promo", name);
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to delete");
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Promos</h1>
          <p className="text-sm text-gray-500">
            <span className="text-green-600 font-medium">{enabledCount} active</span>
            {" · "}
            {totalCount} total
            {profile && profile !== "__all__" && (
              <span className="text-gray-400"> · {profile}</span>
            )}
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add promo
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-gray-700">
              {editing ? "Edit promo" : "New promo"}
            </span>
            <button onClick={resetForm} className="rounded p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Promo Name</label>
              <input
                type="text"
                value={promoName}
                onChange={(e) => setPromoName(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
                placeholder="e.g., Neema Staff"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Discount Type</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
              >
                <option value="Percentage">Percentage (%)</option>
                <option value="Amount">Fixed Amount</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">
                {discountType === "Percentage" ? "Discount %" : "Amount"}
              </label>
              <input
                type="number"
                value={discountValue || ""}
                onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-right focus:border-gray-400 focus:outline-none"
                placeholder="0"
                min={0}
                max={discountType === "Percentage" ? 100 : undefined}
                step={discountType === "Percentage" ? 1 : 0.5}
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">POS Profile</label>
              <select
                value={posProfile}
                onChange={(e) => setPosProfile(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
              >
                <option value="">All Profiles</option>
                {(posProfiles || []).map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
                placeholder="e.g., 20% discount for Neema staff members"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={resetForm} className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={handleSave} className="rounded-md bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">
              {editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {(!promos || promos.length === 0) && !showForm && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center">
          <Tag className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No promos yet</p>
          <p className="mt-1 text-[12px] text-gray-400">Create promos like "Neema 20%", "Staff Discount"</p>
        </div>
      )}

      {/* Promos list */}
      {promos && promos.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Promo</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Discount</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">POS Profile</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Description</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => (
                <tr key={promo.name} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="text-[13px] font-semibold text-gray-900">{promo.promo_name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-700">
                      {promo.discount_type === "Percentage"
                        ? `${promo.discount_value}%`
                        : `${promo.discount_value.toFixed(2)}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[12px] ${promo.pos_profile ? "text-gray-700 font-medium" : "text-gray-400"}`}>
                      {promo.pos_profile || "All"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] text-gray-500">{promo.description || "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleEnabled(promo.name, promo.enabled)} title={promo.enabled ? "Disable" : "Enable"}>
                      {promo.enabled ? (
                        <ToggleRight className="mx-auto h-5 w-5 text-emerald-500" />
                      ) : (
                        <ToggleLeft className="mx-auto h-5 w-5 text-gray-300" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(promo)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(promo.name)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
