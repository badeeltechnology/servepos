<template>
  <Header title="To buy" subtitle="What the Store is short of for submitted orders">
    <DatePicker v-model="upTo" class="w-40" placeholder="Orders due up to" />
    <DownloadMenu kind="to_buy" :params="{ for_date: upTo }" label="" />
    <Button variant="solid" :disabled="!picked.length" :loading="maker.loading" :label="'Create ' + (supCount || '') + ' draft PO' + (supCount === 1 ? '' : 's')" @click="create" />
  </Header>
  <div class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <div class="card flex flex-wrap items-center gap-2 px-3 py-2">
      <SearchInput v-model="q" placeholder="Search item, outlet or supplier" />
      <Checkbox :model-value="allOn" @update:model-value="toggleAll" :label="q ? 'Tick all shown' : 'Tick all'" />
      <span class="text-sm text-ink-gray-5">{{ picked.length }} ticked</span>
      <span class="flex-1" />
      <span class="text-sm text-ink-gray-6">Supplier for ticked items</span>
      <SupplierPick v-model="bulk" class="w-60" />
      <Button :disabled="!bulk || !picked.length" label="Apply" @click="picked.forEach((r) => (r.supplier = bulk))" />
      <Button :disabled="!picked.length" label="Use suggested" @click="picked.forEach((r) => (r.supplier = r.suggested_supplier || r.supplier))" />
    </div>
    <Alert v-if="made.length" theme="green" title="Draft purchase orders created" description="Open them in ERPNext to check prices and submit.">
      <template #actions><div class="flex flex-wrap gap-2"><Button v-for="m in made" :key="m.name" :link="'/app/purchase-order/' + m.name" :label="`${m.name} · ${m.supplier}`" size="sm" /></div></template>
    </Alert>
    <div class="overflow-x-auto">
      <List :columns="cols" class="card min-w-[860px] list-row-px-3">
        <ListHeader>
          <ListHeaderCell /><ListHeaderCell>Item</ListHeaderCell><ListHeaderCell class="justify-end">Needed</ListHeaderCell><ListHeaderCell class="justify-end">Store has</ListHeaderCell>
          <ListHeaderCell class="justify-end">Buy qty</ListHeaderCell><ListHeaderCell>Buy UOM</ListHeaderCell><ListHeaderCell>Supplier</ListHeaderCell>
        </ListHeader>
        <ListRow v-for="r in shown" :key="r.item_code" class="min-h-14 py-1" :class="r.on ? 'bg-surface-gray-1' : ''">
          <ListCell><Checkbox v-model="r.on" :aria-label="'Tick ' + r.item_name" /></ListCell>
          <ListCell class="flex-col !items-start"><span class="w-full truncate text-base">{{ r.item_name }}</span><span class="w-full truncate text-xs text-ink-gray-5" :title="r.who.join(', ')">for {{ r.who.join(', ') }}</span></ListCell>
          <ListCell class="justify-end num">{{ fmt(r.needed) }}&nbsp;<span class="text-xs text-ink-gray-4">{{ r.stock_uom }}</span></ListCell>
          <ListCell class="flex-col !items-end text-ink-gray-6 num"><span>{{ fmt(r.store_has) }}</span><span v-if="r.on_po" class="text-xs text-ink-blue-5">+{{ fmt(r.on_po) }} on PO</span><span v-if="r.in_draft" class="text-xs text-ink-amber-6">+{{ fmt(r.in_draft) }} in draft PO</span></ListCell>
          <ListCell><TextInput class="qty w-full" type="number" min="0" step="any" variant="outline" :model-value="r.qty" @update:model-value="(v) => (r.qty = v)" :aria-label="'Buy qty for ' + r.item_name" /></ListCell>
          <ListCell><Select v-model="r.uom" :options="r.uoms.map((u) => ({ value: u.uom, label: u.factor === 1 ? u.uom : `${u.uom} (${fmt(u.factor)})` }))" class="w-full" /></ListCell>
          <ListCell class="flex-col !items-stretch gap-0.5">
            <SupplierPick v-model="r.supplier" :suggested="r.suggested_supplier" />
            <Button v-if="r.suggested_supplier && r.supplier !== r.suggested_supplier" size="xs" variant="ghost" theme="blue" class="self-start"
              :label="'Use ' + r.suggested_supplier + (r.last_rate ? ` · last ${fmt(r.last_rate, 2)}/${r.last_uom}` : '')" @click="r.supplier = r.suggested_supplier" />
            <span v-else-if="!r.suggested_supplier" class="text-xs text-ink-gray-4">Not bought before</span>
          </ListCell>
        </ListRow>
        <Empty v-if="list.data && !rows.length">Nothing to buy: the Store has or has ordered everything that submitted orders need.</Empty>
      </List>
    </div>
    <p class="text-p-sm text-ink-gray-5">Tick items, choose who to buy from (the suggestion is the last supplier used), then create drafts. One draft per supplier, delivered to the Store.</p>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { Alert, Button, Checkbox, DatePicker, Select, TextInput, toast } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import Header from '../components/Header.vue'
import Empty from '../components/Empty.vue'
import DownloadMenu from '../components/DownloadMenu.vue'
import SupplierPick from '../components/SupplierPick.vue'
import SearchInput from '../components/SearchInput.vue'
import { useRead, useWrite, errText, fmt, matches } from '../api'
import { state } from '../state'
const rows = ref([]), bulk = ref(null), made = ref([]), upTo = ref(state.ctx.for_date)
const cols = ['2rem', 'minmax(180px,1fr)', '6rem', '6rem', '6rem', '8rem', '15rem']
const list = useRead('get_to_buy', () => ({ for_date: upTo.value }), {
  onSuccess: (d) => { rows.value = d.map((r) => ({ ...r, on: false, qty: r.buy_qty, uom: r.buy_uom, supplier: null })) },
})
const maker = useWrite('create_purchase_orders')
const picked = computed(() => rows.value.filter((r) => r.on))
const q = ref('')
const shown = computed(() => rows.value.filter((r) => matches(q.value, r.item_name, r.item_code, r.who.join(' '), r.supplier, r.suggested_supplier)))
const allOn = computed(() => shown.value.length > 0 && shown.value.every((r) => r.on))
const supCount = computed(() => new Set(picked.value.map((r) => r.supplier).filter(Boolean)).size)
function toggleAll(v) { shown.value.forEach((r) => (r.on = !!v)) }
async function create() {
  const missing = picked.value.filter((r) => !r.supplier)
  if (missing.length) return toast.warning(`Choose a supplier for ${missing.map((r) => r.item_name).slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`)
  try {
    made.value = await maker.submit({ lines: picked.value.map((r) => ({ item_code: r.item_code, qty: Number(r.qty), uom: r.uom, supplier: r.supplier, orders: r.orders })) })
    toast.success(`${made.value.length} draft PO${made.value.length > 1 ? 's' : ''} created`)
    list.reload()
  } catch (e) { toast.error(errText(e)) }
}
</script>
