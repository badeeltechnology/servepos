<template>
  <Header title="Tables and rooms" :subtitle="floor.data ? `${floor.data.rooms.length} rooms · ${floor.data.tables.length} tables` : ''">
    <Button label="Print QR codes" icon-left="lucide-qr-code" :route="{ name: 'qr', query: branch ? { branch } : {} }" />
    <Button variant="solid" label="Add room" icon-left="lucide-plus" @click="editRoom(null)" />
  </Header>
  <div class="space-y-4 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="branch" :options="[{ label: 'All branches', value: '' }, ...state.setup.branches.map((b) => ({ label: b, value: b }))]" class="w-56" aria-label="Branch" />
      <TextInput v-model="q" placeholder="Find a table" class="w-48"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
    </div>
    <div v-if="floor.loading && !floor.data" class="py-10"><LoadingText /></div>
    <div v-else-if="floor.data && !floor.data.rooms.length" class="py-12 text-center">
      <div class="text-base-medium">No rooms yet</div><p class="mt-1 text-p-sm text-ink-gray-5">Add a room (for example Indoor or Terrace), then its tables.</p>
    </div>
    <section v-for="r in rooms" :key="r.name" class="rounded-6 border border-outline-gray-2">
      <div class="flex flex-wrap items-center gap-2 border-b border-outline-gray-1 px-3 py-2">
        <span class="text-base-semibold">{{ r.room_name }}</span>
        <Badge v-if="!r.is_active" label="Off" />
        <span class="text-sm text-ink-gray-5">{{ r.branch || 'No branch' }} · {{ tablesOf(r).length }} tables</span>
        <span class="flex-1" />
        <Button size="sm" label="Add tables" icon-left="lucide-plus" @click="openAdd(r)" />
        <Dropdown :options="[{ label: 'Edit room', icon: 'lucide-pencil', onClick: () => editRoom(r) }, { label: 'QR codes for this room', icon: 'lucide-qr-code', onClick: () => $router.push({ name: 'qr', query: { room: r.name } }) }, { label: 'Delete room', icon: 'lucide-trash-2', onClick: () => removeRoom(r) }]" align="end">
          <Button size="sm" variant="ghost" icon="lucide-ellipsis" aria-label="Room actions" />
        </Dropdown>
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 p-3">
        <button v-for="t in tablesOf(r)" :key="t.name" class="rounded-6 border border-outline-gray-2 px-2 py-2 text-left hover:border-outline-gray-4 hover:bg-surface-gray-1" :class="t.is_active ? '' : 'opacity-50'" @click="editTable(t)">
          <div class="truncate text-base-medium">{{ t.table_name }}</div>
          <div class="text-xs text-ink-gray-5">{{ t.capacity || 0 }} seats</div>
        </button>
        <div v-if="!tablesOf(r).length" class="col-span-full py-3 text-p-sm text-ink-gray-5">No tables in this room yet.</div>
      </div>
    </section>
  </div>

  <Dialog v-model:open="room.open" :title="room.f.name ? 'Edit room' : 'New room'" size="md">
    <div class="space-y-3">
      <FormControl label="Name" v-model="room.f.room_name" placeholder="e.g. Terrace" />
      <FormControl type="select" label="Branch" v-model="room.f.branch" :options="[{ label: 'No branch (every outlet)', value: '' }, ...state.setup.branches.map((b) => ({ label: b, value: b }))]" />
      <FormControl type="textarea" label="Description" v-model="room.f.description" :rows="2" />
      <label v-if="room.f.name" class="flex items-center justify-between text-base">In use <Switch v-model="room.f.is_active" /></label>
    </div>
    <template #actions="{ close }"><div class="flex justify-end gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Save" :loading="busy" @click="saveRoom(close)" /></div></template>
  </Dialog>

  <Dialog v-model:open="add.open" :title="`Add tables to ${add.room?.room_name || ''}`" size="md">
    <div class="space-y-3">
      <TabButtons v-model="add.mode" :options="[{ label: 'One table', value: 'one' }, { label: 'Several', value: 'many' }]" />
      <template v-if="add.mode === 'one'"><FormControl label="Table name" v-model="add.name" placeholder="e.g. T1" /></template>
      <div v-else class="grid grid-cols-3 gap-3">
        <FormControl label="Prefix" v-model="add.prefix" placeholder="T" />
        <FormControl type="number" label="From" v-model="add.start" />
        <FormControl type="number" label="How many" v-model="add.count" />
      </div>
      <FormControl type="number" label="Seats" v-model="add.capacity" />
      <p v-if="add.mode === 'many'" class="text-p-sm text-ink-gray-6">Makes {{ add.prefix }}{{ add.start }} to {{ add.prefix }}{{ Number(add.start) + Number(add.count) - 1 }}. Names that already exist are skipped. Table names must be unique across all branches.</p>
    </div>
    <template #actions="{ close }"><div class="flex justify-end gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Add" :loading="busy" @click="addTables(close)" /></div></template>
  </Dialog>

  <Dialog v-model:open="tbl.open" :title="tbl.f.name ? `Table ${tbl.f.name}` : 'Table'" size="lg">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_11rem]">
      <div class="space-y-3">
        <FormControl label="Name" v-model="tbl.f.table_name" />
        <FormControl type="select" label="Room" v-model="tbl.f.room" :options="(floor.data?.rooms || []).map((r) => ({ label: r.room_name, value: r.name }))" />
        <div class="grid grid-cols-2 gap-3">
          <FormControl type="number" label="Seats" v-model="tbl.f.capacity" />
          <FormControl type="select" label="Shape" v-model="tbl.f.shape" :options="['Square', 'Round', 'Rectangle'].map((s) => ({ label: s, value: s }))" />
        </div>
        <label class="flex items-center justify-between text-base">In use <Switch v-model="tbl.f.is_active" /></label>
      </div>
      <div class="space-y-2 text-center">
        <div class="mx-auto size-40 rounded-6 border border-outline-gray-2 bg-surface-white p-2 [&_svg]:size-full" v-html="tbl.qr" />
        <p class="break-all text-xs text-ink-gray-5">{{ tbl.url }}</p>
        <Button size="sm" label="Download QR" icon-left="lucide-download" :disabled="!tbl.qr" @click="downloadQr" />
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-between gap-2"><Button variant="ghost" theme="red" label="Delete" @click="removeTable(close)" />
        <div class="flex gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Save" :loading="busy" @click="saveTable(close)" /></div></div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { Badge, Button, Dialog, Dropdown, FormControl, LoadingText, Select, Switch, TabButtons, TextInput, dialog } from 'frappe-ui'
