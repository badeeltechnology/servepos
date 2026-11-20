<template>
  <Header title="Modifiers" :subtitle="groups.data ? `${groups.data.length} groups` : ''">
    <Button variant="solid" label="Add group" icon-left="lucide-plus" @click="edit(null)" />
  </Header>
  <div class="space-y-3 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-center gap-2">
      <TextInput v-model="q" placeholder="Search groups or options" class="w-64"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
    </div>
    <p class="text-p-sm text-ink-gray-6">A modifier group is a choice offered with an item, such as size or extra toppings. Add groups to items on the item page, or several at once here.</p>
    <div class="overflow-x-auto">
      <List :columns="['minmax(180px,1fr)', '9rem', 'minmax(200px,1.5fr)', '6rem', '3rem']" class="-mx-3 min-w-[720px] list-row-px-3">
        <ListHeader><ListHeaderCell>Group</ListHeaderCell><ListHeaderCell>Choice</ListHeaderCell><ListHeaderCell>Options</ListHeaderCell><ListHeaderCell class="justify-end">Items</ListHeaderCell><ListHeaderCell /></ListHeader>
        <ListRows :items="filtered" v-slot="{ item }">
          <ListRow class="min-h-11" @click="edit(item)">
            <ListCell class="text-base-medium">{{ item.group_name }}</ListCell>
            <ListCell class="gap-1"><Badge :label="item.selection_type === 'Multiple' ? (item.max_selections ? `Up to ${item.max_selections}` : 'Several') : 'One'" /><Badge v-if="item.is_required" theme="amber" label="Required" /></ListCell>
            <ListCell class="truncate text-sm text-ink-gray-6">{{ item.options.map((o) => o.modifier_name + (o.price ? ` +${fmt(o.price)}` : '')).join(', ') }}</ListCell>
            <ListCell class="justify-end num" :class="item.items ? '' : 'text-ink-gray-4'">{{ item.items }}</ListCell>
            <ListCell class="justify-end"><span class="lucide-chevron-right size-4 text-ink-gray-4" /></ListCell>
          </ListRow>
        </ListRows>
      </List>
    </div>
    <div v-if="groups.loading && !groups.data" class="py-10"><LoadingText /></div>
    <div v-else-if="groups.data && !filtered.length" class="py-12 text-center text-p-sm text-ink-gray-5">{{ q ? 'No groups match.' : 'No modifier groups yet.' }}</div>
  </div>

  <Dialog v-model:open="dlg.open" :title="dlg.f.name ? dlg.f.name : 'New modifier group'" size="2xl">
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormControl label="Name" v-model="dlg.f.group_name" class="sm:col-span-2" placeholder="e.g. Size" />
        <FormControl type="select" label="Guests choose" v-model="dlg.f.selection_type" :options="[{ label: 'One option', value: 'Single' }, { label: 'Several options', value: 'Multiple' }]" />
      </div>
      <div class="flex flex-wrap items-center gap-6">
        <label class="flex items-center gap-2 text-base"><Checkbox v-model="dlg.f.is_required" /> A choice is required</label>
        <div v-if="dlg.f.selection_type === 'Multiple'" class="flex items-center gap-2 text-base">At most <TextInput type="number" v-model="dlg.f.max_selections" class="w-20" min="0" /> <span class="text-p-sm text-ink-gray-5">(0 = no limit)</span></div>
      </div>
      <div>
        <div class="mb-1.5 flex items-center justify-between"><span class="text-base-semibold">Options</span><Button size="sm" label="Add option" icon-left="lucide-plus" @click="addOption" /></div>
        <List :columns="['minmax(0,1fr)', '7rem', '4.5rem', '6.5rem']" class="list-row-px-2">
          <ListHeader><ListHeaderCell>Option</ListHeaderCell><ListHeaderCell>Extra price</ListHeaderCell><ListHeaderCell class="justify-center">Default</ListHeaderCell><ListHeaderCell /></ListHeader>
          <ListRows :items="dlg.f.options" row-key="_k" v-slot="{ item: o, index: i }">
            <ListRow class="min-h-11">
              <ListCell><TextInput v-model="o.modifier_name" placeholder="e.g. Large" class="w-full" /></ListCell>
              <ListCell><TextInput type="number" v-model="o.price" min="0" step="0.5" class="w-full" /></ListCell>
              <ListCell class="justify-center"><Checkbox :model-value="!!o.is_default" @update:model-value="(v) => setDefault(i, v)" /></ListCell>
              <ListCell class="justify-end">
                <Button variant="ghost" size="sm" icon="lucide-arrow-up" aria-label="Move up" :disabled="i === 0" @click="moveOpt(i, -1)" />
                <Button variant="ghost" size="sm" icon="lucide-arrow-down" aria-label="Move down" :disabled="i === dlg.f.options.length - 1" @click="moveOpt(i, 1)" />
                <Button variant="ghost" size="sm" icon="lucide-x" aria-label="Remove option" @click="dlg.f.options.splice(i, 1)" />
              </ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>
      <div>
        <label class="mb-1.5 flex items-center justify-between"><span class="text-base-semibold">Outlets</span>
          <span class="flex items-center gap-2 text-sm text-ink-gray-6">All outlets <Switch v-model="dlg.allOutlets" /></span></label>
        <OutletPicker v-if="!dlg.allOutlets" v-model="dlg.f.outlets" :profiles="state.setup.profiles" />
      </div>
      <div v-if="dlg.f.name" class="rounded-6 bg-surface-gray-1 p-3">
        <div class="flex items-center justify-between"><span class="text-base">Used on {{ dlg.items }} items</span><Button size="sm" label="Add to items" icon-left="lucide-plus" @click="openAssign" /></div>
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-between gap-2">
        <Button v-if="dlg.f.name" variant="ghost" theme="red" label="Delete" @click="remove(close)" /><span v-else />
        <div class="flex gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Save" :loading="dlg.saving" @click="save(close)" /></div>
      </div>
    </template>
  </Dialog>

  <Dialog v-model:open="asg.open" :title="`Add ${dlg.f.name} to items`" size="lg">
    <div class="space-y-2">
      <TextInput v-model="asg.q" placeholder="Search items" :debounce="250"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
      <div class="max-h-[45vh] overflow-y-auto">
        <List v-model:selection="asg.picked" selectable :columns="['minmax(0,1fr)', '10rem']" class="list-row-px-2">
          <ListRows :items="asg.rows" v-slot="{ item: r, value }">
            <ListRow :value="value" class="min-h-9">
              <ListCell class="truncate">{{ r.item_name }}</ListCell>
              <ListCell class="justify-end truncate text-xs text-ink-gray-5">{{ r.item_group }}</ListCell>
            </ListRow>
          </ListRows>
        </List>
        <p v-if="!asg.rows.length" class="px-1 py-4 text-center text-p-sm text-ink-gray-5">Type to find items.</p>
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-end gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" :label="`Add to ${asg.picked.length} items`" :disabled="!asg.picked.length" :loading="asg.busy" @click="assign(close)" /></div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Badge, Button, Checkbox, Dialog, FormControl, LoadingText, Switch, TextInput, dialog } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import OutletPicker from '../components/OutletPicker.vue'
import { useRead, get, post, act } from '../api'
import { state, reloadSetup } from '../state'

