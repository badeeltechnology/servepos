import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";

// Types
interface ItemGroup {
  name: string;
  image: string | null;
}

interface MenuItem {
  name: string;
  item_name: string;
  item_code: string;
  item_group: string;
  standard_rate: number;
  description: string;
  image: string | null;
  servepos_item_name_ar?: string;
  servepos_description_ar?: string;
}

interface ModifierOption {
  modifier_name: string;
  price: number;
  is_default: number;
}

interface ModifierGroup {
  name: string;
  group_name: string;
  selection_type: string;
  is_required: number;
  max_selections: number;
  modifiers: ModifierOption[];
}

export interface CartItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  image: string | null;
  modifiers: string;
  modifier_total: number;
  special_instructions: string;
}

interface GuestMenuProps {
  seatCode: string;
  posProfile: string;
  token: string;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  restaurantName: string;
  currency?: string;
}

// API helper
async function guestApi(method: string, args: Record<string, string>) {
  const csrfToken =
    window.csrf_token && !window.csrf_token.includes("{{")
      ? window.csrf_token
      : "";

  const res = await fetch(`/api/method/servepos.api.guest.${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(args),
  });

  const data = await res.json();
  if (data.exc) {
    const msg = data._server_messages
      ? JSON.parse(JSON.parse(data._server_messages)[0]).message
      : data.exc;
    throw new Error(msg);
  }
  return data.message;
}

export default function GuestMenu({
  seatCode,
  posProfile,
  token,
  cart,
  setCart,
  restaurantName,
  currency = "",
}: GuestMenuProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [itemModifierMap, setItemModifierMap] = useState<Record<string, string[]>>({});
  const [activeGroup, setActiveGroup] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [itemQty, setItemQty] = useState(1);
  const [itemInstructions, setItemInstructions] = useState("");
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});

  useEffect(() => {
    async function loadMenu() {
      try {
        const result = await guestApi("get_guest_menu", {
          seat_code: seatCode,
          pos_profile: posProfile,
        });
        setGroups(result.item_groups || []);
        setItems(result.items || []);
        setModifierGroups(result.modifier_groups || []);
        setItemModifierMap(result.item_modifier_map || {});
      } catch (e: any) {
        setError(e.message || "Failed to load menu");
      } finally {
        setLoading(false);
      }
    }
    loadMenu();
  }, [seatCode, posProfile]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (activeGroup !== "All") {
      result = result.filter((i) => i.item_group === activeGroup);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.item_name.toLowerCase().includes(q) ||
          (i.servepos_item_name_ar || "").includes(q) ||
          i.item_code.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, activeGroup, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, ci) => sum + (ci.rate + ci.modifier_total) * ci.qty, 0),
    [cart]
  );
  const cartCount = useMemo(
    () => cart.reduce((sum, ci) => sum + ci.qty, 0),
    [cart]
  );

  const addToCart = useCallback(
    (item: MenuItem, qty: number, modifiers: string, modifierTotal: number, instructions: string) => {
      setCart((prev) => {
        // Check if same item with same modifiers exists
        const existingIdx = prev.findIndex(
          (ci) => ci.item_code === item.item_code && ci.modifiers === modifiers && ci.special_instructions === instructions
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            qty: updated[existingIdx].qty + qty,
          };
          return updated;
        }
        return [
          ...prev,
          {
            item_code: item.item_code,
            item_name: item.item_name,
            qty,
            rate: item.standard_rate,
            image: item.image,
            modifiers,
            modifier_total: modifierTotal,
            special_instructions: instructions,
          },
        ];
      });
      setSelectedItem(null);
      setItemQty(1);
      setItemInstructions("");
      setSelectedModifiers({});
    },
    [setCart]
  );

  const handleItemClick = useCallback((item: MenuItem) => {
    setSelectedItem(item);
    setItemQty(1);
    setItemInstructions("");
    // Set defaults for modifiers
    const itemMods = itemModifierMap[item.item_code] || [];
    const defaults: Record<string, string[]> = {};
    for (const mgName of itemMods) {
      const mg = modifierGroups.find((g) => g.name === mgName);
      if (mg) {
        const defaultMods = mg.modifiers.filter((m) => m.is_default).map((m) => m.modifier_name);
        if (defaultMods.length > 0) defaults[mg.name] = defaultMods;
      }
    }
    setSelectedModifiers(defaults);
  }, [itemModifierMap, modifierGroups]);

  const handleAddFromModal = useCallback(() => {
    if (!selectedItem) return;

    // Build modifier string and total
    let modifierStr = "";
    let modifierTotal = 0;
    const itemMods = itemModifierMap[selectedItem.item_code] || [];
    const parts: string[] = [];

    for (const mgName of itemMods) {
      const mg = modifierGroups.find((g) => g.name === mgName);
      if (!mg) continue;
      const selected = selectedModifiers[mg.name] || [];
      for (const modName of selected) {
        const mod = mg.modifiers.find((m) => m.modifier_name === modName);
        if (mod) {
          parts.push(mod.modifier_name);
          modifierTotal += mod.price || 0;
        }
      }
    }
    modifierStr = parts.join(", ");

    addToCart(selectedItem, itemQty, modifierStr, modifierTotal, itemInstructions);
  }, [selectedItem, itemQty, itemInstructions, selectedModifiers, itemModifierMap, modifierGroups, addToCart]);

  const toggleModifier = useCallback((groupName: string, modName: string, selectionType: string, maxSelections: number) => {
    setSelectedModifiers((prev) => {
      const current = prev[groupName] || [];
      if (selectionType === "Single") {
        return { ...prev, [groupName]: current.includes(modName) ? [] : [modName] };
      }
      // Multiple
      if (current.includes(modName)) {
        return { ...prev, [groupName]: current.filter((m) => m !== modName) };
      }
      if (maxSelections && current.length >= maxSelections) {
        return prev;
      }
      return { ...prev, [groupName]: [...current, modName] };
    });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-500">Loading menu...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
        <div className="text-5xl mb-4">😞</div>
        <p className="text-gray-500 text-center">{error}</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 text-amber-600 font-medium"
        >
          Go Back
        </button>
      </div>
    );
  }

  const itemModsForSelected = selectedItem
    ? (itemModifierMap[selectedItem.item_code] || [])
        .map((mgName) => modifierGroups.find((g) => g.name === mgName))
        .filter(Boolean) as ModifierGroup[]
    : [];

  return (
    <div className="pb-24">
      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-4 pb-2 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          <button
            onClick={() => setActiveGroup("All")}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
              activeGroup === "All"
                ? "bg-amber-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g.name}
              onClick={() => setActiveGroup(g.name)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                activeGroup === g.name
                  ? "bg-amber-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Items Grid */}
      <div className="px-4 py-2">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-2">🍽️</div>
            <p className="text-gray-500 text-sm">No items found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredItems.map((item) => (
              <ItemCard
                key={item.item_code}
                item={item}
                currency={currency}
                onClick={() => handleItemClick(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Item Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setSelectedItem(null)}>
          <div
            className="bg-white rounded-t-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Item Image */}
            {selectedItem.image && (
              <div className="w-full h-48 bg-gray-100">
                <img
                  src={selectedItem.image}
                  alt={selectedItem.item_name}
                  className="w-full h-full object-cover rounded-t-3xl"
                />
              </div>
            )}

            <div className="p-5">
              <h3 className="text-xl font-bold text-gray-900">
                {selectedItem.item_name}
              </h3>
              {selectedItem.servepos_item_name_ar && (
                <p className="text-sm text-gray-500 mt-0.5" dir="rtl">
                  {selectedItem.servepos_item_name_ar}
                </p>
              )}
              <p className="text-lg font-bold text-amber-600 mt-1">
                {currency} {selectedItem.standard_rate.toFixed(2)}
              </p>
              {selectedItem.description && (
                <p className="text-sm text-gray-500 mt-2">
                  {selectedItem.description}
                </p>
              )}

              {/* Modifiers */}
              {itemModsForSelected.map((mg) => (
                <div key={mg.name} className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-semibold text-gray-700">
                      {mg.group_name}
                    </h4>
                    {mg.is_required ? (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                        Required
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                        Optional
                      </span>
                    )}
                    {mg.selection_type === "Multiple" && mg.max_selections > 0 && (
                      <span className="text-xs text-gray-400">
                        Max {mg.max_selections}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {mg.modifiers.map((mod) => {
                      const isSelected = (selectedModifiers[mg.name] || []).includes(mod.modifier_name);
                      return (
                        <button
                          key={mod.modifier_name}
                          onClick={() => toggleModifier(mg.name, mod.modifier_name, mg.selection_type, mg.max_selections)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-colors",
                            isSelected
                              ? "border-amber-400 bg-amber-50 text-amber-800"
                              : "border-gray-200 text-gray-700 hover:bg-gray-50"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className={cn(
                              "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                              isSelected ? "border-amber-500 bg-amber-500" : "border-gray-300"
                            )}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            {mod.modifier_name}
                          </span>
                          {mod.price > 0 && (
                            <span className="text-gray-500">
                              +{currency} {mod.price.toFixed(2)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Special Instructions */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Special Instructions
                </h4>
                <textarea
                  value={itemInstructions}
                  onChange={(e) => setItemInstructions(e.target.value)}
                  placeholder="Any special requests..."
                  maxLength={200}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>

              {/* Quantity + Add to Cart */}
              <div className="mt-5 flex items-center gap-3">
                <div className="flex items-center bg-gray-100 rounded-xl">
                  <button
                    onClick={() => setItemQty((q) => Math.max(1, q - 1))}
                    className="w-10 h-10 flex items-center justify-center text-gray-600 font-bold text-lg"
                  >
                    -
                  </button>
                  <span className="w-8 text-center font-semibold">{itemQty}</span>
                  <button
                    onClick={() => setItemQty((q) => q + 1)}
                    className="w-10 h-10 flex items-center justify-center text-gray-600 font-bold text-lg"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={handleAddFromModal}
                  className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold text-base shadow-md shadow-orange-200 active:scale-[0.98] transition-transform"
                >
                  Add to Cart — {currency} {((selectedItem.standard_rate + calculateModifierTotal()) * itemQty).toFixed(2)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart Floating Bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-gradient-to-t from-white via-white to-transparent pt-8">
          <button
            onClick={() => navigate(`/${seatCode}/cart/${posProfile}`)}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl shadow-lg shadow-orange-200 active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center gap-3">
              <span className="bg-white/20 rounded-lg w-8 h-8 flex items-center justify-center font-bold">
                {cartCount}
              </span>
              <span className="font-semibold text-base">View Cart</span>
            </div>
            <span className="font-bold text-lg">
              {currency} {cartTotal.toFixed(2)}
            </span>
          </button>
        </div>
      )}
    </div>
  );

  function calculateModifierTotal(): number {
    if (!selectedItem) return 0;
    let total = 0;
    const itemMods = itemModifierMap[selectedItem.item_code] || [];
    for (const mgName of itemMods) {
      const mg = modifierGroups.find((g) => g.name === mgName);
      if (!mg) continue;
      const selected = selectedModifiers[mg.name] || [];
      for (const modName of selected) {
        const mod = mg.modifiers.find((m) => m.modifier_name === modName);
        if (mod) total += mod.price || 0;
      }
    }
    return total;
  }
}

// --- Sub-Components ---

function ItemCard({
  item,
  currency,
  onClick,
}: {
  item: MenuItem;
  currency: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden text-left transition-shadow hover:shadow-md active:scale-[0.98]"
    >
      {item.image ? (
        <div className="w-full h-28 bg-gray-100">
          <img
            src={item.image}
            alt={item.item_name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-full h-28 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <span className="text-3xl">🍽️</span>
        </div>
      )}
      <div className="p-3">
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight">
          {item.item_name}
        </h3>
        {item.servepos_item_name_ar && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1" dir="rtl">
            {item.servepos_item_name_ar}
          </p>
        )}
        <p className="text-sm font-bold text-amber-600 mt-1.5">
          {currency} {item.standard_rate.toFixed(2)}
        </p>
      </div>
    </button>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}
