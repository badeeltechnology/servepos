import { useState, useCallback, useRef } from "react";
import { useFrappeGetDocList, useFrappeGetCall, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Plus, Search, Edit3, Trash2, X, Eye, EyeOff, FolderPlus, ImagePlus } from "lucide-react";

export default function MenuManagement() {
  const { profile } = useProfile();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [formData, setFormData] = useState({ item_code: "", item_name: "", item_group: "", standard_rate: 0, description: "", servepos_item_name_ar: "", servepos_description_ar: "", servepos_visible_profiles: "" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Admin ("__all__") view shows everything unfiltered; otherwise use the
  // centralized registry API that enforces POS Profile filtering server-side.
  const isAdminView = !profile || profile === "__all__";
  const activeProfile = isAdminView ? null : profile;

  // --- Admin fallback: direct doctype list (only when viewing all profiles) ---
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
    fields: ["name", "item_name", "item_code", "item_group", "standard_rate", "description", "image", "servepos_item_name_ar", "servepos_description_ar", "servepos_visible_profiles"],
    filters: adminItemFilters, limit: 200, orderBy: { field: "item_name", order: "asc" },
  }, isAdminView ? undefined : null);

  // --- Registry-backed path: filtered by the selected POS Profile ---
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
  const refreshItems = isAdminView ? refreshAdminItems : refreshRegistryItems;

  // POS Profiles for visibility (used only in the edit dialog)
  const { data: posProfiles } = useFrappeGetDocList("POS Profile", { fields: ["name", "branch"], limit: 50 });

  // Modifier groups
  const { data: allModifierGroups } = useFrappeGetDocList("ServePOS Modifier Group", {
    fields: ["name", "group_name"], limit: 100,
  });
  const [itemModifiers, setItemModifiers] = useState<{ modifier_group: string; is_required: number; display_order: number }[]>([]);

  // Fetch item's modifier assignments when editing
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
    // New items default to the currently selected POS Profile. If "All
    // Profiles" is active, leave empty (= visible everywhere).
    const defaultVisible = profile && profile !== "__all__" ? profile : "";
    setFormData({ item_code: "", item_name: "", item_group: "", standard_rate: 0, description: "", servepos_item_name_ar: "", servepos_description_ar: "", servepos_visible_profiles: defaultVisible });
    setEditingItem(null);
    setShowForm(false);
    setItemModifiers([]);
    setImageFile(null);
    setImagePreview(null);
  }

  async function handleSave() {
    try {
      setUploadingImage(!!imageFile);
      if (editingItem) {
        const updateData: any = { item_name: formData.item_name, item_group: formData.item_group, standard_rate: formData.standard_rate, description: formData.description, servepos_visible_profiles: formData.servepos_visible_profiles, servepos_item_name_ar: formData.servepos_item_name_ar || "", servepos_description_ar: formData.servepos_description_ar || "", servepos_modifier_groups: itemModifiers };
        await updateDoc("Item", editingItem, updateData);
        if (imageFile) {
          const imageUrl = await uploadImage(editingItem);
          if (imageUrl) await updateDoc("Item", editingItem, { image: imageUrl });
        }
      } else {
        const itemCode = formData.item_code || formData.item_name.toUpperCase().replace(/\s+/g, "-").slice(0, 20);
        const doc = await createDoc("Item", {
          item_code: itemCode,
          item_name: formData.item_name,
          item_group: formData.item_group,
          standard_rate: formData.standard_rate,
          description: formData.description,
          stock_uom: "Nos",
          is_stock_item: 0,
          servepos_item_name_ar: formData.servepos_item_name_ar || "",
          servepos_description_ar: formData.servepos_description_ar || "",
          servepos_is_available: 1,
          servepos_visible_profiles: formData.servepos_visible_profiles || "",
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
      await createDoc("Item Group", {
        item_group_name: newCategoryName.trim(),
        parent_item_group: "All Item Groups",
        servepos_is_menu_group: 1,
      });
      setNewCategoryName("");
      setShowCategoryForm(false);
      // Refresh menu groups
      window.location.reload();
    } catch (err: any) { alert(err.message || "Failed to create category"); }
  }

  async function handleDeleteCategory(name: string) {
    if (!confirm(`Delete category "${name}"? Items in this category will need to be reassigned.`)) return;
    try { await deleteDoc("Item Group", name); window.location.reload(); } catch (err: any) { alert(err.message); }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Menu Items</h1>
          <p className="text-sm text-gray-500">{items?.length || 0} items</p>
        </div>
        <div className="flex gap-2">
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

      {/* Categories */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setActiveGroup(null)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium ${!activeGroup ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>All</button>
        {menuGroupNames.map((g) => (
          <div key={g} className="group relative">
            <button onClick={() => setActiveGroup(g)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 pr-6 text-[12px] font-medium ${activeGroup === g ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{g}</button>
            <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(g); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 hidden rounded p-0.5 text-gray-400 hover:text-red-500 group-hover:block"
              title="Delete category">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Item</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Category</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Price</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-20"></th>
            </tr>
          </thead>
          <tbody>
            {items?.map((item, idx) => (
              <tr key={item.name} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {item.image ? (
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-gray-100"><img src={item.image} className="h-full w-full object-cover" /></div>
                    ) : (
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-[13px] font-bold text-gray-400">{item.item_name?.charAt(0)}</div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{item.item_name}</p>
                      {item.servepos_item_name_ar && <p className="text-[11px] text-gray-400 truncate" dir="rtl">{item.servepos_item_name_ar}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><span className="text-[12px] text-gray-500">{item.item_group}</span></td>
                <td className="px-4 py-3 text-right"><span className="text-[13px] font-semibold text-gray-900">{(item.standard_rate || 0).toFixed(2)}</span></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => { setEditingItem(item.name); setFormData({ item_code: item.name, item_name: item.item_name, item_group: item.item_group, standard_rate: item.standard_rate || 0, description: item.description || "", servepos_item_name_ar: item.servepos_item_name_ar || "", servepos_description_ar: item.servepos_description_ar || "", servepos_visible_profiles: item.servepos_visible_profiles || "" }); fetchItemModifiers(item.name); setShowForm(true); }}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><Edit3 className="h-3.5 w-3.5" /></button>
                    <button onClick={async () => { if (confirm("Delete?")) { await deleteDoc("Item", item.name); refreshItems(); } }}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!items || items.length === 0) && (
          <div className="py-12 text-center text-sm text-gray-400">
            {menuGroupNames.length === 0 ? "Mark item groups as menu groups in ERPNext to see items here" : "No items found"}
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]">
          <div className="w-[520px] max-h-[80vh] flex flex-col rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5 flex-shrink-0">
              <h2 className="text-[14px] font-semibold text-gray-900">{editingItem ? "Edit item" : "Add new item"}</h2>
              <button onClick={resetForm} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4 overflow-y-auto flex-1">
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
              {/* Modifier Group Assignments — shown when editing */}
              {editingItem && allModifierGroups && allModifierGroups.length > 0 && (
                <div>
                  <label className="mb-2 block text-[12px] font-medium text-gray-600">Modifier Groups</label>
                  <div className="space-y-1.5">
                    {allModifierGroups.map((mg) => {
                      const assigned = itemModifiers.find((m) => m.modifier_group === mg.name);
                      return (
                        <label key={mg.name} className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={!!assigned}
                            onChange={() => {
                              if (assigned) {
                                setItemModifiers(itemModifiers.filter((m) => m.modifier_group !== mg.name));
                              } else {
                                setItemModifiers([...itemModifiers, { modifier_group: mg.name, is_required: 0, display_order: itemModifiers.length }]);
                              }
                            }}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                          />
                          <span className="text-[13px] text-gray-800">{mg.group_name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* POS Profile Visibility — always shown so both new and
                  existing items can be scoped per profile. */}
              {posProfiles && posProfiles.length > 0 && (
                <div>
                  <label className="mb-2 block text-[12px] font-medium text-gray-600">Visible on POS Profiles</label>
                  <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
                    {posProfiles.map((p) => {
                      const raw = (formData.servepos_visible_profiles || "").trim();
                      const visibleList = raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
                      // Empty means visible on every profile (legacy default).
                      const isVisible = !raw || visibleList.includes(p.name);
                      return (
                        <label key={p.name} className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isVisible}
                              onChange={() => {
                                const allNames = posProfiles.map(pp => pp.name);
                                // If currently "visible everywhere" (empty),
                                // expand to all profile names before we
                                // remove a single one. Never write an empty
                                // string afterwards — always an explicit
                                // comma list so Frappe's REST API keeps it.
                                let list = raw
                                  ? raw.split(",").map(s => s.trim()).filter(Boolean)
                                  : [...allNames];
                                if (isVisible) list = list.filter(n => n !== p.name);
                                else if (!list.includes(p.name)) list.push(p.name);
                                // Preserve stable order matching posProfiles list.
                                const ordered = allNames.filter(n => list.includes(n));
                                setFormData({ ...formData, servepos_visible_profiles: ordered.join(",") });
                              }}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                            />
                            <div>
                              <span className="text-[13px] font-medium text-gray-800">{p.name}</span>
                              {p.branch && <span className="ml-2 text-[11px] text-gray-400">{p.branch}</span>}
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isVisible ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                            {isVisible ? "Visible" : "Hidden"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    Tick the profiles where this item should appear. Untick all to hide it everywhere (use the visibility page for emergency 86'ing).
                  </p>
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
