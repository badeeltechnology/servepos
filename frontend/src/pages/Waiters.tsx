import { useState, useMemo } from "react";
import {
  useFrappeGetDocList,
  useFrappeCreateDoc,
  useFrappeUpdateDoc,
  useFrappeDeleteDoc,
} from "frappe-react-sdk";
import {
  Plus,
  Trash2,
  Edit3,
  X,
  Eye,
  EyeOff,
  Search,
  Users,
} from "lucide-react";

/**
 * Waiters
 * -------
 * CRUD + per-POS-Profile visibility matrix for ServePOS Waiter records.
 * Uses the same `servepos_visible_profiles` comma-separated whitelist
 * pattern as ItemVisibility. The backend registry API is untouched.
 *
 * Writes always go through updateDoc on the ServePOS Waiter doctype.
 * servepos.api.registry.get_waiters already reads this field so the
 * Desktop POS and Waiter App automatically respect the new values.
 */
export default function Waiters() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [waiterName, setWaiterName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");

  // All POS Profiles — columns of the matrix.
  const { data: allProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "branch"],
    limit: 100,
    orderBy: { field: "name", order: "asc" },
  });
  const profileNames = useMemo(
    () => (allProfiles || []).map((p) => p.name),
    [allProfiles],
  );

  const filters: any[] = [];
  if (search) filters.push(["waiter_name", "like", `%${search}%`]);

  const { data: waiters, mutate: refresh } = useFrappeGetDocList(
    "ServePOS Waiter",
    {
      fields: [
        "name",
        "waiter_name",
        "phone",
        "is_active",
        "branch",
        "servepos_visible_profiles",
      ],
      filters,
      limit: 500,
      orderBy: { field: "waiter_name", order: "asc" },
    },
  );

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  // --- Helpers ---------------------------------------------------------

  function parseList(raw: string | undefined | null): string[] {
    if (!raw) return [];
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isVisibleOn(waiter: any, profileName: string): boolean {
    if (waiter.is_active === 0) return false;
    // Hard gate: if the waiter has a branch set, it must match the
    // profile's branch.
    const profileDoc = (allProfiles || []).find((p) => p.name === profileName);
    if (waiter.branch && profileDoc?.branch && waiter.branch !== profileDoc.branch) {
      return false;
    }
    const list = parseList(waiter.servepos_visible_profiles);
    if (list.length === 0) return true;
    return list.includes(profileName);
  }

  function nextWhitelist(
    currentRaw: string | undefined | null,
    profileName: string,
    action: "show" | "hide",
  ): string {
    let list = parseList(currentRaw);
    if (list.length === 0) list = [...profileNames];
    if (action === "hide") {
      list = list.filter((n) => n !== profileName);
    } else if (!list.includes(profileName)) {
      list.push(profileName);
    }
    const ordered = profileNames.filter((n) => list.includes(n));
    return ordered.join(",");
  }

  async function toggleCell(waiter: any, profileName: string) {
    if (waiter.is_active === 0) return;
    // Branch gate: can't toggle on a profile whose branch doesn't match.
    const profileDoc = (allProfiles || []).find((p) => p.name === profileName);
    if (waiter.branch && profileDoc?.branch && waiter.branch !== profileDoc.branch) {
      alert(
        `${waiter.waiter_name} is locked to branch "${waiter.branch}" and cannot be assigned to ${profileName} (${profileDoc.branch}). Clear the waiter's branch first.`,
      );
      return;
    }
    const currentlyVisible = isVisibleOn(waiter, profileName);
    const next = nextWhitelist(
      waiter.servepos_visible_profiles,
      profileName,
      currentlyVisible ? "hide" : "show",
    );
    try {
      await updateDoc("ServePOS Waiter", waiter.name, {
        servepos_visible_profiles: next,
      });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function toggleActive(waiter: any) {
    try {
      await updateDoc("ServePOS Waiter", waiter.name, {
        is_active: waiter.is_active === 0 ? 1 : 0,
      });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setWaiterName("");
    setPhone("");
    setPin("");
  }

  function startEdit(waiter: any) {
    setEditing(waiter.name);
    setWaiterName(waiter.waiter_name || "");
    setPhone(waiter.phone || "");
    setPin("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!waiterName.trim()) return;
    try {
      if (editing) {
        const update: any = { waiter_name: waiterName.trim(), phone: phone || null };
        if (pin) update.pin = pin;
        await updateDoc("ServePOS Waiter", editing, update);
      } else {
        if (!pin) {
          alert("PIN is required for new waiters");
          return;
        }
        await createDoc("ServePOS Waiter", {
          waiter_name: waiterName.trim(),
          phone: phone || null,
          pin,
          is_active: 1,
        });
      }
      resetForm();
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to save");
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete this waiter?`)) return;
    try {
      await deleteDoc("ServePOS Waiter", name);
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to delete");
    }
  }

  // --- Render ----------------------------------------------------------

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Waiters</h1>
          <p className="text-sm text-gray-500">
            {waiters?.length || 0} total · Toggle each waiter on or off per POS Profile.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add waiter
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search waiters..."
            className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {/* Create/edit form */}
      {showForm && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-gray-700">
              {editing ? "Edit waiter" : "New waiter"}
            </span>
            <button onClick={resetForm} className="rounded p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Name</label>
              <input
                type="text"
                value={waiterName}
                onChange={(e) => setWaiterName(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
                placeholder="e.g., Ahmed"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
                placeholder="+974..."
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">
                PIN {editing && <span className="text-gray-400">(leave blank to keep)</span>}
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none"
                placeholder="4-digit PIN"
                maxLength={6}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={resetForm}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded-md bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800"
            >
              {editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-max border-collapse">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="sticky left-0 z-10 min-w-[260px] bg-gray-50 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Waiter
              </th>
              <th className="min-w-[90px] px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Active
              </th>
              {(allProfiles || []).map((p) => (
                <th
                  key={p.name}
                  className="min-w-[120px] px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500"
                >
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-gray-700 normal-case text-[12px]">{p.name}</span>
                    {p.branch && (
                      <span className="text-[9px] font-normal text-gray-400">{p.branch}</span>
                    )}
                  </div>
                </th>
              ))}
              <th className="min-w-[80px] px-3 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {waiters?.length === 0 && (
              <tr>
                <td
                  colSpan={3 + (allProfiles?.length || 0)}
                  className="py-12 text-center text-gray-400"
                >
                  <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  No waiters yet
                </td>
              </tr>
            )}
            {waiters?.map((waiter, idx) => {
              const inactive = waiter.is_active === 0;
              return (
                <tr
                  key={waiter.name}
                  className={idx > 0 ? "border-t hover:bg-gray-50/60" : "hover:bg-gray-50/60"}
                >
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${
                          inactive ? "text-gray-400 line-through" : "text-gray-800"
                        }`}
                      >
                        {waiter.waiter_name}
                      </span>
                      {waiter.branch && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                          {waiter.branch}
                        </span>
                      )}
                    </div>
                    {waiter.phone && (
                      <span className="text-xs text-gray-400">{waiter.phone}</span>
                    )}
                  </td>

                  {/* Active toggle */}
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleActive(waiter)}
                      className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                        !inactive
                          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "bg-red-50 text-red-500 hover:bg-red-100"
                      }`}
                      title={inactive ? "Inactive" : "Active"}
                    >
                      {!inactive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </td>

                  {/* Per-profile toggles */}
                  {(allProfiles || []).map((p) => {
                    const visible = isVisibleOn(waiter, p.name);
                    const branchLocked =
                      waiter.branch && p.branch && waiter.branch !== p.branch;
                    return (
                      <td key={p.name} className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => toggleCell(waiter, p.name)}
                          disabled={inactive || branchLocked}
                          className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            visible
                              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                          }`}
                          title={branchLocked ? `Locked to branch ${waiter.branch}` : undefined}
                        >
                          {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    );
                  })}

                  {/* Actions */}
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => startEdit(waiter)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(waiter.name)}
                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      >
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

      <p className="mt-3 text-[11px] text-gray-400">
        A waiter with a <b>branch</b> set is locked to POS Profiles of that branch; per-profile toggles are disabled for mismatched profiles.
        Clear the branch to assign a waiter across multiple branches.
      </p>
    </div>
  );
}
