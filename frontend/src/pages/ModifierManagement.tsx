import { useState } from "react";
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc, useFrappeGetDoc } from "frappe-react-sdk";
import { Plus, Trash2, Edit3, X, ChevronDown, ChevronRight } from "lucide-react";

export default function ModifierManagement() {
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [selType, setSelType] = useState("Single");
  const [isRequired, setIsRequired] = useState(false);
  const [maxSel, setMaxSel] = useState(0);

  const { data: groups, mutate: refreshGroups } = useFrappeGetDocList("ServePOS Modifier Group", {
    fields: ["name", "group_name", "selection_type", "is_required", "max_selections"],
    limit: 100, orderBy: { field: "group_name", order: "asc" },
  });

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  function resetForm() { setShowGroupForm(false); setEditingGroup(null); setGroupName(""); setSelType("Single"); setIsRequired(false); setMaxSel(0); }

  async function handleSaveGroup() {
    if (!groupName.trim()) return;
    try {
      if (editingGroup) await updateDoc("ServePOS Modifier Group", editingGroup, { group_name: groupName, selection_type: selType, is_required: isRequired ? 1 : 0, max_selections: maxSel });
      else await createDoc("ServePOS Modifier Group", { group_name: groupName, selection_type: selType, is_required: isRequired ? 1 : 0, max_selections: maxSel });
      resetForm(); refreshGroups();
    } catch (err: any) { alert(err.message || "Failed to save"); }
  }

  async function handleDeleteGroup(name: string) {
    if (!confirm("Delete this modifier group and all its options?")) return;
    try { await deleteDoc("ServePOS Modifier Group", name); refreshGroups(); } catch (err: any) { alert(err.message); }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Modifiers</h1>
          <p className="text-sm text-gray-500">{groups?.length || 0} groups</p>
        </div>
        <button onClick={() => { resetForm(); setShowGroupForm(true); }}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800">
          <Plus className="h-3.5 w-3.5" /> Add group
        </button>
      </div>

      {showGroupForm && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 text-[13px] font-semibold text-gray-700">{editingGroup ? "Edit group" : "New modifier group"}</div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Name</label>
              <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none" placeholder="e.g., Spice Level" autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Type</label>
              <select value={selType} onChange={(e) => setSelType(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none">
                <option value="Single">Single choice</option>
                <option value="Multiple">Multiple choice</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-[13px]">
                <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="rounded" /> Required
              </label>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={resetForm} className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={handleSaveGroup} className="rounded-md bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">{editingGroup ? "Update" : "Create"}</button>
          </div>
        </div>
      )}

      {(!groups || groups.length === 0) && !showGroupForm && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center">
          <p className="text-sm text-gray-500">No modifier groups yet</p>
          <p className="mt-1 text-[12px] text-gray-400">Create groups like "Spice Level", "Size", "Add-ons"</p>
        </div>
      )}

      <div className="space-y-3">
        {groups?.map((group) => (
          <GroupCard key={group.name} group={group}
            onEdit={() => { setEditingGroup(group.name); setGroupName(group.group_name); setSelType(group.selection_type); setIsRequired(!!group.is_required); setMaxSel(group.max_selections || 0); setShowGroupForm(true); }}
            onDelete={() => handleDeleteGroup(group.name)} onRefresh={refreshGroups} />
        ))}
      </div>
    </div>
  );
}

