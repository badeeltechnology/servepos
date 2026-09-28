import { useState, useCallback, useRef } from "react";
import { useFrappeGetDocList, useFrappeGetCall, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Plus, Search, Edit3, Trash2, X, FolderPlus, ImagePlus, Ban, GripVertical, ArrowUpDown, CheckSquare, Square, Eye, EyeOff, FolderInput } from "lucide-react";

interface AvailabilityRow {
  branch: string;
  pos_profile: string;
  show_on_pos: number;
  show_on_website: number;
}

export default function MenuManagement() {
  const { profile } = useProfile();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    item_code: "", item_name: "", item_group: "", standard_rate: 0,
    description: "", servepos_item_name_ar: "", servepos_description_ar: "",
    servepos_visible_profiles: "", servepos_is_disabled: 0, servepos_show_on_website: 0,
  });
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [sortMode, setSortMode] = useState(false);
  const [sortedItems, setSortedItems] = useState<any[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const isAdminView = !profile || profile === "__all__";
  const activeProfile = isAdminView ? null : profile;

  // --- Admin fallback: direct doctype list ---
  const { data: adminMenuGroups } = useFrappeGetDocList("Item Group", {
    fields: ["name"],
    filters: [["is_group", "=", 0], ["name", "not in", ["All Item Groups", "Raw Material", "Sub Assemblies", "Consumable", "Services"]]],
    limit: 100,
  }, isAdminView ? undefined : null);

  const adminItemFilters: any[] = [["disabled", "=", 0]];
  const adminGroupNames = adminMenuGroups?.map((g) => g.name) || [];
  if (adminGroupNames.length > 0 && !activeGroup) adminItemFilters.push(["item_group", "in", adminGroupNames]);
  if (activeGroup) adminItemFilters.push(["item_group", "=", activeGroup]);
  if (search) adminItemFilters.push(["item_name", "like", `%${search}%`]);

  const { data: adminItems, mutate: refreshAdminItems } = useFrappeGetDocList("Item", {
    fields: ["name", "item_name", "item_code", "item_group", "standard_rate", "description", "image",
      "servepos_item_name_ar", "servepos_description_ar", "servepos_visible_profiles",
      "servepos_is_disabled", "servepos_show_on_website"],
    filters: adminItemFilters, limit: 200, orderBy: { field: "item_name", order: "asc" },
  }, isAdminView ? undefined : null);

  // --- Registry-backed path ---
  const { data: registryGroupsResp } = useFrappeGetCall(
    "servepos.api.registry.get_item_groups",
    activeProfile ? { pos_profile: activeProfile } : undefined,
    activeProfile ? undefined : null,
  );
  const { data: registryItemsResp, mutate: refreshRegistryItems } = useFrappeGetCall(
    "servepos.api.registry.get_items",
    activeProfile
      ? { pos_profile: activeProfile, item_group: activeGroup || undefined, search: search || undefined }
      : undefined,
    activeProfile ? undefined : null,
  );

  const menuGroupNames: string[] = isAdminView
    ? adminGroupNames
    : ((registryGroupsResp?.message as any[]) || []).map((g) => g.name);
  const items: any[] = isAdminView
    ? (adminItems || [])
    : ((registryItemsResp?.message as any[]) || []);
  // Availability map: { item_code: [{ pos_profile, show_on_pos, show_on_website }] }
  const { data: availMapResp, mutate: refreshAvailMap } = useFrappeGetCall(
    "servepos.api.registry.get_items_availability", undefined, undefined,
  );
  const availMap: Record<string, { pos_profile: string; show_on_pos: number; show_on_website: number }[]> =
    (availMapResp?.message as any) || {};

  const _refreshItems = isAdminView ? refreshAdminItems : refreshRegistryItems;
  const refreshItems = useCallback(() => { _refreshItems(); refreshAvailMap?.(); }, [_refreshItems, refreshAvailMap]);

  // Category sorting state
  const [sortCategoriesMode, setSortCategoriesMode] = useState(false);
  const [sortedCategories, setSortedCategories] = useState<string[]>([]);
  const dragCat = useRef<number | null>(null);
  const dragOverCat = useRef<number | null>(null);

  // Displayed items: when sort mode, use sortedItems; otherwise use items
  const displayItems = sortMode ? sortedItems : items;

  // Enter sort mode for items
  function enterSortMode() {
    if (!activeGroup || !activeProfile) return;
    const categoryItems = items.filter((i: any) => i.item_group === activeGroup);
    setSortedItems([...categoryItems]);
    setSortMode(true);
  }

  // Exit sort mode
  function exitSortMode() {
    setSortMode(false);
    setSortedItems([]);
  }

  // Drag handlers for items
  function handleDragStart(idx: number) { dragItem.current = idx; }
  function handleDragEnter(idx: number) { dragOverItem.current = idx; }
  function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const list = [...sortedItems];
    const [dragged] = list.splice(dragItem.current, 1);
    list.splice(dragOverItem.current, 0, dragged);
    setSortedItems(list);
    dragItem.current = null;
    dragOverItem.current = null;
  }

  // Save item sort order
  async function saveItemOrder() {
    if (!activeProfile || !activeGroup) return;
    setSavingOrder(true);
    try {
      const ordered = sortedItems.map((i: any) => i.name);
      await fetch("/api/method/servepos.api.registry.save_menu_item_order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
        body: JSON.stringify({ pos_profile: activeProfile, item_group: activeGroup, ordered_items: JSON.stringify(ordered) }),
      });
      refreshItems();
      setSortMode(false);
      setSortedItems([]);
    } catch (err: any) { alert(err.message || "Failed to save order"); }
    finally { setSavingOrder(false); }
  }

  // Enter category sort mode
  function enterCategorySortMode() {
    if (!activeProfile) return;
    setSortedCategories([...menuGroupNames]);
    setSortCategoriesMode(true);
  }

  // Drag handlers for categories
  function handleCatDragStart(idx: number) { dragCat.current = idx; }
  function handleCatDragEnter(idx: number) { dragOverCat.current = idx; }
  function handleCatDragEnd() {
    if (dragCat.current === null || dragOverCat.current === null) return;
    const list = [...sortedCategories];
    const [dragged] = list.splice(dragCat.current, 1);
    list.splice(dragOverCat.current, 0, dragged);
    setSortedCategories(list);
    dragCat.current = null;
    dragOverCat.current = null;
  }

  // Save category order
  async function saveCategoryOrder() {
    if (!activeProfile) return;
    setSavingOrder(true);
    try {
      await fetch("/api/method/servepos.api.registry.save_category_order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
        body: JSON.stringify({ pos_profile: activeProfile, ordered_categories: JSON.stringify(sortedCategories) }),
      });
      refreshItems();
      setSortCategoriesMode(false);
      setSortedCategories([]);
    } catch (err: any) { alert(err.message || "Failed to save order"); }
    finally { setSavingOrder(false); }
  }

  // --- Bulk edit ---
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [showBulkCategoryPicker, setShowBulkCategoryPicker] = useState(false);

  const bulkMode = selectedItems.size > 0;

  function toggleSelectItem(itemName: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemName)) next.delete(itemName);
      else next.add(itemName);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!displayItems) return;
    if (selectedItems.size === displayItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(displayItems.map((i: any) => i.name)));
    }
  }

  function clearSelection() { setSelectedItems(new Set()); }

  async function bulkToggleDisabled(disable: boolean) {
    setBulkActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedItems).map((name) =>
          updateDoc("Item", name, { servepos_is_disabled: disable ? 1 : 0 })
        )
      );
      clearSelection();
      refreshItems();
    } catch (err: any) { alert(err.message || "Failed to update items"); }
    finally { setBulkActionLoading(false); }
  }

  async function bulkToggleWebVisibility(show: boolean) {
    setBulkActionLoading(true);
    try {
      // For each selected item, fetch current availability rows and toggle web for the active profile
      for (const itemName of selectedItems) {
        if (activeProfile) {
          // Fetch current availability
          const res = await fetch(`/api/resource/Item/${encodeURIComponent(itemName)}?fields=["name","servepos_availability"]`);
          const data = await res.json();
          const rows: AvailabilityRow[] = (data.data?.servepos_availability || []).map((r: any) => ({
            branch: r.branch || "", pos_profile: r.pos_profile || "",
            show_on_pos: r.show_on_pos ?? 0, show_on_website: r.show_on_website ?? 0,
          }));
          const existing = rows.find((r) => r.pos_profile === activeProfile);
          let updatedRows: AvailabilityRow[];
          if (existing) {
            updatedRows = rows.map((r) =>
              r.pos_profile === activeProfile ? { ...r, show_on_website: show ? 1 : 0 } : r
            );
            // Remove row if both POS and Web are off
            updatedRows = updatedRows.filter((r) => r.show_on_pos || r.show_on_website);
          } else if (show) {
            const profileBranch = posProfiles?.find((p) => p.name === activeProfile)?.branch || "";
            updatedRows = [...rows, { branch: profileBranch, pos_profile: activeProfile, show_on_pos: 0, show_on_website: 1 }];
          } else {
            updatedRows = rows;
          }
          await updateDoc("Item", itemName, { servepos_availability: updatedRows });
        } else {
          // Admin view: toggle legacy field
          await updateDoc("Item", itemName, { servepos_show_on_website: show ? 1 : 0 });
        }
      }
      clearSelection();
      refreshItems();
    } catch (err: any) { alert(err.message || "Failed to update items"); }
    finally { setBulkActionLoading(false); }
  }

  async function bulkChangeCategory(newCategory: string) {
    setBulkActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedItems).map((name) =>
          updateDoc("Item", name, { item_group: newCategory })
        )
      );
      clearSelection();
      setShowBulkCategoryPicker(false);
      refreshItems();
    } catch (err: any) { alert(err.message || "Failed to update items"); }
    finally { setBulkActionLoading(false); }
  }

  // POS Profiles + Branches
  const { data: posProfiles } = useFrappeGetDocList("POS Profile", { fields: ["name", "branch"], limit: 50 });

  // Modifier groups
  const { data: allModifierGroups } = useFrappeGetDocList("ServePOS Modifier Group", {
    fields: ["name", "group_name"], limit: 100,
  });
  const [itemModifiers, setItemModifiers] = useState<{ modifier_group: string; is_required: number; display_order: number }[]>([]);

  const fetchItemModifiers = useCallback(async (itemName: string) => {
    try {
      const res = await fetch(`/api/resource/Item/${encodeURIComponent(itemName)}?fields=["name","servepos_modifier_groups"]`);
      const data = await res.json();
      if (data.data?.servepos_modifier_groups?.length) {
        setItemModifiers(data.data.servepos_modifier_groups.map((m: any) => ({
          modifier_group: m.modifier_group, is_required: m.is_required || 0, display_order: m.display_order || 0,
        })));
      } else {
        setItemModifiers([]);
      }
    } catch { setItemModifiers([]); }
  }, []);

  // Fetch availability rows when editing
  const fetchAvailability = useCallback(async (itemName: string) => {
    try {
      const res = await fetch(`/api/resource/Item/${encodeURIComponent(itemName)}?fields=["name","servepos_availability"]`);
      const data = await res.json();
      if (data.data?.servepos_availability?.length) {
        setAvailability(data.data.servepos_availability.map((r: any) => ({
          branch: r.branch || "", pos_profile: r.pos_profile || "",
          show_on_pos: r.show_on_pos ?? 1, show_on_website: r.show_on_website ?? 0,
        })));
      } else {
        setAvailability([]);
      }
    } catch { setAvailability([]); }
  }, []);

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function uploadImage(docname: string): Promise<string | null> {
    if (!imageFile) return null;
    const fd = new FormData();
    fd.append("file", imageFile);
    fd.append("doctype", "Item");
    fd.append("docname", docname);
    fd.append("fieldname", "image");
    fd.append("is_private", "0");
    const res = await fetch("/api/method/upload_file", { method: "POST", body: fd, headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" } });
    if (!res.ok) throw new Error("Image upload failed");
    const data = await res.json();
    return data.message?.file_url || null;
  }

  function resetForm() {
    const defaultVisible = profile && profile !== "__all__" ? profile : "";
    setFormData({
      item_code: "", item_name: "", item_group: "", standard_rate: 0,
      description: "", servepos_item_name_ar: "", servepos_description_ar: "",
      servepos_visible_profiles: defaultVisible, servepos_is_disabled: 0, servepos_show_on_website: 0,
    });
    setEditingItem(null);
    setShowForm(false);
    setItemModifiers([]);
    setAvailability([]);
    setImageFile(null);
    setImagePreview(null);
  }

  async function handleSave() {
    try {
      setUploadingImage(!!imageFile);
      if (editingItem) {
        const updateData: any = {
          item_name: formData.item_name, item_group: formData.item_group,
          standard_rate: formData.standard_rate, description: formData.description,
          servepos_visible_profiles: formData.servepos_visible_profiles,
          servepos_item_name_ar: formData.servepos_item_name_ar || "",
          servepos_description_ar: formData.servepos_description_ar || "",
          servepos_modifier_groups: itemModifiers,
          servepos_is_disabled: formData.servepos_is_disabled,
          servepos_show_on_website: formData.servepos_show_on_website,
          servepos_availability: availability,
        };
        await updateDoc("Item", editingItem, updateData);
        if (imageFile) {
          const imageUrl = await uploadImage(editingItem);
          if (imageUrl) await updateDoc("Item", editingItem, { image: imageUrl });
        }
      } else {
        const itemCode = formData.item_code || formData.item_name.toUpperCase().replace(/\s+/g, "-").slice(0, 20);
        const doc = await createDoc("Item", {
          item_code: itemCode, item_name: formData.item_name, item_group: formData.item_group,
          standard_rate: formData.standard_rate, description: formData.description, stock_uom: "Nos", is_stock_item: 0,
          servepos_item_name_ar: formData.servepos_item_name_ar || "",
          servepos_description_ar: formData.servepos_description_ar || "",
          servepos_is_available: 1,
          servepos_visible_profiles: formData.servepos_visible_profiles || "",
          servepos_is_disabled: formData.servepos_is_disabled,
          servepos_show_on_website: formData.servepos_show_on_website,
          servepos_availability: availability,
        });
        if (imageFile && doc?.name) {
          const imageUrl = await uploadImage(doc.name);
          if (imageUrl) await updateDoc("Item", doc.name, { image: imageUrl });
        }
      }
      resetForm(); refreshItems();
    } catch (err: any) { alert(err.message || "Failed to save"); } finally { setUploadingImage(false); }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    try {
      await createDoc("Item Group", { item_group_name: newCategoryName.trim(), parent_item_group: "All Item Groups", servepos_is_menu_group: 1 });
      setNewCategoryName(""); setShowCategoryForm(false); window.location.reload();
    } catch (err: any) { alert(err.message || "Failed to create category"); }
  }

  async function handleDeleteCategory(name: string) {
    if (!confirm(`Delete category "${name}"? Items in this category will need to be reassigned.`)) return;
    try { await deleteDoc("Item Group", name); window.location.reload(); } catch (err: any) { alert(err.message); }
  }

  async function toggleDisabled(item: any, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await updateDoc("Item", item.name, { servepos_is_disabled: item.servepos_is_disabled ? 0 : 1 });
      refreshItems();
    } catch (err: any) { alert(err.message || "Failed to update"); }
  }


  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Menu Items</h1>
          <p className="text-sm text-gray-500">{items?.length || 0} items</p>
        </div>
        <div className="flex gap-2">
          {activeProfile && !sortMode && !sortCategoriesMode && (
            <button onClick={enterCategorySortMode}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
              title="Reorder categories">
              <ArrowUpDown className="h-3.5 w-3.5" /> Sort categories
            </button>
          )}
          <button onClick={() => setShowCategoryForm(true)}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            <FolderPlus className="h-3.5 w-3.5" /> Add category
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800">
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..."
            className="w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-8 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>}
        </div>
      </div>

      {/* Category form */}
      {showCategoryForm && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
          <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)}
            className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" placeholder="Category name (e.g., Desserts)" autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()} />
          <button onClick={handleCreateCategory} className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">Create</button>
          <button onClick={() => { setShowCategoryForm(false); setNewCategoryName(""); }} className="rounded-md px-2 py-1.5 text-[12px] text-gray-400 hover:bg-gray-100">Cancel</button>
        </div>
      )}

      {/* Categories — sort mode */}
      {sortCategoriesMode ? (
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-medium text-amber-700">Drag categories to reorder</p>
            <div className="flex gap-2">
              <button onClick={() => { setSortCategoriesMode(false); setSortedCategories([]); }}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={saveCategoryOrder} disabled={savingOrder}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800 disabled:opacity-40">
                {savingOrder ? "Saving..." : "Save order"}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {sortedCategories.map((g, idx) => (
              <div key={g}
                draggable
                onDragStart={() => handleCatDragStart(idx)}
                onDragEnter={() => handleCatDragEnter(idx)}
                onDragEnd={handleCatDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 cursor-grab active:cursor-grabbing hover:bg-gray-50">
                <GripVertical className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-[12px] font-medium text-gray-700">{g}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => { setActiveGroup(null); exitSortMode(); }}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium ${!activeGroup ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>All</button>
          {menuGroupNames.map((g) => (
            <div key={g} className="group relative">
              <button onClick={() => { setActiveGroup(g); exitSortMode(); }}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 pr-6 text-[12px] font-medium ${activeGroup === g ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{g}</button>
              <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(g); }}
                className="absolute right-1 top-1/2 -translate-y-1/2 hidden rounded p-0.5 text-gray-400 hover:text-red-500 group-hover:block"
                title="Delete category">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sort mode bar */}
      {sortMode && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-[12px] font-medium text-amber-700">Drag items to reorder within "{activeGroup}"</p>
          <div className="flex gap-2">
            <button onClick={exitSortMode}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={saveItemOrder} disabled={savingOrder}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800 disabled:opacity-40">
              {savingOrder ? "Saving..." : "Save order"}
            </button>
          </div>
        </div>
      )}

      {/* Sort items button — show when a category is selected + profile is active */}
      {!sortMode && !sortCategoriesMode && activeGroup && activeProfile && (
        <div className="mb-3">
          <button onClick={enterSortMode}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
            <ArrowUpDown className="h-3.5 w-3.5" /> Sort items in this category
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {sortMode && <th className="px-2 py-2.5 w-8"></th>}
              {!sortMode && (
                <th className="pl-4 pr-1 py-2.5 w-8">
                  <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-600">
                    {displayItems && selectedItems.size === displayItems.length && displayItems.length > 0
                      ? <CheckSquare className="h-4 w-4 text-gray-900" />
                      : <Square className="h-4 w-4" />}
                  </button>
                </th>
              )}
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Item</th>
              {!sortMode && <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Category</th>}
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              {!sortMode && <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Web</th>}
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Price</th>
              {!sortMode && <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {displayItems?.map((item, idx) => {
              const isDisabled = item.servepos_is_disabled === 1;
              return (
                <tr key={item.name}
                  draggable={sortMode}
                  onDragStart={sortMode ? () => handleDragStart(idx) : undefined}
                  onDragEnter={sortMode ? () => handleDragEnter(idx) : undefined}
                  onDragEnd={sortMode ? handleDragEnd : undefined}
                  onDragOver={sortMode ? (e) => e.preventDefault() : undefined}
                  className={`border-b border-gray-100 transition-colors ${sortMode ? "cursor-grab active:cursor-grabbing hover:bg-amber-50" : "hover:bg-gray-50"} ${isDisabled ? "opacity-50" : ""} ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                  {sortMode && (
                    <td className="px-2 py-3">
                      <GripVertical className="h-4 w-4 text-gray-400" />
                    </td>
                  )}
                  {!sortMode && (
                    <td className="pl-4 pr-1 py-3 w-8">
                      <button onClick={(e) => { e.stopPropagation(); toggleSelectItem(item.name); }} className="text-gray-400 hover:text-gray-600">
                        {selectedItems.has(item.name)
                          ? <CheckSquare className="h-4 w-4 text-gray-900" />
                          : <Square className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.image ? (
                        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-gray-100"><img src={item.image} className="h-full w-full object-cover" /></div>
                      ) : (
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-[13px] font-bold text-gray-400">{item.item_name?.charAt(0)}</div>
                      )}
                      <div className="min-w-0">
                        <p className={`text-[13px] font-medium truncate ${isDisabled ? "text-gray-400 line-through" : "text-gray-900"}`}>{item.item_name}</p>
                        {item.servepos_item_name_ar && <p className="text-[11px] text-gray-400 truncate" dir="rtl">{item.servepos_item_name_ar}</p>}
                      </div>
                    </div>
                  </td>
                  {!sortMode && <td className="px-4 py-3"><span className="text-[12px] text-gray-500">{item.item_group}</span></td>}
                  <td className="px-4 py-3 text-center">
                    {isDisabled ? (
                      <button onClick={(e) => toggleDisabled(item, e)}
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-100" title="Click to enable">
                        <Ban className="h-3 w-3" /> Disabled
                      </button>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Active</span>
                    )}
                  </td>
                  {!sortMode && (
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        // Check web visibility for this item
                        const rows = availMap[item.name];
                        let webOn = false;
                        if (rows && rows.length > 0) {
                          if (activeProfile) {
                            const row = rows.find((r) => r.pos_profile === activeProfile);
                            webOn = row ? row.show_on_website === 1 : false;
                          } else {
                            webOn = rows.some((r) => r.show_on_website === 1);
                          }
                        } else {
                          // Legacy fallback
                          webOn = item.servepos_show_on_website === 1;
                        }
                        return webOn
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600"><Eye className="h-3 w-3" /> Visible</span>
                          : <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400"><EyeOff className="h-3 w-3" /> Hidden</span>;
                      })()}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right"><span className="text-[13px] font-semibold text-gray-900">{(item.standard_rate || 0).toFixed(2)}</span></td>
                  {!sortMode && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => {
                          setEditingItem(item.name);
                          setFormData({
                            item_code: item.name, item_name: item.item_name, item_group: item.item_group,
                            standard_rate: item.standard_rate || 0, description: item.description || "",
                            servepos_item_name_ar: item.servepos_item_name_ar || "",
                            servepos_description_ar: item.servepos_description_ar || "",
                            servepos_visible_profiles: item.servepos_visible_profiles || "",
                            servepos_is_disabled: item.servepos_is_disabled || 0,
                            servepos_show_on_website: item.servepos_show_on_website || 0,
                          });
                          fetchItemModifiers(item.name);
                          fetchAvailability(item.name);
                          setShowForm(true);
                        }}
                          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><Edit3 className="h-3.5 w-3.5" /></button>
                        <button onClick={async () => { if (confirm("Delete?")) { await deleteDoc("Item", item.name); refreshItems(); } }}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {(!displayItems || displayItems.length === 0) && (
          <div className="py-12 text-center text-sm text-gray-400">
            {menuGroupNames.length === 0 ? "Mark item groups as menu groups in ERPNext to see items here" : "No items found"}
          </div>
        )}
      </div>

      {/* Bulk Action Bar */}
      {bulkMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center pb-6 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-xl">
            <span className="text-[13px] font-semibold text-gray-900">{selectedItems.size} selected</span>
            <div className="h-5 w-px bg-gray-200" />
            <button onClick={() => setShowBulkCategoryPicker(true)} disabled={bulkActionLoading}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              <FolderInput className="h-3.5 w-3.5" /> Move to category
            </button>
            <button onClick={() => bulkToggleDisabled(true)} disabled={bulkActionLoading}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
              <Ban className="h-3.5 w-3.5" /> Disable
            </button>
            <button onClick={() => bulkToggleDisabled(false)} disabled={bulkActionLoading}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-40">
              <CheckSquare className="h-3.5 w-3.5" /> Enable
            </button>
            <button onClick={() => bulkToggleWebVisibility(true)} disabled={bulkActionLoading}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40">
              <Eye className="h-3.5 w-3.5" /> Show on web
            </button>
            <button onClick={() => bulkToggleWebVisibility(false)} disabled={bulkActionLoading}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              <EyeOff className="h-3.5 w-3.5" /> Hide from web
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <button onClick={clearSelection}
              className="rounded-md px-2 py-1.5 text-[12px] text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk Category Picker Modal */}
      {showBulkCategoryPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBulkCategoryPicker(false)}>
          <div className="w-[320px] rounded-lg border border-gray-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h3 className="text-[14px] font-semibold text-gray-900">Move {selectedItems.size} items to...</h3>
              <button onClick={() => setShowBulkCategoryPicker(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2">
              {menuGroupNames.map((g) => (
                <button key={g} onClick={() => bulkChangeCategory(g)} disabled={bulkActionLoading}
                  className="w-full rounded-md px-3 py-2.5 text-left text-[13px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40">
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]">
          <div className="w-[640px] max-h-[80vh] flex flex-col rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5 flex-shrink-0">
              <h2 className="text-[14px] font-semibold text-gray-900">{editingItem ? "Edit item" : "Add new item"}</h2>
              <button onClick={resetForm} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4 overflow-y-auto flex-1">
              {/* Disabled + Website toggles */}
              <div className="flex items-center gap-4 rounded-md border border-gray-200 px-3 py-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.servepos_is_disabled === 1}
                    onChange={() => setFormData({ ...formData, servepos_is_disabled: formData.servepos_is_disabled ? 0 : 1 })}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                  <span className="flex items-center gap-1 text-[12px] font-medium text-gray-700">
                    <Ban className="h-3 w-3" /> Disabled
                  </span>
                </label>
              </div>
              {formData.servepos_is_disabled === 1 && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  This item is disabled and will not appear on any POS terminal or online store.
                </div>
              )}

              {/* Image Upload */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-gray-600">Image</label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                {imagePreview || (editingItem && items?.find(i => i.name === editingItem)?.image) ? (
                  <div className="relative group w-24 h-24">
                    <img src={imagePreview || items?.find(i => i.name === editingItem)?.image} className="h-24 w-24 rounded-lg object-cover border border-gray-200" />
                    <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-md bg-white/90 p-1.5 text-gray-700 hover:bg-white"><Edit3 className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => { setImageFile(null); setImagePreview(null); if (editingItem) { updateDoc("Item", editingItem, { image: "" }).then(() => refreshItems()); } }} className="rounded-md bg-white/90 p-1.5 text-red-500 hover:bg-white"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="flex h-24 w-24 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors">
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-[10px] font-medium">Add image</span>
                  </button>
                )}
              </div>
              {!editingItem && (
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600">Item Code</label>
                  <input type="text" value={formData.item_code} onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" placeholder="Auto-generated if empty" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600">Name (English) *</label>
                  <input type="text" value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" autoFocus />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600">Name (Arabic)</label>
                  <input type="text" value={formData.servepos_item_name_ar} onChange={(e) => setFormData({ ...formData, servepos_item_name_ar: e.target.value })}
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-right text-[13px] focus:border-gray-400 focus:outline-none" dir="rtl" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600">Category *</label>
                  <select value={formData.item_group} onChange={(e) => {
                      if (e.target.value === "__new__") {
                        const name = prompt("Enter new category name:");
                        if (name && name.trim()) {
                          createDoc("Item Group", { item_group_name: name.trim(), parent_item_group: "All Item Groups", servepos_is_menu_group: 1 })
                            .then(() => { setFormData({ ...formData, item_group: name.trim() }); window.location.reload(); })
                            .catch((err: any) => alert(err.message));
                        }
                      } else {
                        setFormData({ ...formData, item_group: e.target.value });
                      }
                    }}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none">
                    <option value="">Select category...</option>
                    {menuGroupNames.map((g) => <option key={g} value={g}>{g}</option>)}
                    <option value="__new__">+ Create new category</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600">Price *</label>
                  <input type="number" value={formData.standard_rate || ""} onChange={(e) => setFormData({ ...formData, standard_rate: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" min={0} step={0.5} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-gray-600">Description</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" rows={2} />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-gray-600">Description (Arabic)</label>
                <textarea value={formData.servepos_description_ar} onChange={(e) => setFormData({ ...formData, servepos_description_ar: e.target.value })}
                  className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-right text-[13px] focus:border-gray-400 focus:outline-none" rows={2} dir="rtl" />
              </div>

              {/* Modifier Group Assignments */}
              {editingItem && allModifierGroups && allModifierGroups.length > 0 && (
                <div>
                  <label className="mb-2 block text-[12px] font-medium text-gray-600">Modifier Groups</label>
                  <div className="space-y-1.5">
                    {allModifierGroups.map((mg) => {
                      const assigned = itemModifiers.find((m) => m.modifier_group === mg.name);
                      return (
                        <label key={mg.name} className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-gray-50">
                          <input type="checkbox" checked={!!assigned}
                            onChange={() => {
                              if (assigned) setItemModifiers(itemModifiers.filter((m) => m.modifier_group !== mg.name));
                              else setItemModifiers([...itemModifiers, { modifier_group: mg.name, is_required: 0, display_order: itemModifiers.length }]);
                            }}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
                          <span className="text-[13px] text-gray-800">{mg.group_name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Where to display */}
              {posProfiles && posProfiles.length > 0 && (
                <div>
                  <label className="mb-2 block text-[12px] font-medium text-gray-600">Where to display</label>
                  <div className="rounded-md border border-gray-200 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center bg-gray-50 px-3 py-2 border-b border-gray-200">
                      <span className="flex-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Profile</span>
                      <span className="w-12 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">POS</span>
                      <span className="w-12 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Web</span>
                    </div>
                    {/* Rows */}
                    <div className="divide-y divide-gray-100">
                      {(posProfiles || []).map((p) => {
                        const row = availability.find(r => r.pos_profile === p.name);
                        const posOn = row ? row.show_on_pos === 1 : false;
                        const webOn = row ? row.show_on_website === 1 : false;

                        const toggle = (channel: "pos" | "web") => {
                          const isPosToggle = channel === "pos";
                          const currentVal = isPosToggle ? posOn : webOn;
                          if (row) {
                            const newPos = isPosToggle ? (currentVal ? 0 : 1) : row.show_on_pos;
                            const newWeb = isPosToggle ? row.show_on_website : (currentVal ? 0 : 1);
                            if (newPos === 0 && newWeb === 0) {
                              setAvailability(availability.filter(r => r.pos_profile !== p.name));
                            } else {
                              setAvailability(availability.map(r =>
                                r.pos_profile === p.name ? { ...r, show_on_pos: newPos, show_on_website: newWeb } : r
                              ));
                            }
                          } else {
                            setAvailability([...availability, {
                              branch: p.branch || "", pos_profile: p.name,
                              show_on_pos: isPosToggle ? 1 : 0,
                              show_on_website: isPosToggle ? 0 : 1,
                            }]);
                          }
                        };

                        return (
                          <div key={p.name} className="flex items-center px-3 py-2.5 hover:bg-gray-50">
                            <div className="flex-1 min-w-0">
                              <span className="text-[13px] font-medium text-gray-800">{p.name}</span>
                              {p.branch && <span className="ml-2 text-[11px] text-gray-400">{p.branch}</span>}
                            </div>
                            <div className="w-12 flex justify-center">
                              <input type="checkbox" checked={posOn} onChange={() => toggle("pos")}
                                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500 cursor-pointer" />
                            </div>
                            <div className="w-12 flex justify-center">
                              <input type="checkbox" checked={webOn} onChange={() => toggle("web")}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-gray-200 px-5 py-3 flex-shrink-0">
              <button onClick={resetForm} className="flex-1 rounded-md border border-gray-200 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={!formData.item_name || !formData.item_group || uploadingImage}
                className="flex-1 rounded-md bg-gray-900 py-2 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-40">{uploadingImage ? "Uploading..." : editingItem ? "Update" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
