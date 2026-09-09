import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  const [addedItem, setAddedItem] = useState<string | null>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

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

  // Group items by category for list view
  const groupedItems = useMemo(() => {
    if (activeGroup !== "All") return { [activeGroup]: filteredItems };
    const grouped: Record<string, MenuItem[]> = {};
    for (const item of filteredItems) {
      if (!grouped[item.item_group]) grouped[item.item_group] = [];
      grouped[item.item_group].push(item);
    }
    return grouped;
  }, [filteredItems, activeGroup]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, ci) => sum + (ci.rate + ci.modifier_total) * ci.qty, 0),
    [cart]
  );
  const cartCount = useMemo(
    () => cart.reduce((sum, ci) => sum + ci.qty, 0),
    [cart]
  );

  const getItemCartQty = useCallback(
    (itemCode: string) => {
      return cart
        .filter((ci) => ci.item_code === itemCode)
        .reduce((sum, ci) => sum + ci.qty, 0);
    },
    [cart]
  );

  const addToCart = useCallback(
    (item: MenuItem, qty: number, modifiers: string, modifierTotal: number, instructions: string) => {
      setCart((prev) => {
        const existingIdx = prev.findIndex(
          (ci) => ci.item_code === item.item_code && ci.modifiers === modifiers && ci.special_instructions === instructions
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = { ...updated[existingIdx], qty: updated[existingIdx].qty + qty };
          return updated;
        }
        return [...prev, {
          item_code: item.item_code,
          item_name: item.item_name,
          qty,
          rate: item.standard_rate,
          image: item.image,
          modifiers,
          modifier_total: modifierTotal,
          special_instructions: instructions,
        }];
      });
      setSelectedItem(null);
      setItemQty(1);
      setItemInstructions("");
      setSelectedModifiers({});
      // Flash added animation
      setAddedItem(item.item_code);
      setTimeout(() => setAddedItem(null), 800);
    },
    [setCart]
  );

  const handleItemClick = useCallback((item: MenuItem) => {
    const itemMods = itemModifierMap[item.item_code] || [];
    // If no modifiers, add directly
    if (itemMods.length === 0) {
      addToCart(item, 1, "", 0, "");
      return;
    }
    // Otherwise show detail modal
    setSelectedItem(item);
    setItemQty(1);
    setItemInstructions("");
    const defaults: Record<string, string[]> = {};
    for (const mgName of itemMods) {
      const mg = modifierGroups.find((g) => g.name === mgName);
      if (mg) {
        const defaultMods = mg.modifiers.filter((m) => m.is_default).map((m) => m.modifier_name);
        if (defaultMods.length > 0) defaults[mg.name] = defaultMods;
      }
    }
    setSelectedModifiers(defaults);
  }, [itemModifierMap, modifierGroups, addToCart]);

  const handleAddFromModal = useCallback(() => {
    if (!selectedItem) return;
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
      if (current.includes(modName)) {
        return { ...prev, [groupName]: current.filter((m) => m !== modName) };
      }
      if (maxSelections && current.length >= maxSelections) return prev;
      return { ...prev, [groupName]: [...current, modName] };
    });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-400 text-sm">Loading menu...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-gray-500 text-center text-sm">{error}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-amber-600 font-medium text-sm">
          Go Back
        </button>
      </div>
    );
  }

  const itemModsForSelected = selectedItem
    ? (itemModifierMap[selectedItem.item_code] || []).map((mgName) => modifierGroups.find((g) => g.name === mgName)).filter(Boolean) as ModifierGroup[]
    : [];

  return (
    <div className="pb-28 bg-white min-h-screen">
      {/* Search Bar */}
      <div className="px-4 pt-4 pb-3 bg-white sticky top-0 z-20">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search for dishes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl bg-gray-50 border-0 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:bg-white transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center"
            >
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Category Pills */}
      <div ref={categoryRef} className="px-4 pb-3 overflow-x-auto scrollbar-hide sticky top-[60px] z-20 bg-white">
        <div className="flex gap-2 min-w-max pb-1">
          <CategoryPill label="All" active={activeGroup === "All"} onClick={() => setActiveGroup("All")} />
          {groups.map((g) => (
            <CategoryPill
              key={g.name}
              label={g.name}
              image={g.image}
              active={activeGroup === g.name}
              onClick={() => setActiveGroup(g.name)}
            />
          ))}
        </div>
      </div>

      {/* Thin divider */}
      <div className="h-px bg-gray-100" />

      {/* Menu Items */}
      <div className="px-4 pt-3">
        {filteredItems.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">No dishes found</p>
            {search && (
              <button onClick={() => setSearch("")} className="mt-2 text-amber-500 text-sm font-medium">
                Clear search
              </button>
            )}
          </div>
        ) : (
          Object.entries(groupedItems).map(([groupName, groupItems]) => (
            <div key={groupName} className="mb-6">
              {/* Section Header */}
              {activeGroup === "All" && (
                <div className="flex items-center gap-3 mb-3 mt-1">
                  <h3 className="text-base font-bold text-gray-900">{groupName}</h3>
                  <span className="text-xs text-gray-400 font-medium">{groupItems.length}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              )}

              {/* Items — List layout for better readability */}
              <div className="space-y-3">
                {groupItems.map((item) => {
                  const inCart = getItemCartQty(item.item_code);
                  const justAdded = addedItem === item.item_code;
                  return (
                    <button
                      key={item.item_code}
                      onClick={() => handleItemClick(item)}
                      className={cn(
                        "w-full flex gap-3.5 bg-white rounded-2xl p-3 text-left transition-all duration-200",
                        "border border-gray-100 hover:border-gray-200 hover:shadow-sm",
                        "active:scale-[0.99]",
                        justAdded && "ring-2 ring-emerald-400 border-emerald-200"
                      )}
                    >
                      {/* Item Image */}
                      <div className="relative flex-shrink-0">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.item_name}
                            className="w-24 h-24 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
                            <svg className="w-8 h-8 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-3-4.87v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.38a48.474 48.474 0 00-6-.37c-2.032 0-4.034.126-6 .37m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.17c0 .62-.504 1.124-1.125 1.124H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265zm-3 0a.375.375 0 11-.53 0L9 2.845l.265.265zm6 0a.375.375 0 11-.53 0L15 2.845l.265.265z" />
                            </svg>
                          </div>
                        )}
                        {/* Cart badge */}
                        {inCart > 0 && (
                          <div className={cn(
                            "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm transition-transform",
                            justAdded && "scale-125"
                          )}>
                            {inCart}
                          </div>
                        )}
                      </div>

                      {/* Item Info */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
                            {item.item_name}
                          </h4>
                          {item.servepos_item_name_ar && (
                            <p className="text-xs text-gray-400 mt-0.5 leading-snug line-clamp-1" dir="rtl">
                              {item.servepos_item_name_ar}
                            </p>
                          )}
                          {item.description && (
                            <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                              {item.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm font-bold text-gray-900">
                            {currency} {item.standard_rate.toFixed(2)}
                          </span>
                          <span className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-sm">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Item Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setSelectedItem(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-white rounded-t-[28px] w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close handle */}
            <div className="sticky top-0 z-10 flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            {/* Item Image */}
            {selectedItem.image && (
              <div className="w-full h-56 bg-gray-100 -mt-1">
                <img
                  src={selectedItem.image}
                  alt={selectedItem.item_name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="p-5 pb-6">
              {/* Name + Price */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 leading-tight">
                    {selectedItem.item_name}
                  </h3>
                  {selectedItem.servepos_item_name_ar && (
                    <p className="text-sm text-gray-400 mt-1" dir="rtl">
                      {selectedItem.servepos_item_name_ar}
                    </p>
                  )}
                </div>
                <span className="text-lg font-bold text-amber-600 whitespace-nowrap pt-0.5">
                  {currency} {selectedItem.standard_rate.toFixed(2)}
                </span>
              </div>

              {/* Description */}
              {(selectedItem.description || selectedItem.servepos_description_ar) && (
                <div className="mt-3 pb-4 border-b border-gray-100">
                  {selectedItem.description && (
                    <p className="text-sm text-gray-500 leading-relaxed">{selectedItem.description}</p>
                  )}
                  {selectedItem.servepos_description_ar && (
                    <p className="text-sm text-gray-400 mt-1 leading-relaxed" dir="rtl">
                      {selectedItem.servepos_description_ar}
                    </p>
                  )}
                </div>
              )}

              {/* Modifiers */}
              {itemModsForSelected.map((mg) => (
                <div key={mg.name} className="mt-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <h4 className="text-sm font-bold text-gray-900">{mg.group_name}</h4>
                    {mg.is_required ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-red-500 text-white px-2 py-0.5 rounded-full">
                        Required
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                        Optional
                      </span>
                    )}
                    {mg.selection_type === "Multiple" && mg.max_selections > 0 && (
                      <span className="text-xs text-gray-400">up to {mg.max_selections}</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {mg.modifiers.map((mod) => {
                      const isSelected = (selectedModifiers[mg.name] || []).includes(mod.modifier_name);
                      return (
                        <button
                          key={mod.modifier_name}
                          onClick={() => toggleModifier(mg.name, mod.modifier_name, mg.selection_type, mg.max_selections)}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm transition-all",
                            isSelected
                              ? "bg-amber-50 border-2 border-amber-400"
                              : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                          )}
                        >
                          <span className="flex items-center gap-3">
                            <span className={cn(
                              "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                              isSelected ? "border-amber-500 bg-amber-500" : "border-gray-300 bg-white"
                            )}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            <span className={cn("font-medium", isSelected ? "text-amber-900" : "text-gray-700")}>
                              {mod.modifier_name}
                            </span>
                          </span>
                          {mod.price > 0 && (
                            <span className={cn("text-xs font-medium", isSelected ? "text-amber-700" : "text-gray-400")}>
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
              <div className="mt-5">
                <h4 className="text-sm font-bold text-gray-900 mb-2">Special Instructions</h4>
                <textarea
                  value={itemInstructions}
                  onChange={(e) => setItemInstructions(e.target.value)}
                  placeholder="e.g. No onions, extra sauce..."
                  maxLength={200}
                  rows={2}
                  className="w-full px-4 py-3 rounded-2xl bg-gray-50 border-0 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
                />
              </div>

              {/* Quantity + Add to Cart */}
              <div className="mt-6 flex items-center gap-3">
                <div className="flex items-center bg-gray-100 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setItemQty((q) => Math.max(1, q - 1))}
                    className="w-11 h-11 flex items-center justify-center text-gray-500 active:bg-gray-200 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                    </svg>
                  </button>
                  <span className="w-8 text-center font-bold text-gray-900">{itemQty}</span>
                  <button
                    onClick={() => setItemQty((q) => q + 1)}
                    className="w-11 h-11 flex items-center justify-center text-gray-500 active:bg-gray-200 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={handleAddFromModal}
                  className="flex-1 py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-semibold text-[15px] active:scale-[0.98] transition-all shadow-lg shadow-amber-200"
                >
                  Add — {currency} {((selectedItem.standard_rate + calculateModifierTotal()) * itemQty).toFixed(2)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart Floating Bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-6 bg-gradient-to-t from-white via-white/95 to-transparent">
          <button
            onClick={() => navigate(`/${seatCode}/cart/${posProfile}`)}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl shadow-xl shadow-amber-300/40 active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="bg-white/25 rounded-xl w-8 h-8 flex items-center justify-center text-sm font-bold">
                {cartCount}
              </span>
              <span className="font-semibold">View Cart</span>
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

// --- Category Pill ---

function CategoryPill({ label, image, active, onClick }: {
  label: string;
  image?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
        active
          ? "bg-amber-500 text-white shadow-md shadow-amber-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      )}
    >
      {image && !active && (
        <img src={image} alt="" className="w-5 h-5 rounded-full object-cover" />
      )}
      {label}
    </button>
  );
}
