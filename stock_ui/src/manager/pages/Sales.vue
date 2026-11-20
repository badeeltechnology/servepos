<template>
  <Header title="Sales" :subtitle="subtitle">
    <Button label="Excel" icon-left="lucide-download" @click="exportXlsx" />
  </Header>
  <div class="space-y-4 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-end gap-2">
      <Select v-model="outlet" :options="outletOptions()" class="w-56" aria-label="Outlet" />
      <TabButtons :options="presets.map((p) => ({ label: p.label, value: p.key }))" v-model="preset" />
      <DateRangePicker v-if="preset === 'custom'" v-model="custom" class="w-60" />
    </div>
    <TabButtons v-model="tab" :options="[{ label: 'Summary', value: 'summary' }, { label: 'Items', value: 'items' }, { label: 'Invoices', value: 'invoices' }, { label: 'Voids', value: 'voids' }]" />

    <!-- summary -->
    <template v-if="tab === 'summary'">
      <div v-if="!d" class="py-10"><LoadingText /></div>
      <template v-else>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberCard title="Sales" :prefix="curP" :value="s.total_sales" :format="num2" :delta-caption="s.total_tax ? `net ${num2(s.net_total)} + tax ${num2(s.total_tax)}` : ''" />
          <NumberCard title="Orders" :value="s.order_count" :delta-caption="`average ${num2(s.avg_order)}`" />
          <NumberCard title="Guests" :value="s.total_guests" :delta-caption="s.total_guests ? `${num2(s.total_sales / s.total_guests)} per guest` : ''" />
          <NumberCard title="Tips" :prefix="curP" :value="s.total_tips" :format="num2" />
        </div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Table title="Payment methods" :cols="['Method', 'Amount', 'Share']" :rows="s.payment_breakdown.map((p) => [p.mode_of_payment, num2(p.total), pctOf(p.total, payTotal)])" />
          <Table title="Order types" :cols="['Type', 'Orders', 'Sales']" :rows="s.order_type_breakdown.map((t) => [t.type, t.count, num2(t.total)])" />
          <Table title="Categories" :cols="['Category', 'Qty', 'Sales']" :rows="s.category_breakdown.map((c) => [c.category, fmt(c.qty, 2), num2(c.amount)])" />
          <Table v-if="d.days > 1" title="By day" :cols="['Day', 'Orders', 'Sales']" :rows="s.daily_sales.map((x) => [fmtDate(x.date), x.count, num2(x.total)])" />
          <Table title="Waiters" :cols="['Waiter', 'Orders', 'Sales']" :rows="(s.waiter_breakdown || []).map((w) => [w.waiter, w.count, num2(w.total)])" />
          <Table title="Cashiers" :cols="['Cashier', 'Orders', 'Sales']" :rows="s.cashier_breakdown.map((c) => [c.cashier, c.count, num2(c.total)])" />
          <Table v-if="!outlet" title="Outlets" :cols="['Outlet', 'Orders', 'Sales']" :rows="d.outlets.filter((o) => o.order_count).map((o) => [o.pos_profile, o.order_count, num2(o.total_sales)])" />
        </div>
      </template>
    </template>

    <!-- items -->
    <template v-if="tab === 'items'">
      <div class="flex flex-wrap items-center gap-2">
        <TextInput v-model="iq" placeholder="Search items" class="w-56"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
        <TabButtons v-model="isort" :options="[{ label: 'By sales', value: 'amount' }, { label: 'By quantity', value: 'qty' }]" />
        <label class="flex items-center gap-2 text-sm text-ink-gray-6"><Checkbox v-model="showZero" /> Show items not sold</label>
      </div>
      <div class="overflow-x-auto">
        <List :columns="['3rem', 'minmax(180px,1fr)', '10rem', '6rem', '8rem']" class="-mx-3 min-w-[600px] list-row-px-3">
          <ListHeader><ListHeaderCell>#</ListHeaderCell><ListHeaderCell>Item</ListHeaderCell><ListHeaderCell>Category</ListHeaderCell><ListHeaderCell class="justify-end">Qty</ListHeaderCell><ListHeaderCell class="justify-end">Sales</ListHeaderCell></ListHeader>
          <ListRows :items="items" row-key="item_code" v-slot="{ item, index }">
            <ListRow class="min-h-10" :class="item.total_qty ? '' : 'opacity-50'">
              <ListCell class="text-ink-gray-5 num">{{ index + 1 }}</ListCell>
              <ListCell class="flex-col !items-start"><span class="truncate">{{ item.item_name }}</span><span class="text-xs text-ink-gray-4">{{ item.item_code }}</span></ListCell>
              <ListCell class="text-sm text-ink-gray-6">{{ item.item_group }}</ListCell>
              <ListCell class="justify-end num">{{ fmt(item.total_qty, 2) }}</ListCell>
              <ListCell class="justify-end text-base-medium num">{{ num2(item.total_amount) }}</ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>
      <div v-if="d && !items.length" class="py-10 text-center text-p-sm text-ink-gray-5">No items sold in this period.</div>
    </template>

    <!-- invoices -->
    <template v-if="tab === 'invoices'">
      <div class="flex flex-wrap items-center gap-2">
        <TextInput v-model="invq" placeholder="Invoice, order number or customer" class="w-72" :debounce="300"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
        <span class="text-p-sm text-ink-gray-6">{{ inv.total }} invoices · {{ curP }}{{ num2(inv.amount) }}</span>
      </div>
      <div class="overflow-x-auto">
        <List :columns="['minmax(13rem,1.2fr)', 'minmax(9rem,1fr)', '8rem', '6rem', '8rem', '7rem', '7rem']" class="-mx-3 min-w-[820px] list-row-px-3">
          <ListHeader><ListHeaderCell>Order</ListHeaderCell><ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell>Synced</ListHeaderCell><ListHeaderCell>Table</ListHeaderCell><ListHeaderCell>Waiter</ListHeaderCell><ListHeaderCell>Payment</ListHeaderCell><ListHeaderCell class="justify-end">Total</ListHeaderCell></ListHeader>
          <ListRows :items="inv.rows" v-slot="{ item }">
            <ListRow class="min-h-10" @click="openInvoice(item.name)">
              <ListCell class="min-w-0 flex-col !items-start"><span class="w-full truncate">{{ item.order_number || item.name }}</span><span class="text-xs text-ink-gray-4">{{ item.name }}</span></ListCell>
              <ListCell class="truncate text-sm text-ink-gray-6">{{ item.pos_profile }}</ListCell>
              <ListCell class="text-sm">{{ fmtTime(item.creation) }}</ListCell>
              <ListCell class="text-sm">{{ item.table_name }}</ListCell>
              <ListCell class="text-sm">{{ item.waiter }}</ListCell>
              <ListCell class="text-sm">{{ item.payments }}</ListCell>
              <ListCell class="justify-end text-base-medium num" :class="item.is_return ? 'text-ink-red-6' : ''">{{ num2(item.grand_total) }}</ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>
      <div v-if="invLoading" class="py-6"><LoadingText /></div>
      <div v-else-if="!inv.rows.length" class="py-10 text-center text-p-sm text-ink-gray-5">No invoices in this period.</div>
      <div v-if="inv.rows.length < inv.total" class="flex justify-center"><Button :label="`Show more (${inv.total - inv.rows.length} left)`" :loading="invLoading" @click="loadInvoices(true)" /></div>
    </template>

    <!-- voids -->
    <template v-if="tab === 'voids'">
      <div v-if="d" class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Table title="By reason" :cols="['Reason', 'Count', 'Amount']" :rows="s.void_summary.by_reason.map((v) => [v.reason, v.count, num2(v.amount)])" />
        <Table title="By staff" :cols="['Voided by', 'Count', 'Amount']" :rows="s.void_summary.by_staff.map((v) => [v.staff, v.count, num2(v.amount)])" />
        <Table title="Waste or back to stock" :cols="['What happened', 'Count', 'Amount']" :rows="s.void_summary.by_disposition.map((v) => [v.disposition, v.count, num2(v.amount)])" />
      </div>
      <div class="overflow-x-auto">
        <List :columns="['9rem', '8rem', 'minmax(140px,1fr)', '9rem', '8rem', '8rem', '7rem']" class="-mx-3 min-w-[820px] list-row-px-3">
          <ListHeader><ListHeaderCell>Order</ListHeaderCell><ListHeaderCell>Type</ListHeaderCell><ListHeaderCell>Reason</ListHeaderCell><ListHeaderCell>What happened</ListHeaderCell><ListHeaderCell>By</ListHeaderCell><ListHeaderCell>When</ListHeaderCell><ListHeaderCell class="justify-end">Amount</ListHeaderCell></ListHeader>
          <ListRows :items="voids.data || []" v-slot="{ item }">
            <ListRow class="min-h-10" @click="openVoid(item)">
              <ListCell class="truncate">{{ item.order_number || item.name }}</ListCell>
              <ListCell><Badge :theme="item.void_type === 'Item Void' ? 'amber' : 'red'" :label="item.void_type" /></ListCell>
              <ListCell class="truncate text-sm">{{ item.void_reason }}</ListCell>
              <ListCell class="text-sm">{{ item.void_disposition }}</ListCell>
              <ListCell class="text-sm">{{ item.voided_by }}</ListCell>
              <ListCell class="text-sm">{{ fmtTime(item.void_date) }}</ListCell>
              <ListCell class="justify-end num">{{ num2(item.grand_total) }}</ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>
      <div v-if="voids.data && !voids.data.length" class="py-10 text-center text-p-sm text-ink-gray-5">No voids in this period.</div>
    </template>
  </div>

  <Dialog v-model:open="detail.open" :title="detail.title" size="2xl">
    <div v-if="!detail.d" class="py-6"><LoadingText /></div>
    <div v-else class="space-y-4">
      <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-base sm:grid-cols-3">
        <template v-for="[k, v] in detailFacts" :key="k"><div><div class="text-xs text-ink-gray-5">{{ k }}</div><div>{{ v }}</div></div></template>
      </div>
      <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
        <div v-for="(i, n) in detail.d.items || []" :key="n" class="grid grid-cols-[1fr_4rem_6rem] gap-2 px-3 py-1.5">
          <div><div>{{ i.item_name }}</div><div v-if="i.modifiers" class="text-xs text-ink-gray-5">{{ i.modifiers }}</div><div v-if="i.comment || i.void_reason" class="text-xs text-ink-amber-6">{{ i.comment || i.void_reason }}</div></div>
          <div class="text-right num">× {{ fmt(i.qty, 2) }}</div><div class="text-right num">{{ num2(i.amount) }}</div>
        </div>
      </div>
      <div v-if="(detail.d.payments || []).length" class="text-base">Paid: <span v-for="p in detail.d.payments" :key="p.mode_of_payment" class="mr-3">{{ p.mode_of_payment }} {{ num2(p.amount) }}</span></div>
      <a v-if="detail.d.desk_url" :href="detail.d.desk_url" target="_blank" class="text-base text-ink-blue-6 hover:underline">Open in ERPNext</a>
    </div>
  </Dialog>
