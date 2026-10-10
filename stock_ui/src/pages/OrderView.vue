<template>
  <Header :title="title" back="/">
    <template #status>
      <StatusBadge v-if="d" :status="d.doc.status" />
      <Badge v-if="d && d.doc.is_emergency" label="Emergency" theme="red" variant="subtle" />
      <Badge v-if="d && d.doc.is_late" label="Late" theme="amber" variant="subtle" />
    </template>
    <template v-if="d">
      <DownloadMenu kind="order" :params="{ name: d.doc.name }" label="" />
      <Button v-if="d.can_edit_note" :label="d.doc.note ? 'Edit note' : 'Add note'" icon-left="lucide-message-square-plus" @click="editNote" />
      <Button v-if="d.can_cancel" :label="isTransfer && isGiver ? 'Decline' : 'Cancel order'" theme="red" @click="cancel" />
      <template v-if="mode === 'ship'">
        <Button label="Same as ordered" @click="setAll('ordered')" />
        <Button variant="solid" :label="isTransfer ? 'Approve and send' : 'Ship'" :loading="shipper.loading" @click="ship" />
      </template>
      <template v-if="mode === 'receive'">
        <Button label="All arrived as shipped" @click="setAll('shipped')" />
        <Button variant="solid" label="Confirm received" :loading="receiver.loading" @click="receive" />
      </template>
      <Button v-if="mode === 'resolve'" variant="solid" label="Resolve" :loading="resolver.loading" @click="resolve" />
    </template>
  </Header>

  <div v-if="d" class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <div class="card grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-5">
      <Field label="From" :value="d.doc.from_location" />
      <Field label="To" :value="d.doc.to_location" />
      <Field label="For" :value="fmtDate(d.doc.for_date)" />
      <Field :label="isDelivery ? 'Sent' : 'Ordered'" :value="d.doc.submitted_on ? fmtTime(d.doc.submitted_on) + ' · ' + who(d.doc.requested_by) : '-'" />
      <Field label="Shipped" :value="d.doc.shipped_on ? fmtTime(d.doc.shipped_on) + ' · ' + who(d.doc.shipped_by) : '-'" />
      <Field v-if="d.doc.received_on" label="Received" :value="fmtTime(d.doc.received_on) + ' · ' + who(d.doc.received_by)" />
      <Field v-if="d.doc.reason" label="Reason" :value="d.doc.reason" />
      <Field v-if="d.see_amounts && d.doc.markup_amount" label="Markup" :value="fmt(d.doc.markup_percent, 2) + '% = ' + fmt(d.doc.markup_amount, 2)" />
      <Field v-if="d.doc.receive_note" label="Receive note" :value="d.doc.receive_note" class="col-span-2" />
    </div>

    <Alert v-if="d.doc.note" theme="blue" :title="'Note from ' + (d.doc.order_type === 'Return' || isDelivery ? d.doc.from_location : d.doc.to_location)" :description="d.doc.note" />

    <Alert v-if="hint" :theme="hint.theme" :title="hint.text" />

    <SearchInput v-if="lines.length > 8" v-model="q" placeholder="Find an item" />
    <div class="overflow-x-auto">
      <List :columns="cols" class="card min-w-[680px] list-row-px-3">
        <ListHeader>
          <ListHeaderCell>Item</ListHeaderCell><ListHeaderCell>UOM</ListHeaderCell><ListHeaderCell class="justify-end">{{ isDelivery ? 'Sent' : 'Ordered' }}</ListHeaderCell>
          <ListHeaderCell class="justify-end">{{ mode === 'ship' ? (isTransfer ? 'You have' : 'In stock') : 'Shipped' }}</ListHeaderCell>
          <ListHeaderCell class="justify-end">{{ mode === 'ship' ? 'Ship' : 'Received' }}</ListHeaderCell>
          <ListHeaderCell :class="mode === 'ship' || mode === 'resolve' ? '' : 'justify-end'">{{ mode === 'ship' ? 'Remark' : mode === 'resolve' ? 'Missing stock goes' : 'Difference' }}</ListHeaderCell>
        </ListHeader>
        <ListRow v-for="l in shownLines" :key="l.row || 'new-' + l.item_code" class="min-h-11 py-1" :class="rowCls(l)">
          <ListCell class="flex-col !items-start">
            <span class="flex w-full items-center gap-2"><span class="truncate text-base">{{ l.item_name }}</span>
              <Badge v-if="mode !== 'ship' && l.is_86 && d.doc.shipped_on" label="Not available" theme="amber" variant="subtle" size="sm" />
              <Badge v-if="l.extra || (!l.qty_ordered && l.qty_shipped > 0)" :label="'Added by ' + d.doc.from_location" theme="blue" variant="subtle" size="sm" />
              <Badge v-if="mode === 'receive' && !l.is_86 && l.qty_shipped < l.qty_ordered" label="part" theme="amber" variant="subtle" size="sm" /></span>
            <span class="text-xs text-ink-gray-4 num">{{ l.item_code }}{{ l.factor !== 1 ? ` · 1 ${l.uom} = ${fmt(l.factor)} ${l.stock_uom}` : '' }}</span>
          </ListCell>
          <ListCell class="text-ink-gray-6">{{ l.uom }}</ListCell>
          <ListCell class="justify-end text-ink-gray-6 num">{{ fmt(l.qty_ordered) }}</ListCell>
          <ListCell v-if="mode === 'ship'" class="justify-end num" :class="l.from_stock / l.factor < Number(l.v) && !d.records_production ? 'text-ink-red-6' : 'text-ink-gray-6'">{{ fmt(l.from_stock / l.factor) }}</ListCell>
          <ListCell v-else class="justify-end text-base-medium num">{{ d.doc.shipped_on ? fmt(l.qty_shipped) : '' }}</ListCell>

          <template v-if="mode === 'ship'">
            <ListCell class="gap-1">
              <TextInput class="qty w-full" type="number" min="0" step="any" inputmode="decimal" variant="outline" :model-value="l.v" @update:model-value="(v) => (l.v = v)" :aria-label="'Ship qty for ' + l.item_name" @keydown.enter.prevent="nextInput($event)" />
              <Button v-if="l.extra" size="sm" icon="lucide-x" variant="subtle" :tooltip="'Remove ' + l.item_name" :aria-label="'Remove ' + l.item_name" @click="lines.splice(lines.indexOf(l), 1)" />
              <Button v-else size="sm" label="Not available" :variant="isZero(l.v) ? 'solid' : 'subtle'" :theme="isZero(l.v) ? 'red' : 'gray'" :tooltip="'We do not have it: ship 0'" @click="l.v = 0" />
            </ListCell>
            <ListCell><TextInput class="w-full" variant="outline" v-model="l.remark" :aria-label="'Remark for ' + l.item_name" placeholder="" /></ListCell>
          </template>
          <template v-else-if="mode === 'receive'">
            <ListCell>
              <TextInput v-if="l.qty_shipped > 0" class="qty w-full" type="number" min="0" step="any" inputmode="decimal" variant="outline" :model-value="l.v" @update:model-value="(v) => (l.v = v)" :aria-label="'Received qty for ' + l.item_name" @keydown.enter.prevent="nextInput($event)" />
              <span v-else class="w-full text-right text-ink-gray-4">not sent</span>
            </ListCell>
            <ListCell class="justify-end text-base-medium num" :class="liveDiff(l) < 0 ? 'text-ink-red-6' : 'text-ink-green-6'">{{ liveDiff(l) === null ? '' : signed(liveDiff(l)) }}</ListCell>
          </template>
          <template v-else>
            <ListCell class="justify-end num">{{ d.doc.received_on ? fmt(l.qty_received) : '' }}</ListCell>
            <ListCell v-if="mode === 'resolve' && l.difference > 0">
              <TabButtons :options="[{ value: 'Back to provider', label: 'Back to stock' }, { value: 'Write off', label: 'Write off' }]" v-model="l.res" />
            </ListCell>
            <ListCell v-else class="justify-end num" :class="l.difference > 0 ? 'text-ink-red-6' : 'text-ink-gray-5'">{{ d.doc.received_on ? (l.difference > 0 ? '-' + fmt(l.difference) + (l.resolution ? ' · ' + l.resolution : '') : '0') : l.remark || '' }}</ListCell>
          </template>
        </ListRow>
      </List>
    </div>
    <div v-if="mode === 'ship'" class="flex max-w-md items-center gap-2">
      <ItemSearch class="flex-1" method="get_stock_items" :params="(q) => ({ location_name: d.doc.from_location, txt: q })" :exclude="lines.map((l) => l.item_code)" placeholder="Add an item (substitute or extra)…" all @add="addLine" />
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <p class="flex-1 text-p-sm" :class="footer.cls">{{ footer.text }}</p>
      <TextInput v-if="mode === 'receive'" v-model="note" class="w-72" placeholder="Note for the provider (optional)" aria-label="Receive note" />
    </div>
    <div v-if="entries.length && state.ctx.desk" class="flex flex-wrap gap-3 text-sm text-ink-gray-5">
      <span>ERPNext entries:</span>
      <a v-for="e in entries" :key="e.name" :href="e.href" target="_blank" class="text-ink-blue-link underline">{{ e.label }} {{ e.name }}</a>
    </div>
  </div>
  <div v-else class="px-5 pt-5"><ErrorMessage v-if="view.error" :message="errText(view.error)" /><LoadingText v-else /></div>
