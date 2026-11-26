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
    <TabButtons v-model="tab" :options="[{ label: 'Summary', value: 'summary' }, { label: 'Compare', value: 'compare' }, { label: 'Busy hours', value: 'hours' }, { label: 'Staff', value: 'staff' }, { label: 'Items', value: 'items' }, { label: 'Invoices', value: 'invoices' }, { label: 'Voids', value: 'voids' }]" />

    <!-- summary -->
    <template v-if="tab === 'summary'">
      <div v-if="!d" class="py-10"><LoadingText /></div>
      <template v-else>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <NumberCard title="Sales" :prefix="curP" :value="s.total_sales" :format="num2" :delta="pct(s.total_sales, d.previous.total_sales)" delta-suffix="%" :delta-format="num0" :delta-caption="cmpCaption('total_sales', true)" />
          <NumberCard title="Orders" :value="s.order_count" :delta="pct(s.order_count, d.previous.order_count)" delta-suffix="%" :delta-format="num0" :delta-caption="cmpCaption('order_count')" />
          <NumberCard title="Average bill" :prefix="curP" :value="s.avg_order" :format="num2" :delta="pct(s.avg_order, d.previous.avg_order)" delta-suffix="%" :delta-format="num0" :delta-caption="cmpCaption('avg_order', true)" />
          <NumberCard title="Guests" :value="s.total_guests" :delta="pct(s.total_guests, d.previous.total_guests)" delta-suffix="%" :delta-format="num0" :delta-caption="guestsOk ? `${num2(s.total_sales / s.total_guests)} per guest` : s.total_guests ? 'recorded on few orders' : ''" />
          <NumberCard title="Discounts" :prefix="curP" :value="s.total_discount" :format="num2" :delta="pct(s.total_discount, d.previous.total_discount)" delta-suffix="%" :delta-format="num0" negative-is-better
            :delta-caption="s.total_sales ? `${(s.total_discount / (s.total_sales + s.total_discount) * 100).toFixed(1)} % of sales` : ''" />
          <NumberCard title="Tips" :prefix="curP" :value="s.total_tips" :format="num2" :delta-caption="s.total_tax ? `tax ${num2(s.total_tax)}` : ''" />
        </div>
        <p class="text-p-sm text-ink-gray-5">Arrows compare with {{ span(d.previous) }}.<template v-if="d.last_year.total_sales"> Same dates last year: {{ curP }}{{ num2(d.last_year.total_sales) }} from {{ num0(d.last_year.order_count) }} orders ({{ fmtPct(pct(s.total_sales, d.last_year.total_sales)) }}).</template></p>
        <div v-if="d.days > 1" class="h-64"><BarChart title="Sales by day" :data="byDay" x="day" y="sales" :format="num2" /></div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SummaryList title="Payment methods" :rows="s.payment_breakdown" :cols="[{ key: 'mode_of_payment', label: 'Method' }, { key: 'total', label: 'Amount', align: 'right', format: num2 }, { key: 'share', label: 'Share', align: 'right', width: '5rem', format: (v, r) => pctOf(r.total, payTotal) }]" />
          <SummaryList title="Order types" :rows="s.order_type_breakdown" :cols="[{ key: 'type', label: 'Type' }, { key: 'count', label: 'Orders', align: 'right', width: '6rem' }, { key: 'total', label: 'Sales', align: 'right', format: num2 }]" />
          <SummaryList title="Categories" :rows="s.category_breakdown" :cols="[{ key: 'category', label: 'Category' }, { key: 'qty', label: 'Qty', align: 'right', width: '6rem', format: (v) => fmt(v, 2) }, { key: 'amount', label: 'Sales', align: 'right', format: num2 }]" />
          <SummaryList v-if="!outlet" title="Outlets" :rows="d.outlets.filter((o) => o.order_count || o.previous_sales)" :cols="[{ key: 'pos_profile', label: 'Outlet' }, { key: 'total_sales', label: 'Sales', align: 'right', format: num2 }, { key: 'change', label: 'Change', align: 'right', width: '6rem' }]">
            <template #cell-change="{ item }"><Badge v-bind="changeBadge(item.total_sales, item.previous_sales)" /></template>
          </SummaryList>
        </div>
      </template>
    </template>

    <CompareView v-if="tab === 'compare'" :outlet="outlet" :range="range" />

    <template v-if="tab === 'hours'">
      <div v-if="!d" class="py-10"><LoadingText /></div>
      <BusyHours v-else :cells="s.heatmap || []" :range="range" :day-start="d.day_start_hour" />
    </template>

    <template v-if="tab === 'staff'">
      <div v-if="!d" class="py-10"><LoadingText /></div>
      <template v-else>
        <section class="space-y-2">
          <h2 class="text-base-semibold">Waiters</h2>
          <div class="overflow-x-auto">
            <List :columns="['minmax(150px,1.2fr)', '6rem', '8rem', '7rem', '5rem', '7rem', '6rem', '7rem', '6rem']" class="-mx-3 min-w-[860px] list-row-px-3">
              <ListHeader>
                <ListHeaderCell>Waiter</ListHeaderCell><ListHeaderCell class="justify-end">Orders</ListHeaderCell><ListHeaderCell class="justify-end">Sales</ListHeaderCell>
                <ListHeaderCell class="justify-end">Average bill</ListHeaderCell><ListHeaderCell class="justify-end">Guests</ListHeaderCell><ListHeaderCell class="justify-end">Discounts</ListHeaderCell>
                <ListHeaderCell class="justify-end">Tips</ListHeaderCell><ListHeaderCell class="justify-end">Void amount</ListHeaderCell><ListHeaderCell class="justify-end">Voids</ListHeaderCell>
              </ListHeader>
              <ListRows :items="s.waiter_breakdown || []" row-key="waiter" v-slot="{ item }">
                <ListRow class="min-h-10">
                  <ListCell class="truncate">{{ item.waiter }}</ListCell>
                  <ListCell class="justify-end num">{{ item.count }}</ListCell>
                  <ListCell class="justify-end text-base-medium num">{{ num2(item.total) }}</ListCell>
                  <ListCell class="justify-end num" :class="item.avg_order > s.avg_order * 1.1 ? 'text-ink-green-6' : item.avg_order < s.avg_order * 0.9 ? 'text-ink-amber-6' : ''">{{ num2(item.avg_order) }}</ListCell>
                  <ListCell class="justify-end num">{{ item.guests || '' }}</ListCell>
                  <ListCell class="justify-end num">{{ item.discount ? num2(item.discount) : '' }}</ListCell>
                  <ListCell class="justify-end num">{{ item.tips ? num2(item.tips) : '' }}</ListCell>
                  <ListCell class="justify-end num">{{ item.void_amount ? num2(item.void_amount) : '' }}</ListCell>
                  <ListCell class="justify-end num" :class="item.voids ? 'text-ink-red-6' : 'text-ink-gray-4'">{{ item.voids || 0 }}</ListCell>
                </ListRow>
              </ListRows>
            </List>
          </div>
          <p class="text-p-sm text-ink-gray-5">Average bill in green is over 10 % above the overall average ({{ num2(s.avg_order) }}), amber is over 10 % below. Voids count what each person voided.</p>
          <div v-if="!(s.waiter_breakdown || []).length" class="py-6 text-center text-p-sm text-ink-gray-5">No waiter on the sales in this period.</div>
        </section>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SummaryList title="Cashiers" :rows="s.cashier_breakdown" :cols="[{ key: 'cashier', label: 'Cashier' }, { key: 'count', label: 'Orders', align: 'right', width: '6rem' }, { key: 'total', label: 'Sales', align: 'right', format: num2 }]" />
          <SummaryList title="Voids by staff" :rows="s.void_summary.by_staff" :cols="voidCols('staff', 'Voided by')" />
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
        <SummaryList title="By reason" :rows="s.void_summary.by_reason" :cols="voidCols('reason', 'Reason')" />
        <SummaryList title="By staff" :rows="s.void_summary.by_staff" :cols="voidCols('staff', 'Voided by')" />
        <SummaryList title="Waste or back to stock" :rows="s.void_summary.by_disposition" :cols="voidCols('disposition', 'What happened')" />
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
      <SummaryList :rows="detail.d.items || []" empty="No items." :cols="[{ key: 'item_name', label: 'Item' }, { key: 'qty', label: 'Qty', align: 'right', width: '4.5rem', format: (v) => '× ' + fmt(v, 2) }, { key: 'amount', label: 'Amount', align: 'right', width: '6rem', format: num2 }]">
        <template #cell-item_name="{ item: i }">
          <span class="min-w-0"><span class="block truncate">{{ i.item_name }}</span>
            <span v-if="i.modifiers" class="block truncate text-xs text-ink-gray-5">{{ i.modifiers }}</span>
            <span v-if="i.comment || i.void_reason" class="block truncate text-xs text-ink-amber-6">{{ i.comment || i.void_reason }}</span></span>
        </template>
      </SummaryList>
      <div v-if="(detail.d.payments || []).length" class="text-base">Paid: <span v-for="p in detail.d.payments" :key="p.mode_of_payment" class="mr-3">{{ p.mode_of_payment }} {{ num2(p.amount) }}</span></div>
      <a v-if="detail.d.desk_url" :href="detail.d.desk_url" target="_blank" class="text-base text-ink-blue-6 hover:underline">Open in ERPNext</a>
    </div>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, Button, Checkbox, DateRangePicker, Dialog, LoadingText, Select, TabButtons, TextInput } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { BarChart, NumberCard } from 'frappe-ui/charts'
