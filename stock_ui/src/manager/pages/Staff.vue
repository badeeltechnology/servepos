<template>
  <Header title="Waiters" :subtitle="list.data ? `${list.data.length} waiters` : ''">
    <Button variant="solid" label="Add waiter" icon-left="lucide-plus" @click="edit(null)" />
  </Header>
  <div class="space-y-3 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-center gap-2">
      <TextInput v-model="q" placeholder="Search waiters" class="w-56"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
      <Select v-model="branch" :options="[{ label: 'All branches', value: '' }, ...state.setup.branches.map((b) => ({ label: b, value: b }))]" class="w-52" aria-label="Branch" />
      <TabButtons v-model="show" :options="[{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }, { label: 'All', value: 'all' }]" />
    </div>
    <div class="overflow-x-auto">
      <List :columns="['minmax(180px,1fr)', '10rem', '10rem', '11rem', '5rem']" class="-mx-3 min-w-[720px] list-row-px-3">
        <ListHeader><ListHeaderCell>Waiter</ListHeaderCell><ListHeaderCell>Branch</ListHeaderCell><ListHeaderCell>Outlets</ListHeaderCell><ListHeaderCell>App login</ListHeaderCell><ListHeaderCell>Active</ListHeaderCell></ListHeader>
        <ListRows :items="rows" v-slot="{ item }">
          <ListRow class="relative min-h-11">
            <button type="button" class="absolute inset-0 rounded-6" :aria-label="'Open ' + item.waiter_name" @click="edit(item)" />
            <ListCell class="flex-col !items-start"><span class="text-base" :class="item.is_active ? '' : 'text-ink-gray-5 line-through'">{{ item.waiter_name }}</span><span class="text-xs text-ink-gray-5">{{ item.phone }}</span></ListCell>
            <ListCell class="text-sm text-ink-gray-6">{{ item.branch || 'Every branch' }}</ListCell>
            <ListCell class="text-sm text-ink-gray-6">{{ item.outlets.length ? (item.outlets.length === 1 ? item.outlets[0] : `${item.outlets.length} outlets`) : 'All outlets' }}</ListCell>
            <ListCell class="text-sm"><span v-if="item.login" class="flex items-center gap-1.5"><span class="font-mono">{{ item.login.username }}</span><Badge :theme="item.login.user_enabled ? 'green' : 'red'" :label="item.login.user_enabled ? `${item.login.devices} phones` : 'Off'" /></span><span v-else class="text-ink-gray-4">None</span></ListCell>
            <ListCell><Switch class="relative" :model-value="!!item.is_active" @update:model-value="(v) => toggle(item, v)" /></ListCell>
          </ListRow>
        </ListRows>
      </List>
    </div>
    <div v-if="list.loading && !list.data" class="py-10"><LoadingText /></div>
    <div v-else-if="list.data && !rows.length" class="py-12 text-center text-p-sm text-ink-gray-5">{{ q || branch ? 'No waiters match.' : 'No waiters yet.' }}</div>
  </div>

  <Dialog v-model:open="dlg.open" :title="dlg.f.name || 'New waiter'" size="2xl">
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormControl label="Name" v-model="dlg.f.waiter_name" />
        <FormControl label="Phone" v-model="dlg.f.phone" />
        <FormControl type="password" label="POS PIN" v-model="dlg.f.pin" :placeholder="dlg.f.name ? 'Leave empty to keep' : '4 to 6 digits'" maxlength="6" inputmode="numeric" />
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormControl type="select" label="Branch" v-model="dlg.f.branch" :options="[{ label: 'Every branch', value: '' }, ...state.setup.branches.map((b) => ({ label: b, value: b }))]" />
        <label class="flex items-end justify-between pb-1 text-base">Active <Switch v-model="dlg.f.is_active" /></label>
      </div>
      <div>
        <label class="mb-1.5 flex items-center justify-between"><span class="text-base-semibold">Outlets this waiter works at</span><span class="flex items-center gap-2 text-sm text-ink-gray-6">All outlets <Switch v-model="dlg.all" /></span></label>
        <OutletPicker v-if="!dlg.all" v-model="dlg.f.outlets" :profiles="branchProfiles" />
      </div>
      <AppLogin v-if="dlg.f.name" :waiter="dlg.f.name" :waiter-name="dlg.f.waiter_name" @changed="list.reload()" />
      <p v-else class="text-p-sm text-ink-gray-5">Save the waiter first, then you can create a waiter app login.</p>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-between gap-2"><Button v-if="dlg.f.name" variant="ghost" theme="red" label="Delete" @click="remove(close)" /><span v-else />
        <div class="flex gap-2"><Button label="Close" @click="close" /><Button variant="solid" label="Save" :loading="dlg.busy" @click="save(close)" /></div></div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { Badge, Button, Dialog, FormControl, LoadingText, Select, Switch, TabButtons, TextInput, dialog } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import OutletPicker from '../components/OutletPicker.vue'
import AppLogin from '../components/AppLogin.vue'
import { useRead, post, act } from '../api'
import { state } from '../state'

const list = useRead('admin.list_waiters', {})
const q = ref(''), branch = ref(''), show = ref('active')
const rows = computed(() => (list.data || []).filter((w) => (!q.value || w.waiter_name.toLowerCase().includes(q.value.toLowerCase()) || (w.phone || '').includes(q.value))
  && (!branch.value || w.branch === branch.value || !w.branch) && (show.value === 'all' || (show.value === 'active') === !!w.is_active)))

const dlg = reactive({ open: false, busy: false, all: true, f: {} })
const branchProfiles = computed(() => state.setup.profiles.filter((p) => !dlg.f.branch || !p.branch || p.branch === dlg.f.branch))
function edit(w) {
  dlg.f = w ? { name: w.name, waiter_name: w.waiter_name, phone: w.phone || '', pin: '', branch: w.branch || '', is_active: !!w.is_active, outlets: [...w.outlets] }
    : { name: '', waiter_name: '', phone: '', pin: '', branch: '', is_active: true, outlets: [] }
  dlg.all = !dlg.f.outlets.length
  dlg.open = true
}
async function save(close) {
  dlg.busy = true
  const r = await act(() => post('admin.save_waiter', { data: { ...dlg.f, is_active: dlg.f.is_active ? 1 : 0, outlets: dlg.all ? [] : dlg.f.outlets.filter((o) => branchProfiles.value.some((p) => p.name === o)) } }), 'Waiter saved')
  dlg.busy = false
  if (r) { list.reload(); if (!dlg.f.name) { dlg.f.name = r.name; dlg.f.pin = '' } else close() }
}
async function toggle(w, v) {
  w.is_active = v ? 1 : 0
  if (!(await act(() => post('admin.save_waiter', { data: { name: w.name, waiter_name: w.waiter_name, phone: w.phone, is_active: w.is_active } }), v ? `${w.waiter_name} is active` : `${w.waiter_name} is off`))) w.is_active = v ? 0 : 1
}
function remove(close) {
  dialog.danger({ title: `Delete ${dlg.f.name}?`, message: 'Their app login is removed too. Waiters with sales are better switched off.', confirmLabel: 'Delete',
    onConfirm: async () => { await post('admin.delete_waiter', { name: dlg.f.name }); close(); list.reload() } })
}
</script>
