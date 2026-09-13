import { useState, useMemo } from "react";
import {
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { Eye, EyeOff, Search, Ban, Globe } from "lucide-react";

/**
 * Item Visibility (matrix view)
 * -----------------------------
 * Shows every menu item as a row with columns for:
 *  - Global availability (emergency 86)
 *  - Disabled toggle (hide from all channels)
 *  - Website toggle (show on online store)
 *  - Per-POS-Profile toggles (legacy servepos_visible_profiles)
 *
 * Rules for per-profile toggles:
 *  - show  -> add profile name to whitelist
 *  - hide  -> if empty (visible everywhere), expand to all OTHER profile
 *             names before removing; otherwise just remove
 *  - whitelist covering every profile normalizes back to empty ("")
 */
export default function ItemVisibility() {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const { data: allProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "branch"],
    limit: 100,
    orderBy: { field: "name", order: "asc" },
  });
  const profileNames = useMemo(
    () => (allProfiles || []).map((p) => p.name),
    [allProfiles],
  );

  // Group profiles by branch for visual grouping
  const branchGroups = useMemo(() => {
    const groups: { branch: string; profiles: { name: string; branch: string }[] }[] = [];
    const branchMap: Record<string, { name: string; branch: string }[]> = {};
    for (const p of allProfiles || []) {
      const b = p.branch || "Other";
      if (!branchMap[b]) branchMap[b] = [];
      branchMap[b].push(p);
    }
    for (const [branch, profiles] of Object.entries(branchMap)) {
      groups.push({ branch, profiles });
    }
    return groups.sort((a, b) => a.branch.localeCompare(b.branch));
  }, [allProfiles]);

  const { data: menuGroups } = useFrappeGetDocList("Item Group", {
    fields: ["name"],
    filters: [["servepos_is_menu_group", "=", 1]],
    limit: 100,
  });
  const menuGroupNames = menuGroups?.map((g) => g.name) || [];

  const filters: any[] = [["disabled", "=", 0]];
  if (menuGroupNames.length > 0 && !activeGroup) {
    filters.push(["item_group", "in", menuGroupNames]);
  }
  if (activeGroup) filters.push(["item_group", "=", activeGroup]);
  if (search) filters.push(["item_name", "like", `%${search}%`]);

  const { data: items, mutate: refresh } = useFrappeGetDocList("Item", {
    fields: [
      "name",
      "item_name",
      "item_group",
      "standard_rate",
      "servepos_item_name_ar",
      "servepos_is_available",
      "servepos_visible_profiles",
      "servepos_is_disabled",
      "servepos_show_on_website",
    ],
    filters,
    limit: 500,
    orderBy: { field: "item_name", order: "asc" },
  });

  const { updateDoc } = useFrappeUpdateDoc();

  // --- Helpers ---------------------------------------------------------

  function parseList(raw: string | undefined | null): string[] {
    if (!raw) return [];
    return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  }

  function isVisibleOn(item: any, profileName: string): boolean {
    if (item.servepos_is_available === 0) return false;
    const list = parseList(item.servepos_visible_profiles);
    if (list.length === 0) return true;
    return list.includes(profileName);
  }

  function nextWhitelist(
    currentRaw: string | undefined | null,
    profileName: string,
    action: "show" | "hide",
  ): string {
    let list = parseList(currentRaw);
    if (list.length === 0) {
      list = [...profileNames];
    }
    if (action === "hide") {
      list = list.filter((n) => n !== profileName);
    } else if (!list.includes(profileName)) {
      list.push(profileName);
    }
    const ordered = profileNames.filter((n) => list.includes(n));
    return ordered.join(",");
  }

  async function toggleCell(item: any, profileName: string) {
    if (item.servepos_is_available === 0 || item.servepos_is_disabled === 1) return;
    const currentlyVisible = isVisibleOn(item, profileName);
    const next = nextWhitelist(
      item.servepos_visible_profiles,
      profileName,
      currentlyVisible ? "hide" : "show",
    );
    try {
      await updateDoc("Item", item.name, { servepos_visible_profiles: next });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function toggleGlobal(item: any) {
    try {
      await updateDoc("Item", item.name, {
        servepos_is_available: item.servepos_is_available === 0 ? 1 : 0,
      });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function toggleDisabled(item: any) {
    try {
      await updateDoc("Item", item.name, {
        servepos_is_disabled: item.servepos_is_disabled === 1 ? 0 : 1,
      });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function toggleWebsite(item: any) {
    if (item.servepos_is_disabled === 1) return;
    try {
      await updateDoc("Item", item.name, {
        servepos_show_on_website: item.servepos_show_on_website === 1 ? 0 : 1,
      });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function bulkToggleColumn(profileName: string, show: boolean) {
    if (!items) return;
    if (!confirm(show ? `Show all filtered items on ${profileName}?` : `Hide all filtered items from ${profileName}?`)) return;
    for (const item of items) {
      if (item.servepos_is_available === 0 || item.servepos_is_disabled === 1) continue;
      const currentlyVisible = isVisibleOn(item, profileName);
      if (currentlyVisible === show) continue;
      const next = nextWhitelist(item.servepos_visible_profiles, profileName, show ? "show" : "hide");
      try { await updateDoc("Item", item.name, { servepos_visible_profiles: next }); } catch {}
    }
    refresh();
  }

  async function bulkToggleWebsite(show: boolean) {
    if (!items) return;
    if (!confirm(show ? "Enable all filtered items on website?" : "Disable all filtered items from website?")) return;
    for (const item of items) {
      if (item.servepos_is_disabled === 1) continue;
      if ((item.servepos_show_on_website === 1) === show) continue;
      try { await updateDoc("Item", item.name, { servepos_show_on_website: show ? 1 : 0 }); } catch {}
    }
    refresh();
  }

  // --- Render ----------------------------------------------------------

  const totalProfileCols = (allProfiles || []).length;

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">Item Visibility</h1>
        <p className="text-sm text-gray-500">
          Control item visibility per POS Profile and online store. Disabled items are hidden everywhere.
        </p>
      </div>

      {/* Search */}
      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..."
            className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        </div>
      </div>

      {/* Category filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setActiveGroup(null)}
          className={`rounded-xl px-4 py-1.5 text-xs font-bold ${!activeGroup ? "bg-blue-600 text-white" : "bg-white text-gray-500 shadow-sm hover:bg-gray-50"}`}>
          All
        </button>
        {menuGroups?.map((g) => (
          <button key={g.name} onClick={() => setActiveGroup(g.name)}
            className={`rounded-xl px-4 py-1.5 text-xs font-bold ${activeGroup === g.name ? "bg-blue-600 text-white" : "bg-white text-gray-500 shadow-sm hover:bg-gray-50"}`}>
            {g.name}
          </button>
        ))}
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Item
              </th>
              <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Global
              </th>
              <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500 border-l border-gray-200">
                <div className="flex flex-col items-center gap-1">
                  <span className="flex items-center gap-1 text-gray-700 normal-case text-[12px]">
                    <Ban className="h-3 w-3" /> Disabled
                  </span>
                </div>
              </th>
              <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500 border-l border-gray-200">
                <div className="flex flex-col items-center gap-1">
                  <span className="flex items-center gap-1 text-blue-700 normal-case text-[12px]">
                    <Globe className="h-3 w-3" /> Website
                  </span>
                  <div className="mt-1 flex gap-1">
                    <button onClick={() => bulkToggleWebsite(true)}
                      className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 hover:bg-blue-100">All</button>
                    <button onClick={() => bulkToggleWebsite(false)}
                      className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600 hover:bg-red-100">None</button>
                  </div>
                </div>
              </th>
              {branchGroups.map((bg) => (
                bg.profiles.map((p, pIdx) => (
                  <th key={p.name}
                    className={`px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500 ${pIdx === 0 ? "border-l border-gray-200" : ""}`}>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-gray-700 normal-case text-[12px]">{p.name}</span>
                      {p.branch && <span className="text-[9px] font-normal text-gray-400">{p.branch}</span>}
                      <div className="mt-1 flex gap-1">
                        <button onClick={() => bulkToggleColumn(p.name, true)}
                          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 hover:bg-emerald-100">All</button>
                        <button onClick={() => bulkToggleColumn(p.name, false)}
                          className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600 hover:bg-red-100">None</button>
                      </div>
                    </div>
                  </th>
                ))
              ))}
            </tr>
          </thead>
          <tbody>
            {items?.length === 0 && (
              <tr>
                <td colSpan={4 + totalProfileCols} className="py-12 text-center text-gray-400">
                  No items found
                </td>
              </tr>
            )}
            {items?.map((item, idx) => {
              const globallyOff = item.servepos_is_available === 0;
              const isDisabled = item.servepos_is_disabled === 1;
              const isOnWebsite = item.servepos_show_on_website === 1;
              const locked = globallyOff || isDisabled;
              return (
                <tr key={item.name}
                  className={`${idx > 0 ? "border-t" : ""} hover:bg-gray-50/60 ${isDisabled ? "opacity-50" : ""}`}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${locked ? "text-gray-400 line-through" : "text-gray-800"}`}>
                        {item.item_name}
                      </span>
                      {item.servepos_item_name_ar && (
                        <span className="text-xs text-gray-400" dir="rtl">{item.servepos_item_name_ar}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{item.item_group}</span>
                      <span className="text-xs font-bold text-blue-600">{(item.standard_rate || 0).toFixed(2)}</span>
                    </div>
                  </td>

                  {/* Global toggle */}
                  <td className="px-3 py-2.5 text-center">
                    <button onClick={() => toggleGlobal(item)}
                      disabled={isDisabled}
                      className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        !globallyOff ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-red-50 text-red-500 hover:bg-red-100"
                      }`}>
                      {!globallyOff ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </td>

                  {/* Disabled toggle */}
                  <td className="px-3 py-2.5 text-center border-l border-gray-100">
                    <button onClick={() => toggleDisabled(item)}
                      className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                        isDisabled ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                      }`}
                      title={isDisabled ? "Click to enable" : "Click to disable"}>
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </td>

                  {/* Website toggle */}
                  <td className="px-3 py-2.5 text-center border-l border-gray-100">
                    <button onClick={() => toggleWebsite(item)}
                      disabled={isDisabled}
                      className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        isOnWebsite ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                      }`}
                      title={isOnWebsite ? "Visible on website" : "Hidden from website"}>
                      <Globe className="h-3.5 w-3.5" />
                    </button>
                  </td>

                  {/* Per-profile toggles */}
                  {branchGroups.map((bg) => (
                    bg.profiles.map((p, pIdx) => {
                      const visible = isVisibleOn(item, p.name);
                      return (
                        <td key={p.name} className={`px-3 py-2.5 text-center ${pIdx === 0 ? "border-l border-gray-100" : ""}`}>
                          <button onClick={() => toggleCell(item, p.name)}
                            disabled={locked}
                            className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                              visible ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                            }`}>
                            {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                      );
                    })
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-gray-400">
        <b>Global</b>: Emergency 86 (out of stock).{" "}
        <b>Disabled</b>: Permanently hidden from all channels.{" "}
        <b>Website</b>: Show on online ordering store.{" "}
        Green eye = visible on POS Profile. Grey = hidden. Disabled items lock all toggles.
      </p>
    </div>
  );
}
