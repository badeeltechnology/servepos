<template>
  <Header :title="isProv ? 'Order from ' + provider : 'New order'">
    <template #status>
      <StatusBadge v-if="form.data" :status="form.data.status" />
      <Badge v-if="order && order.is_late" label="Late" theme="amber" variant="subtle" />
      <router-link v-if="order" :to="'/o/' + order.name" class="text-base text-ink-gray-5 underline hover:text-ink-gray-8">{{ order.name }}</router-link>
    </template>
    <template v-if="editable">
      <Dropdown :options="[{ label: 'Fill usual quantities', icon: 'lucide-wand-sparkles', onClick: fillUsual }, { label: 'Clear quantities', icon: 'lucide-eraser', onClick: clearAll }]">
        <Button icon="lucide-ellipsis" aria-label="More actions" />
      </Dropdown>
      <Button label="Save draft" :loading="saver.loading && mode === 0" @click="save(0)" />
      <Button variant="solid" :label="form.data.status === 'Submitted' ? 'Save changes' : 'Submit to ' + provider" :loading="saver.loading && mode === 1" @click="save(1)" />
    </template>
  </Header>

  <div class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <TabButtons v-if="providers.length > 1" :options="providers.map((p) => ({ label: p, value: p }))" :model-value="provider" @update:model-value="go" />
      <span class="flex-1" />
      <DatePicker v-model="forDate" label="Delivery date" :min="state.ctx.today" class="w-44" />
      <Badge size="lg" variant="subtle" :theme="filled ? 'blue' : 'gray'" :label="`${filled} of ${lines.length} filled`" />
    </div>

    <Alert v-if="lockText" theme="gray" :title="lockText" />
    <Alert v-else-if="lateText" theme="amber" :title="lateText" />

    <div class="overflow-x-auto">
      <List :columns="cols" class="card min-w-[640px] list-row-px-3" ref="table">
        <ListHeader>
          <ListHeaderCell>Item</ListHeaderCell><ListHeaderCell class="justify-end">Here now</ListHeaderCell><ListHeaderCell class="justify-end">Usual</ListHeaderCell>
          <ListHeaderCell class="justify-end">Qty</ListHeaderCell><ListHeaderCell>UOM</ListHeaderCell>
        </ListHeader>
        <ListRow v-for="(l, i) in lines" :key="l.item_code" class="min-h-11 py-1">
          <ListCell class="flex-col !items-start"><span class="w-full truncate text-base">{{ l.item_name }}</span><span class="text-xs text-ink-gray-4 num">{{ l.item_code }}{{ l.extra ? ' · added' : '' }}</span></ListCell>
          <ListCell class="justify-end text-ink-gray-6 num">{{ fmt(l.stock_here) }} {{ l.stock_uom }}</ListCell>
          <ListCell class="justify-end text-ink-gray-4 num">{{ l.usual ? fmt(l.usual) + ' ' + l.usual_uom : '' }}</ListCell>
          <ListCell><TextInput class="qty w-full" type="number" min="0" step="any" inputmode="decimal" variant="outline" :model-value="l.qty" @update:model-value="(v) => (l.qty = v)" :disabled="!editable" :aria-label="'Qty for ' + l.item_name" @keydown.enter.prevent="nextInput($event)" /></ListCell>
          <ListCell class="flex-col !items-start">
            <Select v-if="l.uoms.length > 1" v-model="l.uom" :options="l.uoms.map((u) => ({ value: u.uom, label: u.factor === 1 ? u.uom : `${u.uom} (${fmt(u.factor)} ${l.stock_uom})` }))" :disabled="!editable" class="w-full" />
            <span v-else class="px-1 text-ink-gray-6">{{ l.uom }}</span>
            <span v-if="factorOf(l) !== 1 && Number(l.qty) > 0" class="px-1 text-xs text-ink-blue-5 num">= {{ fmt(Number(l.qty) * factorOf(l)) }} {{ l.stock_uom }}</span>
          </ListCell>
        </ListRow>
        <Empty v-if="form.data && !lines.length">No list for {{ provider }} yet. Add the items you need below.</Empty>
      </List>
    </div>
    <div v-if="editable" class="flex max-w-md items-center gap-2">
      <ItemSearch class="flex-1" method="search_items" :params="(q) => ({ provider, txt: q })" :exclude="lines.map((l) => l.item_code)" placeholder="Add an item not on your list…" @add="addItem" />
    </div>
    <div v-if="form.data && (editable || noteOpen)" class="max-w-xl space-y-2">
      <Textarea v-model="note" :label="'Note for ' + provider" :rows="2" variant="outline" placeholder="Anything the storekeeper should know: substitutes, timing, items you forgot to list…" />
      <Button v-if="!editable" label="Save note" :loading="noteSaver.loading" @click="saveNote" />
    </div>
    <p class="text-p-sm text-ink-gray-5">Blank lines are not ordered. Enter moves to the next line. Stock always moves in the stock UOM.</p>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Alert, Badge, Button, DatePicker, Dropdown, Select, TabButtons, TextInput, Textarea, toast } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import Header from '../components/Header.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Empty from '../components/Empty.vue'
