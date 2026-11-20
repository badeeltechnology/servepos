<template>
  <Header title="Menu items" :subtitle="loaded ? `${total} items` : ''">
    <Dropdown :options="moreMenu" align="end"><Button label="More" icon-right="lucide-chevron-down" /></Dropdown>
    <Button variant="solid" label="Add item" icon-left="lucide-plus" :route="{ name: 'item', params: { name: 'new' } }" />
  </Header>

  <div class="space-y-3 px-3 pb-24 pt-4 sm:px-5">
    <div class="flex flex-wrap items-center gap-2">
      <TextInput v-model="search" placeholder="Search name, code or Arabic" class="w-64" :debounce="300">
        <template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template>
      </TextInput>
      <Select v-model="group" :options="groupOptions" class="w-48" aria-label="Category" />
      <Select v-model="outlet" :options="outletOptions('Any outlet')" class="w-48" aria-label="Shown on outlet" />
      <TabButtons v-model="status" :options="statusOptions" />
    </div>

    <List v-model:selection="selection" :columns="cols" selectable class="-mx-3 list-row-px-3">
      <ListHeader>
        <ListHeaderCell>Item</ListHeaderCell><ListHeaderCell>Category</ListHeaderCell><ListHeaderCell class="justify-end">Price</ListHeaderCell>
        <ListHeaderCell>Outlets</ListHeaderCell><ListHeaderCell>Status</ListHeaderCell><ListHeaderCell />
      </ListHeader>
      <ListRows :items="rows" v-slot="{ item, value }">
        <ListRow :value="value" class="min-h-12 cursor-pointer" :class="item.servepos_is_disabled ? 'opacity-60' : ''" @click.capture="openRow($event, item)">
          <ListCell class="gap-2">
            <Thumb :src="item.image" :text="item.item_name" />
            <div class="min-w-0">
              <div class="flex items-center gap-1 truncate text-base"><span class="truncate">{{ item.item_name }}</span><span v-if="item.pinned" class="lucide-pin size-3 shrink-0 text-ink-amber-6" title="Pinned on this outlet" /></div>
              <div class="truncate text-xs text-ink-gray-5"><span dir="rtl">{{ item.servepos_item_name_ar }}</span><span v-if="item.servepos_item_name_ar"> · </span>{{ item.name }}</div>
            </div>
          </ListCell>
          <ListCell class="text-sm text-ink-gray-6">{{ item.item_group }}</ListCell>
          <ListCell class="justify-end num">{{ fmtPrice(item.standard_rate) }}</ListCell>
          <ListCell class="text-sm" :class="item.outlets.length ? 'text-ink-gray-7' : 'text-ink-red-6'">{{ outletText(item) }}</ListCell>
          <ListCell><Badge :theme="statusOf(item).theme" :label="statusOf(item).label" /></ListCell>
          <ListCell class="justify-end"><Button variant="ghost" icon="lucide-chevron-right" aria-label="Open" class="relative" :route="{ name: 'item', params: { name: item.name } }" @click.stop /></ListCell>
        </ListRow>
      </ListRows>
    </List>
    <div v-if="loading && !rows.length" class="py-10"><LoadingText /></div>
    <div v-else-if="loaded && !rows.length" class="py-12 text-center">
      <div class="text-base-medium">{{ anyFilter ? 'No items match' : 'No menu items yet' }}</div>
      <p class="mt-1 text-p-sm text-ink-gray-5">{{ anyFilter ? 'Clear a filter or search for something else.' : 'Add your first item, or mark an item group as a menu group in ERPNext.' }}</p>
    </div>
    <div v-if="rows.length < total" class="flex justify-center pt-2"><Button :label="`Show more (${total - rows.length} left)`" :loading="loading" @click="load(true)" /></div>
  </div>

  <!-- bulk bar -->
  <div v-if="selection.length" class="fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-8 border border-outline-gray-2 bg-surface-white px-3 py-2 shadow-xl">
    <span class="px-1 text-sm text-ink-gray-7">{{ selection.length }} selected</span>
    <Button label="Add to outlets" icon-left="lucide-store" @click="openOutlets('add')" />
    <Button label="Remove from outlets" @click="openOutlets('remove')" />
    <Dropdown :options="bulkMenu"><Button label="More" icon-right="lucide-chevron-down" /></Dropdown>
    <Button variant="ghost" icon="lucide-x" aria-label="Clear selection" @click="selection = []" />
  </div>

  <Dialog v-model:open="outletDlg.open" :title="outletDlg.mode === 'add' ? 'Add to outlets' : 'Remove from outlets'" size="lg">
    <div class="space-y-3">
      <p class="text-p-sm text-ink-gray-6">{{ outletDlg.mode === 'add' ? 'The ticked channels are switched on for the chosen outlets. Other outlets are not changed.' : 'The ticked channels are switched off for the chosen outlets only.' }}</p>
      <OutletPicker v-model="outletDlg.outlets" :profiles="state.setup.profiles" />
      <div class="flex gap-4">
        <label class="flex items-center gap-2 text-base"><Checkbox v-model="outletDlg.pos" /> POS</label>
        <label class="flex items-center gap-2 text-base"><Checkbox v-model="outletDlg.web" /> Online menu (QR)</label>
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-end gap-2"><Button label="Cancel" @click="close" />
        <Button variant="solid" :label="`Apply to ${selection.length} items`" :disabled="!outletDlg.outlets.length || (!outletDlg.pos && !outletDlg.web)" :loading="busy" @click="applyOutlets(close)" /></div>
    </template>
  </Dialog>

  <Dialog v-model:open="moveDlg.open" title="Move to category" size="sm">
    <Select v-model="moveDlg.group" :options="state.setup.groups.map((g) => ({ label: g, value: g }))" placeholder="Choose a category" />
    <template #actions="{ close }">
      <div class="flex justify-end gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Move" :disabled="!moveDlg.group" :loading="busy" @click="bulk('move', moveDlg.group).then(close)" /></div>
    </template>
  </Dialog>

  <CategoriesDialog v-model:open="showCategories" @changed="reloadAll" />
  <CopyMenuDialog v-model:open="showCopy" @done="load()" />
  <PinnedDialog v-model:open="showPinned" :outlet="outlet || state.setup.profiles[0]?.name" @saved="load()" />
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Badge, Button, Checkbox, Dialog, Dropdown, LoadingText, Select, TabButtons, TextInput, dialog } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import Thumb from '../components/Thumb.vue'
import OutletPicker from '../components/OutletPicker.vue'
import CategoriesDialog from '../components/CategoriesDialog.vue'
import CopyMenuDialog from '../components/CopyMenuDialog.vue'
import PinnedDialog from '../components/PinnedDialog.vue'
import { get, post, act } from '../api'
import { state, outletOptions, reloadSetup } from '../state'
import { useRouter } from 'vue-router'

