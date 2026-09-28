import { useState, useEffect } from "react";
import { useFrappeGetCall, useFrappePostCall, useFrappeGetDocList } from "frappe-react-sdk";
import { Save } from "lucide-react";

export default function Settings() {
  const { data, mutate } = useFrappeGetCall("servepos.api.store.get_store_settings");
  const settings = data?.message;

  const [centralWarehouse, setCentralWarehouse] = useState("");
  const [itemFilter, setItemFilter] = useState("Stock Items Only");
  const [allowedGroups, setAllowedGroups] = useState<string[]>([]);
  const [defaultDays, setDefaultDays] = useState(3);
  const [lowStockAlerts, setLowStockAlerts] = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState(10);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: warehouses } = useFrappeGetDocList("Warehouse", {
    fields: ["name"], filters: [["is_group", "=", 0]], limit: 100, orderBy: { field: "name", order: "asc" },
  });
  const { data: itemGroups } = useFrappeGetDocList("Item Group", {
    fields: ["name"], filters: [["is_group", "=", 0]], limit: 200, orderBy: { field: "name", order: "asc" },
  });

  useEffect(() => {
    if (settings) {
      setCentralWarehouse(settings.central_warehouse || "");
      setItemFilter(settings.item_filter || "Stock Items Only");
      setAllowedGroups(settings.allowed_item_groups || []);
      setDefaultDays(settings.default_required_days || 3);
      setLowStockAlerts(!!settings.enable_low_stock_alerts);
      setLowStockThreshold(settings.low_stock_threshold || 10);
    }
  }, [settings]);

  const { call } = useFrappePostCall("servepos.api.store.save_store_settings");

  async function handleSave() {
    setSaving(true);
    try {
      await call({
        central_warehouse: centralWarehouse,
        item_filter: itemFilter,
        allowed_item_groups: JSON.stringify(allowedGroups),
        default_required_days: defaultDays,
        enable_low_stock_alerts: lowStockAlerts ? 1 : 0,
        low_stock_threshold: lowStockThreshold,
      });
      mutate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      alert(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <div className="text-sm text-gray-400">Loading settings...</div>;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Store Settings</h1>
        <p className="text-sm text-gray-500">Configure stock management preferences</p>
      </div>

      <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6">
        {/* Central Warehouse */}
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-gray-700">Central Warehouse</label>
          <p className="mb-2 text-[11px] text-gray-400">Main warehouse from which stock is transferred to branches</p>
          <select
            value={centralWarehouse}
            onChange={(e) => setCentralWarehouse(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none"
          >
            <option value="">Select warehouse...</option>
            {warehouses?.map((w) => (
              <option key={w.name} value={w.name}>{w.name}</option>
            ))}
          </select>
        </div>

        {/* Item Filter */}
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-gray-700">Items to Show</label>
          <p className="mb-2 text-[11px] text-gray-400">Control which items supervisors can see and request</p>
          <div className="space-y-2">
            {["Stock Items Only", "All Items", "Selected Groups"].map((opt) => (
              <label key={opt} className="flex items-center gap-2.5 cursor-pointer rounded-md px-3 py-2 hover:bg-gray-50">
                <input
                  type="radio"
                  name="item_filter"
                  value={opt}
                  checked={itemFilter === opt}
                  onChange={() => setItemFilter(opt)}
                  className="h-3.5 w-3.5 border-gray-300 text-gray-900"
                />
                <span className="text-[13px] text-gray-800">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Allowed Groups */}
        {itemFilter === "Selected Groups" && (
          <div>
            <label className="mb-2 block text-[12px] font-semibold text-gray-700">Allowed Item Groups</label>
            <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 divide-y divide-gray-100">
              {itemGroups?.map((g) => (
                <label key={g.name} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedGroups.includes(g.name)}
                    onChange={() => {
                      if (allowedGroups.includes(g.name)) {
                        setAllowedGroups(allowedGroups.filter((x) => x !== g.name));
                      } else {
                        setAllowedGroups([...allowedGroups, g.name]);
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900"
                  />
                  <span className="text-[13px] text-gray-800">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Defaults */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-gray-700">Default Required By (Days)</label>
            <input
              type="number"
              value={defaultDays}
              onChange={(e) => setDefaultDays(parseInt(e.target.value) || 3)}
              min={1}
              className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-gray-700">Low Stock Threshold</label>
            <input
              type="number"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(parseFloat(e.target.value) || 10)}
              min={0}
              disabled={!lowStockAlerts}
              className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={lowStockAlerts}
            onChange={() => setLowStockAlerts(!lowStockAlerts)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900"
          />
          <span className="text-[13px] text-gray-800">Enable low stock alerts</span>
        </label>

        {/* Save */}
        <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-gray-900 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {saved && <span className="text-[12px] font-medium text-green-600">Settings saved!</span>}
        </div>
      </div>
    </div>
  );
}