const groups = useRead('admin.list_modifier_groups', {})
const q = ref('')
const fmt = (v) => Number(v || 0).toLocaleString('en', { maximumFractionDigits: 2 })
const filtered = computed(() => {
  const t = q.value.toLowerCase()
  return (groups.data || []).filter((g) => !t || g.group_name.toLowerCase().includes(t) || g.options.some((o) => o.modifier_name.toLowerCase().includes(t)))
})

let key = 0
const dlg = reactive({ open: false, saving: false, allOutlets: true, items: 0, f: {} })
function edit(g) {
  dlg.f = g
    ? { name: g.name, group_name: g.group_name, selection_type: g.selection_type, is_required: !!g.is_required, max_selections: g.max_selections || 0,
        options: g.options.map((o) => ({ ...o, _k: ++key })), outlets: [...g.outlets] }
    : { name: '', group_name: '', selection_type: 'Single', is_required: false, max_selections: 0, options: [{ modifier_name: '', price: 0, is_default: 0, _k: ++key }], outlets: [] }
  dlg.allOutlets = !dlg.f.outlets.length
  dlg.items = g ? g.items : 0
  dlg.open = true
}
function addOption() { dlg.f.options.push({ modifier_name: '', price: 0, is_default: 0, _k: ++key }) }
function moveOpt(i, d) { const a = dlg.f.options; [a[i], a[i + d]] = [a[i + d], a[i]] }
function setDefault(i, v) {
  if (v && dlg.f.selection_type === 'Single') dlg.f.options.forEach((o) => (o.is_default = 0))
  dlg.f.options[i].is_default = v ? 1 : 0
}
async function save(close) {
  dlg.saving = true
  const data = { ...dlg.f, is_required: dlg.f.is_required ? 1 : 0, outlets: dlg.allOutlets ? [] : dlg.f.outlets,
    options: dlg.f.options.map(({ _k, ...o }) => o) }
  const r = await act(() => post('admin.save_modifier_group', { data }), 'Saved. The POS picks it up on their next sync.')
  dlg.saving = false
  if (r) { close(); groups.reload(); reloadSetup() }
}
function remove(close) {
  dialog.danger({ title: `Delete ${dlg.f.name}?`, message: dlg.items ? `It is used on ${dlg.items} items; remove it from them first.` : 'This cannot be undone.', confirmLabel: 'Delete',
    onConfirm: async () => { await post('admin.delete_modifier_group', { name: dlg.f.name }); close(); groups.reload(); reloadSetup() } })
}

const asg = reactive({ open: false, q: '', rows: [], picked: [], busy: false })
function openAssign() { Object.assign(asg, { open: true, q: '', rows: [], picked: [] }) }
watch(() => asg.q, async (v) => { asg.rows = v && v.length > 1 ? (await get('admin.list_items', { search: v, page_length: 30 })).rows : [] })
async function assign(close) {
  asg.busy = true
  const r = await act(() => post('admin.assign_modifier_group', { group: dlg.f.name, items: asg.picked, mode: 'add' }), (r) => `Added to ${r.updated} items`)
  asg.busy = false
  if (r) { dlg.items += r.updated; close(); groups.reload() }
}
</script>