const router = useRouter()
// A click on a row opens the item; only the checkbox selects it (frappe-ui's selectable rows
// toggle on any click, so the click is caught here before the row sees it).
function openRow(e, item) {
  if (e.target.closest('[data-slot="list-row-checkbox"]')) return
  e.preventDefault()
  e.stopPropagation()
  const to = router.resolve({ name: 'item', params: { name: item.name } })
  if (e.metaKey || e.ctrlKey) window.open(to.href, '_blank')
  else router.push(to)
}

const cols = ['minmax(220px,1fr)', '10rem', '6rem', '9rem', '7rem', '3rem']
const search = ref(''), group = ref(''), status = ref('all'), outlet = ref(state.outlet)
const statusOptions = [{ label: 'All', value: 'all' }, { label: 'Active', value: 'active' }, { label: 'Sold out', value: 'unavailable' }, { label: 'Disabled', value: 'disabled' }]
const groupOptions = computed(() => [{ label: 'All categories', value: '' }, ...state.setup.groups.map((g) => ({ label: g, value: g }))])
const rows = ref([]), total = ref(0), loading = ref(false), loaded = ref(false), selection = ref([]), busy = ref(false)
const anyFilter = computed(() => search.value || group.value || outlet.value || status.value !== 'all')
const profileCount = computed(() => state.setup.profiles.length)
const fmtPrice = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function load(more = false) {
  loading.value = true
  try {
    const r = await get('admin.list_items', { search: search.value || null, item_group: group.value || null, status: status.value, outlet: outlet.value || null,
      start: more ? rows.value.length : 0, page_length: 50 })
    rows.value = more ? [...rows.value, ...r.rows] : r.rows
    total.value = r.total
    if (!more) selection.value = []
  } catch (e) {
    rows.value = []
  } finally {
    loading.value = false
    loaded.value = true
  }
}
watch([search, group, status, outlet], () => load(), { immediate: true })
async function reloadAll() { await reloadSetup(); load() }