</template>
<script setup>
import { computed, defineComponent, h, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Alert, Badge, Button, ErrorMessage, LoadingText, TabButtons, TextInput, dialog, toast } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import Header from '../components/Header.vue'
import ItemSearch from '../components/ItemSearch.vue'
import StatusBadge from '../components/StatusBadge.vue'
import DownloadMenu from '../components/DownloadMenu.vue'
import SearchInput from '../components/SearchInput.vue'
import { useRead, useWrite, errText, fmt, fmtDate, fmtTime, who, blank, matches } from '../api'
import { state } from '../state'

const Field = defineComponent({
  props: { label: String, value: String },
  setup: (p) => () => h('div', { class: 'flex min-w-0 flex-col gap-1' }, [h('span', { class: 'text-sm text-ink-gray-5' }, p.label), h('span', { class: 'truncate text-base text-ink-gray-8', title: p.value }, p.value)]),
})

const route = useRoute()
const lines = ref([]), note = ref('')
const cols = ['minmax(160px,1fr)', '4.5rem', '4.5rem', '5rem', '13rem', 'minmax(6rem,13rem)']
const q = ref('')
const shownLines = computed(() => lines.value.filter((l) => matches(q.value, l.item_name, l.item_code)))
const view = useRead('get_order', () => ({ name: route.params.name }), {
  onSuccess: (r) => { lines.value = r.lines.map((l) => ({ ...l, v: r.can_ship ? l.qty_ordered : '', res: l.resolution || 'Back to provider', remark: l.remark || '' })) },
})
const shipper = useWrite('ship'), receiver = useWrite('receive'), resolver = useWrite('resolve'), canceller = useWrite('cancel_order'), noteSaver = useWrite('update_order_note')
const d = computed(() => view.data)
const isTransfer = computed(() => d.value && d.value.doc.order_type === 'Transfer')
const isDelivery = computed(() => d.value && d.value.doc.order_type === 'Delivery')
const isGiver = computed(() => d.value && state.location && state.location.name === d.value.doc.from_location)
const mode = computed(() => (!d.value ? '' : d.value.can_ship ? 'ship' : d.value.can_receive ? 'receive' : d.value.can_resolve ? 'resolve' : 'view'))
const title = computed(() => {
  if (!d.value) return route.params.name
  const t = d.value.doc
  return `${t.order_type === 'Order' ? 'Order' : t.order_type} ${t.name}`
})
const isZero = (v) => !blank(v) && Number(v) === 0
const signed = (n) => (n === 0 ? '0' : (n > 0 ? '+' : '') + fmt(n))
const liveDiff = (l) => (blank(l.v) || !(l.qty_shipped > 0) ? null : Number(l.v) - l.qty_shipped)
const rowCls = (l) => {
  if (mode.value === 'receive' && liveDiff(l) !== null && liveDiff(l) < 0) return 'bg-surface-red-1'
  if (mode.value === 'receive' && liveDiff(l) !== null && liveDiff(l) > 0) return 'bg-surface-amber-1'
  if (mode.value === 'resolve' && l.difference > 0) return 'bg-surface-red-1'
  if (mode.value === 'ship' && isZero(l.v)) return 'text-ink-gray-5'
  return ''
}
const hint = computed(() => {
  if (!d.value) return null
  const t = d.value.doc
  if (mode.value === 'ship' && isTransfer.value) return { theme: 'blue', text: `${t.to_location} asks for these items. Type what you can give (0 for none) and approve. Stock leaves now and reaches them when they confirm.` }
  if (mode.value === 'ship' && d.value.records_production) return { theme: 'gray', text: `If ${t.from_location} has less than you ship, the difference is recorded as produced today before it leaves.` }
  if (mode.value === 'ship' && t.is_emergency) return { theme: 'red', text: `Emergency order from ${t.to_location}${t.reason ? ': ' + t.reason : ''}. Ship it on its own, not with the day's order.` }
  if (mode.value === 'ship' && t.is_late) return { theme: 'amber', text: 'Late order: shipping it approves it. Cancel it if you cannot take it.' }
  if (mode.value === 'resolve') return { theme: 'red', text: `${t.to_location} received less than you shipped. For each short line choose: back into your stock, or write off as a loss.` }
  if (t.status === 'Submitted' && !d.value.can_ship) return { theme: 'gray', text: `Waiting for ${t.from_location} to ${isTransfer.value ? 'approve' : 'ship'}.` }
  if (mode.value === 'receive' && isDelivery.value) return { theme: 'blue', text: `${t.from_location} sent this without an order. Check what arrived and confirm.` }
  if (t.status === 'Shipped' && !d.value.can_receive) return { theme: 'gray', text: `On the way to ${t.to_location}. It stays in Goods In Transit until they confirm what arrived.` }
  if (t.status === 'Discrepancy' && !d.value.can_resolve) return { theme: 'amber', text: `Short delivery reported. ${t.from_location} decides what happens to the missing quantity.` }
  return null
})
const footer = computed(() => {
  if (mode.value === 'receive') {
    const left = lines.value.filter((l) => l.qty_shipped > 0 && blank(l.v)).length
    const short = lines.value.filter((l) => liveDiff(l) !== null && liveDiff(l) < 0).length
    if (left) return { cls: 'text-ink-gray-6', text: `${left} line${left > 1 ? 's' : ''} still to check.${short ? ` ${short} short so far.` : ''}` }
    const over = lines.value.filter((l) => liveDiff(l) !== null && liveDiff(l) > 0).length
    const overText = over ? ` ${over} line${over > 1 ? 's' : ''} with more than shipped: the extra is taken from ${d.value.doc.from_location}'s stock.` : ''
    if (short) return { cls: 'text-ink-red-6', text: `${short} line${short > 1 ? 's' : ''} short. On confirm, ${d.value.doc.from_location} decides: back to its stock or written off.${overText}` }
    if (over) return { cls: 'text-ink-amber-6', text: overText.trim() }
    return { cls: 'text-ink-gray-6', text: `Everything matches. On confirm, stock moves into ${d.value.doc.to_location}.` }
  }
  if (mode.value === 'ship') {
    const zero = lines.value.filter((l) => isZero(l.v)).length
    const less = lines.value.filter((l) => !blank(l.v) && Number(l.v) > 0 && Number(l.v) < l.qty_ordered).length
    return { cls: 'text-ink-gray-6', text: `${lines.value.length} lines · ${zero} not available · ${less} part shipped. Quantities are in the order UOM.` }
  }
  return { cls: 'text-ink-gray-5', text: `${lines.value.length} lines` }
})
const entries = computed(() => {
  if (!d.value) return []
  const t = d.value.doc, out = []
  const add = (label, name) => name && out.push({ label, name, href: `/app/stock-entry/${name}` })
  add('Produced', t.production_entry); add('Shipped', t.ship_entry); add('Received', t.receive_entry); add('Returned', t.return_entry); add('Written off', t.writeoff_entry)
  return out
})

