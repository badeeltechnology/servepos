import { useState } from "react";
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Plus, Trash2, Edit3, X, Users, QrCode } from "lucide-react";
import { QRGenerator, BulkQRGenerator } from "@/components/QRGenerator";

export default function RestaurantSetup() {
  const { profile, profileData } = useProfile();
  const [activeTab, setActiveTab] = useState<"rooms" | "tables">("tables");

  const branch = (profileData as any)?.branch || "";

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900">Tables & Rooms</h1>
        <p className="text-sm text-gray-500">
          {profile === "__all__" ? "All restaurants" : profile}
          {branch && ` · ${branch}`}
        </p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["tables", "rooms"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-2 text-[13px] font-medium capitalize transition-colors ${
              activeTab === tab ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "tables" && <TablesSection branch={branch} />}
      {activeTab === "rooms" && <RoomsSection branch={branch} />}
    </div>
  );
}

function TablesSection({ branch }: { branch: string }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [tableName, setTableName] = useState("");
  const [room, setRoom] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [filterRoom, setFilterRoom] = useState<string | null>(null);
  const [qrTable, setQrTable] = useState<string | null>(null);
  const [showBulkQR, setShowBulkQR] = useState(false);

  const filters: any[] = [];
  if (branch) filters.push(["branch", "=", branch]);
  if (filterRoom) filters.push(["room", "=", filterRoom]);

  const { data: tables, mutate: refresh } = useFrappeGetDocList("ServePOS Table", {
    fields: ["name", "table_name", "room", "capacity", "is_active", "branch"],
    filters, limit: 200, orderBy: { field: "table_name", order: "asc" },
  });

  const roomFilters: any[] = [];
  if (branch) roomFilters.push(["branch", "=", branch]);
  const { data: rooms } = useFrappeGetDocList("ServePOS Room", {
    fields: ["name", "room_name"], filters: roomFilters, limit: 100,
  });

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  function resetForm() { setShowForm(false); setEditingTable(null); setTableName(""); setRoom(""); setCapacity(4); }

  async function handleSave() {
    if (!tableName.trim()) return;
    try {
      const data: any = { table_name: tableName.trim(), room: room || undefined, capacity, branch: branch || undefined };
      if (editingTable) await updateDoc("ServePOS Table", editingTable, data);
      else await createDoc("ServePOS Table", data);
      resetForm(); refresh();
    } catch (err: any) { alert(err.message || "Failed to save"); }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-gray-500">{tables?.length || 0} tables</span>
          {rooms && rooms.length > 0 && (
            <div className="flex gap-1 ml-2">
              <button onClick={() => setFilterRoom(null)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${!filterRoom ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>All</button>
              {rooms.map((r) => (
                <button key={r.name} onClick={() => setFilterRoom(r.name)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${filterRoom === r.name ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{r.room_name}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {tables && tables.length > 0 && (
            <button onClick={() => setShowBulkQR(true)}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
              <QrCode className="h-3 w-3" /> QR Codes
            </button>
          )}
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">
            <Plus className="h-3 w-3" /> Add table
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Table name *</label>
              <input type="text" value={tableName} onChange={(e) => setTableName(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" placeholder="T01" autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Room</label>
              <select value={room} onChange={(e) => setRoom(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none">
                <option value="">None</option>
                {rooms?.map((r) => <option key={r.name} value={r.name}>{r.room_name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Seats</label>
              <input type="number" value={capacity} onChange={(e) => setCapacity(parseInt(e.target.value) || 4)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" min={1} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={resetForm} className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">{editingTable ? "Update" : "Create"}</button>
          </div>
        </div>
      )}

      {/* Table list */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Table</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Room</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Seats</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-20"></th>
            </tr>
          </thead>
          <tbody>
            {tables?.map((t, idx) => (
              <tr key={t.name} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 ? "bg-gray-50/30" : ""}`}>
                <td className="px-4 py-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-[12px] font-bold text-gray-600 mr-2">{t.table_name}</span>
                  <span className="text-[13px] font-medium text-gray-900">{t.table_name}</span>
                </td>
                <td className="px-4 py-3 text-[13px] text-gray-500">{rooms?.find(r => r.name === t.room)?.room_name || t.room || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-[12px] text-gray-500"><Users className="h-3 w-3" />{t.capacity}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setQrTable(t.table_name)} title="Generate QR"
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100"><QrCode className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { setEditingTable(t.name); setTableName(t.table_name); setRoom(t.room || ""); setCapacity(t.capacity || 4); setShowForm(true); }}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100"><Edit3 className="h-3.5 w-3.5" /></button>
                    <button onClick={async () => { if (confirm("Delete?")) { try { await deleteDoc("ServePOS Table", t.name); refresh(); } catch {} } }}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!tables || tables.length === 0) && (
          <div className="py-12 text-center text-sm text-gray-400">No tables yet. Add your first table.</div>
        )}
      </div>

      {/* QR Code Modals */}
      {qrTable && (
        <QRGenerator tableName={qrTable} onClose={() => setQrTable(null)} />
      )}
      {showBulkQR && tables && (
        <BulkQRGenerator
          tables={tables.map((t: any) => ({ name: t.name, table_name: t.table_name, room: rooms?.find((r: any) => r.name === t.room)?.room_name }))}
          onClose={() => setShowBulkQR(false)}
        />
      )}
    </div>
  );
}

function RoomsSection({ branch }: { branch: string }) {
  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [description, setDescription] = useState("");

  const filters: any[] = [];
  if (branch) filters.push(["branch", "=", branch]);

  const { data: rooms, mutate: refresh } = useFrappeGetDocList("ServePOS Room", {
    fields: ["name", "room_name", "description", "is_active", "branch"],
    filters, limit: 100, orderBy: { field: "room_name", order: "asc" },
  });

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();

  function resetForm() { setShowForm(false); setEditingRoom(null); setRoomName(""); setDescription(""); }

  async function handleSave() {
    if (!roomName.trim()) return;
    try {
      const data: any = { room_name: roomName.trim(), description, branch: branch || undefined };
      if (editingRoom) await updateDoc("ServePOS Room", editingRoom, data);
      else await createDoc("ServePOS Room", data);
      resetForm(); refresh();
    } catch (err: any) { alert(err.message || "Failed to save"); }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] text-gray-500">{rooms?.length || 0} rooms</span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">
          <Plus className="h-3 w-3" /> Add room
        </button>
      </div>

      {showForm && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Room name *</label>
              <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" placeholder="Main Hall" autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none" placeholder="Indoor seating area" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={resetForm} className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800">{editingRoom ? "Update" : "Create"}</button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Room</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Description</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rooms?.map((r, idx) => (
              <tr key={r.name} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 ? "bg-gray-50/30" : ""}`}>
                <td className="px-4 py-3 text-[13px] font-medium text-gray-900">{r.room_name}</td>
                <td className="px-4 py-3 text-[13px] text-gray-500">{r.description || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => { setEditingRoom(r.name); setRoomName(r.room_name); setDescription(r.description || ""); setShowForm(true); }}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100"><Edit3 className="h-3.5 w-3.5" /></button>
                    <button onClick={async () => { if (confirm("Delete?")) { try { await deleteDoc("ServePOS Room", r.name); refresh(); } catch {} } }}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!rooms || rooms.length === 0) && (
          <div className="py-12 text-center text-sm text-gray-400">No rooms yet. Create rooms to organize your tables.</div>
        )}
      </div>
    </div>
  );
}