</template>

<script setup>
import { computed, h, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, Button, Checkbox, DateRangePicker, Dialog, LoadingText, Select, TabButtons, TextInput } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { NumberCard } from 'frappe-ui/charts'
import Header from '../../components/Header.vue'
import { useRead, get } from '../api'
import { fmt, fmtDate, fmtTime } from '../../api'
import { state, setOutlet, outletOptions } from '../state'
import { usePeriod } from '../period'

const route = useRoute()
const { presets, preset, custom, range } = usePeriod('today', route.query)
const outlet = ref(state.outlet)
watch(outlet, (v) => setOutlet(v))
const tab = ref(route.query.tab || 'summary')
const params = () => ({ pos_profile: outlet.value || null, from_date: range.value[0], to_date: range.value[1] })
const dash = useRead('manager.get_dashboard', params)
const d = computed(() => dash.data)
const s = computed(() => (d.value ? d.value.sales : {}))
const curP = state.ctx.currency ? state.ctx.currency + ' ' : ''
const num2 = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const payTotal = computed(() => (s.value.payment_breakdown || []).reduce((a, p) => a + p.total, 0))
const pctOf = (v, t) => (t ? Math.round((v / t) * 100) + ' %' : '')
const subtitle = computed(() => (outlet.value || 'All outlets') + ' · ' + (range.value[0] === range.value[1] ? fmtDate(range.value[0]) : fmtDate(range.value[0]) + ' to ' + fmtDate(range.value[1])))