function GroupCard({ group, onEdit, onDelete, onRefresh }: { group: any; onEdit: () => void; onDelete: () => void; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [modName, setModName] = useState("");
  const [modPrice, setModPrice] = useState(0);
  const [editingPrice, setEditingPrice] = useState<number | null>(null);
  const [editPriceValue, setEditPriceValue] = useState(0);
  const [editingName, setEditingName] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  const { data: fullGroup, mutate: refreshGroup } = useFrappeGetDoc("ServePOS Modifier Group", group.name);
  const { updateDoc } = useFrappeUpdateDoc();
  const modifiers = (fullGroup as any)?.modifiers || [];

  async function addModifier() {
    if (!modName.trim()) return;
    try {
      await updateDoc("ServePOS Modifier Group", group.name, {
        modifiers: [...modifiers.map((m: any) => ({ modifier_name: m.modifier_name, price: m.price, is_default: m.is_default })),
          { modifier_name: modName, price: modPrice, is_default: 0 }],
      });
      setModName(""); setModPrice(0); setAdding(false); refreshGroup(); onRefresh();
    } catch (err: any) { alert(err.message); }
  }

  async function deleteModifier(idx: number) {
    try {
      await updateDoc("ServePOS Modifier Group", group.name, {
        modifiers: modifiers.filter((_: any, i: number) => i !== idx).map((m: any) => ({ modifier_name: m.modifier_name, price: m.price, is_default: m.is_default })),
      });
      refreshGroup(); onRefresh();
    } catch (err: any) { alert(err.message); }
  }

  async function saveModifierPrice(idx: number) {
    try {
      const updated = modifiers.map((m: any, i: number) => ({
        modifier_name: m.modifier_name,
        price: i === idx ? editPriceValue : m.price,
        is_default: m.is_default,
      }));
      await updateDoc("ServePOS Modifier Group", group.name, { modifiers: updated });
      setEditingPrice(null);
      refreshGroup(); onRefresh();
    } catch (err: any) { alert(err.message); }
  }

  async function saveModifierName(idx: number) {
    if (!editNameValue.trim()) return;
    try {
      const updated = modifiers.map((m: any, i: number) => ({
        modifier_name: i === idx ? editNameValue : m.modifier_name,
        price: m.price,
        is_default: m.is_default,
      }));
      await updateDoc("ServePOS Modifier Group", group.name, { modifiers: updated });
      setEditingName(null);
      refreshGroup(); onRefresh();
    } catch (err: any) { alert(err.message); }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
          <span className="text-[13px] font-semibold text-gray-900">{group.group_name}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{group.selection_type}</span>
          {group.is_required ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">Required</span> : null}
          <span className="text-[11px] text-gray-400">{modifiers.length} option{modifiers.length !== 1 ? "s" : ""}</span>
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => setAdding(!adding)} className="rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100">+ Add option</button>
          <button onClick={onEdit} className="rounded p-1.5 text-gray-400 hover:bg-gray-100"><Edit3 className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {expanded && (
        <>
          {adding && (
            <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
              <input type="text" value={modName} onChange={(e) => setModName(e.target.value)} placeholder="Option name"
                className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[13px] focus:border-gray-400 focus:outline-none" autoFocus />
              <input type="number" value={modPrice || ""} onChange={(e) => setModPrice(parseFloat(e.target.value) || 0)} placeholder="0"
                className="w-24 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[13px] text-right focus:border-gray-400 focus:outline-none" min={0} step={0.5} />
              <button onClick={addModifier} className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">Add</button>
              <button onClick={() => { setAdding(false); setModName(""); setModPrice(0); }} className="rounded-md px-2 py-1.5 text-[12px] text-gray-400 hover:bg-gray-100">Cancel</button>
            </div>
          )}

          {modifiers.length > 0 ? (
            <table className="w-full">
              <tbody>
                {modifiers.map((mod: any, idx: number) => (
                  <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 pl-10 text-[13px] text-gray-700">
                      {editingName === idx ? (
                        <input
                          type="text"
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          onBlur={() => saveModifierName(idx)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveModifierName(idx); if (e.key === "Escape") setEditingName(null); }}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[13px] focus:border-gray-400 focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingName(idx); setEditNameValue(mod.modifier_name); }}
                          className="cursor-pointer rounded px-1 py-0.5 hover:bg-gray-100"
                          title="Click to edit name"
                        >
                          {mod.modifier_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] font-medium">
                      {editingPrice === idx ? (
                        <input
                          type="number"
                          value={editPriceValue}
                          onChange={(e) => setEditPriceValue(parseFloat(e.target.value) || 0)}
                          onBlur={() => saveModifierPrice(idx)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveModifierPrice(idx); if (e.key === "Escape") setEditingPrice(null); }}
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-[13px] focus:border-gray-400 focus:outline-none"
                          min={0}
                          step={0.5}
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingPrice(idx); setEditPriceValue(mod.price || 0); }}
                          className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-gray-100"
                          title="Click to edit price"
                        >
                          {mod.price > 0 ? <span className="text-green-600">+{mod.price.toFixed(2)}</span> : <span className="text-gray-400">Free</span>}
                        </span>
                      )}
                    </td>
                    <td className="w-10 px-2 py-2.5 text-right">
                      <button onClick={() => deleteModifier(idx)} className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="border-t border-gray-100 px-4 py-4 text-center text-[12px] text-gray-400">No options yet</div>
          )}
        </>
      )}
    </div>
  );
}