import CompareView from '../components/CompareView.vue'
import BusyHours from '../components/BusyHours.vue'
import SummaryList from '../components/SummaryList.vue'
import Header from '../../components/Header.vue'
import { useRead, get, amount } from '../api'
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
const num2 = amount
const num0 = (v) => Number(v || 0).toLocaleString('en', { maximumFractionDigits: 0 })
const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null)
const fmtPct = (v) => (v === null || v === undefined ? 'new' : (v >= 0 ? '+' : '') + v.toFixed(0) + ' %')
const span = (p) => (p.from_date === p.to_date ? fmtDate(p.from_date) : fmtDate(p.from_date) + ' to ' + fmtDate(p.to_date))
const cmpCaption = (k, money) => (d.value && d.value.previous[k] ? 'was ' + (money ? num2(d.value.previous[k]) : num0(d.value.previous[k])) : '')
const guestsOk = computed(() => s.value.total_guests >= s.value.order_count * 0.5)
const byDay = computed(() => (s.value.daily_sales || []).map((x) => ({ day: fmtDate(x.date), sales: x.total })))
const payTotal = computed(() => (s.value.payment_breakdown || []).reduce((a, p) => a + p.total, 0))
const pctOf = (v, t) => (t ? Math.round((v / t) * 100) + ' %' : '')
const subtitle = computed(() => (outlet.value || 'All outlets') + ' · ' + (range.value[0] === range.value[1] ? fmtDate(range.value[0]) : fmtDate(range.value[0]) + ' to ' + fmtDate(range.value[1])))

const voidCols = (key, label) => [{ key, label }, { key: 'count', label: 'Count', align: 'right', width: '5rem' }, { key: 'amount', label: 'Amount', align: 'right', format: num2 }]
// change against the period before as a frappe-ui Badge
const changeBadge = (a, b) => {
  const v = pct(a, b)
  if (v === null) return { label: a ? 'new' : '', theme: 'gray' }
  return { label: (v >= 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(0) + ' %', theme: v >= 0 ? 'green' : 'red' }
}

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