// small table used across the summary
const Table = (props) => h('section', { class: 'space-y-2' }, [
  h('h2', { class: 'text-base-semibold' }, props.title),
  h('div', { class: 'rounded-6 border border-outline-gray-2 divide-y divide-outline-gray-1' }, [
    h('div', { class: 'grid grid-cols-[1fr_6rem_8rem] gap-2 px-3 py-1.5 text-xs text-ink-gray-5' }, props.cols.map((c, j) => h('span', { class: j ? 'text-right' : '' }, c))),
    ...(props.rows.length
    ? props.rows.map((r, i) => h('div', { key: i, class: 'grid grid-cols-[1fr_6rem_8rem] gap-2 px-3 py-1.5 text-base' }, r.map((c, j) => h('span', { class: j ? 'text-right num' : 'truncate' }, c))))
    : [h('div', { class: 'px-3 py-4 text-p-sm text-ink-gray-5' }, 'Nothing in this period.')])]),
])
Table.props = ['title', 'cols', 'rows']

const iq = ref(''), isort = ref('amount'), showZero = ref(false)
const items = computed(() => (s.value.top_items || [])
  .filter((i) => (showZero.value || i.total_qty) && (!iq.value || (i.item_name + ' ' + i.item_code).toLowerCase().includes(iq.value.toLowerCase())))
  .sort((a, b) => (isort.value === 'qty' ? b.total_qty - a.total_qty : b.total_amount - a.total_amount)))