function setAll(what) { lines.value.forEach((l) => (l.v = what === 'ordered' ? l.qty_ordered : l.qty_shipped > 0 ? l.qty_shipped : '')) }
function nextInput(e) {
  const all = [...document.querySelectorAll('.qty input:not(:disabled)')]
  const next = all[all.indexOf(e.target) + 1]
  if (next) { next.focus(); next.select() }
}
async function run(call, params, ok) {
  try { const r = await call.submit(params); toast.success(ok(r)); view.reload() }
  catch (e) { toast.error(errText(e)) }
}
function addLine(r) {
  lines.value.push({ row: null, extra: 1, item_code: r.item_code, item_name: r.item_name, uom: r.stock_uom, stock_uom: r.stock_uom, factor: 1,
    qty_ordered: 0, qty_shipped: 0, from_stock: r.actual_qty || 0, v: '', remark: '' })
  q.value = ''
}
function ship() {
  if (lines.value.some((l) => blank(l.v))) return toast.warning('Type a quantity on every line (0 if not available)')
  const go = () => run(shipper, { name: d.value.doc.name, lines: lines.value.map((l) => ({ row: l.row || null, item_code: l.item_code, uom: l.uom, qty_shipped: Number(l.v), remark: l.remark })) },
    (r) => (r.status === 'Closed' ? `${r.name} closed, nothing sent` : `${r.name} shipped`))
  if (lines.value.every((l) => Number(l.v) === 0)) {
    dialog.confirm({ title: isTransfer.value ? 'Send nothing?' : 'Nothing available', message: isTransfer.value ? 'This declines the request.' : 'The order closes without shipping anything.', confirmLabel: 'Close it', onConfirm: go })
  } else go()
}
function receive() {
  const over = lines.value.filter((l) => liveDiff(l) !== null && liveDiff(l) > 0)
  const go = () => run(receiver, { name: d.value.doc.name, note: note.value, lines: lines.value.filter((l) => l.qty_shipped > 0).map((l) => ({ row: l.row, qty_received: blank(l.v) ? null : Number(l.v) })) },
    (r) => (r.status === 'Discrepancy' ? `${r.name}: ${r.short_lines} short line(s) sent to ${d.value.doc.from_location}` : `${r.name} received`))
  if (!over.length) return go()
  dialog.confirm({
    title: 'More arrived than shipped?',
    message: over.map((l) => `${l.item_name}: ${fmt(Number(l.v))} received, ${fmt(l.qty_shipped)} shipped`).join('\n') + `\n\nThe extra is taken from ${d.value.doc.from_location}'s stock and added to yours.`,
    confirmLabel: 'Confirm received',
    onConfirm: go,
  })
}
function resolve() {
  run(resolver, { name: d.value.doc.name, lines: lines.value.filter((l) => l.difference > 0).map((l) => ({ row: l.row, resolution: l.res })) }, (r) => `${r.name} resolved`)
}
function editNote() {
  dialog.prompt({
    title: 'Note for ' + d.value.doc.from_location,
    fields: [{ name: 'note', type: 'textarea', label: 'Note', defaultValue: d.value.doc.note || '', placeholder: 'Substitutes, timing, items you forgot to list…' }],
    confirmLabel: 'Save note',
    onConfirm: async ({ values }) => {
      await noteSaver.submit({ name: d.value.doc.name, note: values.note || '' }).catch((e) => { throw new Error(errText(e)) })
      toast.success('Note saved')
      view.reload()
    },
  })
}
function cancel() {
  const decline = isTransfer.value && isGiver.value
  dialog.prompt({
    title: decline ? 'Decline this request?' : 'Cancel this order?',
    fields: [{ name: 'reason', label: 'Reason', placeholder: 'Optional' }],
    confirmLabel: decline ? 'Decline' : 'Cancel order',
    theme: 'red',
    onConfirm: async ({ values }) => {
      await canceller.submit({ name: d.value.doc.name, reason: values.reason || '' }).catch((e) => { throw new Error(errText(e)) })
      toast.success(decline ? 'Request declined' : 'Order cancelled')
      view.reload()
    },
  })
}
</script>