function outletText(i) {
  if (!i.outlets.length) return 'Not shown anywhere'
  if (i.outlets.length === profileCount.value) return 'All outlets'
  return i.outlets.length === 1 ? i.outlets[0] : `${i.outlets.length} outlets`
}
function statusOf(i) {
  if (i.servepos_is_disabled) return { label: 'Disabled', theme: 'gray' }
  if (!i.servepos_is_available) return { label: 'Sold out', theme: 'amber' }
  return { label: 'Active', theme: 'green' }
}

const outletDlg = reactive({ open: false, mode: 'add', outlets: [], pos: true, web: false })
function openOutlets(mode) { Object.assign(outletDlg, { open: true, mode, outlets: outlet.value ? [outlet.value] : [], pos: true, web: false }) }
async function applyOutlets(close) {
  busy.value = true
  const r = await act(() => post('menu_admin.set_item_outlets', { items: selection.value, pos_profiles: outletDlg.outlets,
    show_on_pos: outletDlg.pos ? 1 : null, show_on_website: outletDlg.web ? 1 : null, mode: outletDlg.mode }), (r) => `${r.updated ?? selection.value.length} items updated. The POS picks it up on their next sync.`)
  busy.value = false
  if (r) { close(); load() }
}

const moveDlg = reactive({ open: false, group: '' })
async function bulk(action, value) {
  busy.value = true
  const n = selection.value.length
  const r = await act(() => post('admin.bulk_items', { items: selection.value, action, value }), `${n} items updated`)
  busy.value = false
  if (r) load()
}
const bulkMenu = computed(() => [
  { label: 'Move to category', icon: 'lucide-folder-input', onClick: () => Object.assign(moveDlg, { open: true, group: '' }) },
  { label: 'Mark sold out', icon: 'lucide-circle-slash', onClick: () => bulk('unavailable') },
  { label: 'Back in stock', icon: 'lucide-circle-check', onClick: () => bulk('available') },
  { label: 'Disable', icon: 'lucide-eye-off', onClick: () => dialog.confirm({ title: `Disable ${selection.value.length} items?`, message: 'Disabled items leave every POS and the online menu until you enable them again.', confirmLabel: 'Disable', onConfirm: () => bulk('disable') }) },
  { label: 'Enable', icon: 'lucide-eye', onClick: () => bulk('enable') },
  ...(outlet.value ? [
    { label: 'Pin on ' + outlet.value, icon: 'lucide-pin', onClick: () => pin('add') },
    { label: 'Unpin on ' + outlet.value, icon: 'lucide-pin-off', onClick: () => pin('remove') },
  ] : []),
])
async function pin(mode) {
  const r = await act(() => post('menu_admin.pin_items', { pos_profile: outlet.value, items: selection.value, mode }), mode === 'add' ? 'Pinned to Popular' : 'Unpinned')
  if (r) load()
}

const showCategories = ref(false), showCopy = ref(false), showPinned = ref(false)
const moreMenu = computed(() => [
  { label: 'Categories and order', icon: 'lucide-list-ordered', onClick: () => (showCategories.value = true) },
  { label: 'Popular (pinned) items', icon: 'lucide-pin', onClick: () => (showPinned.value = true) },
  { label: 'Copy menu between outlets', icon: 'lucide-copy', onClick: () => (showCopy.value = true) },
])
</script>