const inv = reactive({ rows: [], total: 0, amount: 0 }), invq = ref(''), invLoading = ref(false)
async function loadInvoices(more = false) {
  invLoading.value = true
  try {
    const r = await get('manager.list_invoices', { ...params(), search: invq.value || null, start: more ? inv.rows.length : 0, page_length: 50 })
    inv.rows = more ? [...inv.rows, ...r.rows] : r.rows
    inv.total = r.total
    inv.amount = r.amount
  } finally { invLoading.value = false }
}
watch([tab, outlet, range, invq], () => { if (tab.value === 'invoices') loadInvoices() }, { immediate: true })
const voids = useRead('manager.list_voids', params, { immediate: false })
watch([tab, outlet, range], () => { if (tab.value === 'voids') voids.reload() }, { immediate: true })

const detail = reactive({ open: false, title: '', d: null, kind: '' })
async function openInvoice(name) {
  Object.assign(detail, { open: true, title: name, d: null, kind: 'invoice' })
  detail.d = await get('manager.get_invoice', { name })
  detail.title = detail.d.order_number || name
}
function openVoid(v) { Object.assign(detail, { open: true, title: `${v.void_type}: ${v.order_number || v.name}`, d: { ...v, items: v.items || [], desk_url: v.invoice_name ? `/app/sales-invoice/${v.invoice_name}` : '' }, kind: 'void' }) }
const detailFacts = computed(() => {
  const x = detail.d || {}
  if (detail.kind === 'void') return [['Reason', x.void_reason], ['What happened', x.void_disposition], ['Voided by', x.voided_by], ['When', fmtTime(x.void_date)], ['Amount', num2(x.grand_total)], ['Outlet', x.pos_profile], ['Table', x.table_name], ['Note', x.void_remarks]].filter(([, v]) => v)
  return [['Total', num2(x.grand_total)], ['Paid', num2(x.paid_amount)], ['Outlet', x.pos_profile], ['Date', fmtDate(x.posting_date)], ['Customer', x.customer_name || 'Walk in'],
    ['Order type', x.order_type], ['Table', x.table], ['Waiter', x.waiter], ['Cashier', x.cashier], ['Tip', x.tip ? num2(x.tip) : ''], ['Discount', x.discount_amount ? num2(x.discount_amount) : ''],
    ['Discount reason', x.discount_reason], ['Change', x.change_amount ? num2(x.change_amount) : ''], ['Note', x.remarks]].filter(([, v]) => v)
})

function exportXlsx() {
  const q = new URLSearchParams({ from_date: range.value[0], to_date: range.value[1] })
  if (outlet.value) q.set('pos_profile', outlet.value)
  window.open('/api/method/servepos.api.manager.export_sales?' + q, '_blank')
}
</script>