import Header from '../../components/Header.vue'
import { useRead, get, post, act } from '../api'
import { state } from '../state'

const branch = ref(''), q = ref(''), busy = ref(false)
const floor = useRead('admin.list_floor', () => ({ branch: branch.value || null }))
const rooms = computed(() => (floor.data?.rooms || []).filter((r) => !q.value || tablesOf(r).length))
const tablesOf = (r) => (floor.data?.tables || []).filter((t) => t.room === r.name && (!q.value || t.table_name.toLowerCase().includes(q.value.toLowerCase())))

const room = reactive({ open: false, f: {} })
function editRoom(r) { room.f = r ? { ...r, is_active: !!r.is_active } : { name: '', room_name: '', branch: branch.value, description: '', is_active: true }; room.open = true }
async function saveRoom(close) {
  busy.value = true
  const ok = await act(() => post('admin.save_room', { data: { ...room.f, is_active: room.f.is_active ? 1 : 0 } }), 'Room saved')
  busy.value = false
  if (ok) { close(); floor.reload() }
}
function removeRoom(r) {
  dialog.danger({ title: `Delete ${r.room_name}?`, message: tablesOf(r).length ? 'Move or delete its tables first.' : 'This cannot be undone.', confirmLabel: 'Delete',
    onConfirm: async () => { await post('admin.delete_room', { name: r.name }); floor.reload() } })
}

const add = reactive({ open: false, room: null, mode: 'many', name: '', prefix: 'T', start: 1, count: 10, capacity: 4 })
function openAdd(r) {
  const n = tablesOf(r).length
  Object.assign(add, { open: true, room: r, mode: 'many', name: '', prefix: 'T', start: n + 1, count: 10, capacity: 4 })
}
async function addTables(close) {
  busy.value = true
  const ok = add.mode === 'one'
    ? await act(() => post('admin.save_table', { data: { table_name: add.name, room: add.room.name, capacity: add.capacity } }), `Table ${add.name} added`)
    : await act(() => post('admin.add_tables', { room: add.room.name, prefix: add.prefix, start: add.start, count: add.count, capacity: add.capacity }),
        (r) => r.created.length ? `${r.created.length} tables added` : 'Those table names already exist')
  busy.value = false
  if (ok) { close(); floor.reload() }
}

const tbl = reactive({ open: false, f: {}, qr: '', url: '' })
async function editTable(t) {
  Object.assign(tbl, { open: true, f: { ...t, is_active: !!t.is_active, shape: t.shape || 'Square' }, qr: '', url: '' })
  try { const r = await get('admin.table_qr', { tables: [t.name] }); tbl.qr = r[0].svg; tbl.url = r[0].url } catch (e) {}
}
async function saveTable(close) {
  busy.value = true
  const ok = await act(() => post('admin.save_table', { data: { ...tbl.f, is_active: tbl.f.is_active ? 1 : 0 } }), 'Table saved')
  busy.value = false
  if (ok) { close(); floor.reload() }
}
function removeTable(close) {
  dialog.danger({ title: `Delete table ${tbl.f.name}?`, message: 'Its QR code stops working.', confirmLabel: 'Delete',
    onConfirm: async () => { await post('admin.delete_table', { name: tbl.f.name }); close(); floor.reload() } })
}
function downloadQr() {
  const a = document.createElement('a')
  a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tbl.qr)
  a.download = `QR ${tbl.f.name}.svg`
  a.click()
}
</script>