import ItemSearch from '../components/ItemSearch.vue'
import { useRead, useWrite, errText, fmt, blank } from '../api'
import { state } from '../state'

const route = useRoute(), router = useRouter()
const isProv = computed(() => state.location.location_type === 'Provider')
const providers = computed(() => (isProv.value ? (state.location.orders_from ? [state.location.orders_from] : []) : state.ctx.providers.map((p) => p.name)))
const provider = computed(() => route.params.provider || providers.value[0])
const forDate = ref(state.ctx.for_date)
const cols = ['minmax(180px,1fr)', '6rem', '6rem', '7rem', '10rem']
const lines = ref([])
const mode = ref(0)
const note = ref('')

const form = useRead('get_order_form', () => ({ location_name: state.location.name, provider: provider.value, for_date: forDate.value }), {
  onSuccess: (d) => { lines.value = d.lines.map((l) => ({ ...l, qty: l.qty ?? '' })); note.value = (d.order && d.order.note) || '' },
})
const saver = useWrite('save_order')
const noteSaver = useWrite('update_order_note')
const noteOpen = computed(() => !!(form.data && form.data.order && ['Draft', 'Submitted'].includes(form.data.status)))
async function saveNote() {
  try {
    await noteSaver.submit({ name: order.value.name, note: note.value })
    toast.success('Note saved')
    form.reload()
  } catch (e) { toast.error(errText(e)) }
}
const order = computed(() => form.data && form.data.order)
const editable = computed(() => !!(form.data && form.data.editable))
const filled = computed(() => lines.value.filter((l) => Number(l.qty) > 0).length)
const lockText = computed(() => {
  const d = form.data
  if (!d || d.editable || d.status === 'New') return ''
  if (d.status === 'Submitted') return `Submitted. Changes closed at ${d.cutoff.change_cutoff || 'the cutoff'}; ask ${provider.value} to change it, or add a note below.`
  return `This order is ${String(d.status).toLowerCase()}.`
})
const lateText = computed(() => {
  const d = form.data
  if (!d || !d.cutoff || d.cutoff.orders_open || d.status === 'Submitted') return ''
  return `Orders for this date closed at ${d.cutoff.order_cutoff}. You can still submit; it goes to ${provider.value} as a late order.`
})
const factorOf = (l) => (l.uoms.find((u) => u.uom === l.uom) || { factor: 1 }).factor

function go(p) { router.replace('/order/' + encodeURIComponent(p)) }
function clearAll() { lines.value.forEach((l) => (l.qty = '')) }
function fillUsual() { lines.value.forEach((l) => { if (l.usual) { l.qty = l.usual; l.uom = l.usual_uom || l.uom } }) }
function nextInput(e) {
  const all = [...document.querySelectorAll('.qty input:not(:disabled)')]
  const next = all[all.indexOf(e.target) + 1]
  if (next) { next.focus(); next.select() }
}
function addItem(r) {
  lines.value.push({ item_code: r.item_code, item_name: r.item_name, uom: r.stock_uom, stock_uom: r.stock_uom, uoms: [{ uom: r.stock_uom, factor: 1 }], qty: '', stock_here: 0, extra: 1 })
}
async function save(submit) {
  mode.value = submit
  try {
    const r = await saver.submit({ location_name: state.location.name, provider: provider.value, for_date: forDate.value, submit, note: note.value,
      lines: lines.value.filter((l) => !blank(l.qty)).map((l) => ({ item_code: l.item_code, uom: l.uom, qty: Number(l.qty) })) })
    if (!r.name) toast.info('Nothing to save yet')
    else toast.success(submit ? `${r.name} sent to ${provider.value}${r.is_late ? ' as a late order' : ''}` : `${r.name} saved as draft`)
    form.reload()
  } catch (e) { toast.error(errText(e)) }
}
</script>
