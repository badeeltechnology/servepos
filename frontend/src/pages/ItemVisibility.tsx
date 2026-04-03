import { useState } from "react";
import {
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { Eye, EyeOff, Search } from "lucide-react";

export default function ItemVisibility() {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // Fetch items
  // Get menu groups
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
    ],
    filters,
    limit: 200,
    orderBy: { field: "item_name", order: "asc" },
  });

  const groups = menuGroups;

  const { updateDoc } = useFrappeUpdateDoc();

  async function toggleItem(name: string, current: number) {
    try {
      await updateDoc("Item", name, {
        servepos_is_available: current ? 0 : 1,
      });
      refresh();
    } catch (err: any) {
      alert(err.message || "Failed to update");
    }
  }

  async function bulkToggle(available: boolean) {
    if (!items) return;
    const msg = available
      ? "Mark all visible items as available?"
      : "Mark all visible items as unavailable?";
    if (!confirm(msg)) return;

    for (const item of items) {
      try {
        await updateDoc("Item", item.name, {
          servepos_is_available: available ? 1 : 0,
        });
      } catch {}
    }
    refresh();
  }

  const availableCount = items?.filter((i) => i.servepos_is_available !== 0).length || 0;
  const unavailableCount = (items?.length || 0) - availableCount;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Item Visibility</h1>
        <p className="text-sm text-gray-500">
          Control which items are available on POS terminals. Toggle items on/off — this syncs to all connected desktop apps.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-4 flex items-center gap-4">
        <span className="text-sm text-emerald-600 font-semibold">
          {availableCount} available
        </span>
        <span className="text-sm text-red-500 font-semibold">
          {unavailableCount} unavailable
        </span>
        <div className="flex-1" />
        <button
          onClick={() => bulkToggle(true)}
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50"
        >
          Enable All
        </button>
        <button
          onClick={() => bulkToggle(false)}
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50"
        >
          Disable All
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
            placeholder="Search items..."
            className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {/* Category filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveGroup(null)}
          className={`rounded-xl px-4 py-2 text-xs font-bold ${
            !activeGroup
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-500 shadow-sm hover:bg-gray-50"
          }`}
        >
          All
        </button>
        {groups?.map((g) => (
          <button
            key={g.name}
            onClick={() => setActiveGroup(g.name)}
            className={`rounded-xl px-4 py-2 text-xs font-bold ${
              activeGroup === g.name
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-500 shadow-sm hover:bg-gray-50"
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>

      {/* Items list */}
      <div className="rounded-2xl border bg-white shadow-sm">
        {items?.length === 0 && (
          <p className="py-12 text-center text-gray-400">No items found</p>
        )}
        {items?.map((item, idx) => (
          <div
            key={item.name}
            className={`flex items-center justify-between px-5 py-3 ${
              idx > 0 ? "border-t" : ""
            }`}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold ${
                    item.servepos_is_available === 0
                      ? "text-gray-400 line-through"
                      : "text-gray-800"
                  }`}
                >
                  {item.item_name}
                </span>
                {item.servepos_item_name_ar && (
                  <span className="text-xs text-gray-400" dir="rtl">
                    {item.servepos_item_name_ar}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{item.item_group}</span>
                <span className="text-xs font-bold text-blue-600">
                  {(item.standard_rate || 0).toFixed(2)}
                </span>
              </div>
            </div>
            <button
              onClick={() =>
                toggleItem(item.name, item.servepos_is_available ?? 1)
              }
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                item.servepos_is_available !== 0
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-red-50 text-red-500 hover:bg-red-100"
              }`}
            >
              {item.servepos_is_available !== 0 ? (
                <>
                  <Eye className="mr-1 inline h-3.5 w-3.5" /> Available
                </>
              ) : (
                <>
                  <EyeOff className="mr-1 inline h-3.5 w-3.5" /> Unavailable
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
