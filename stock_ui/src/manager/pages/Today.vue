<template>
  <Header :title="title" :subtitle="rangeText">
    <Button icon="lucide-refresh-cw" aria-label="Refresh" :loading="dash.loading" @click="dash.reload()" />
  </Header>

  <div class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <div class="flex flex-wrap items-end gap-2">
      <Select v-model="outlet" :options="outletOptions" class="w-56" aria-label="Outlet" />
      <TabButtons :options="presets.map((p) => ({ label: p.label, value: p.key }))" v-model="preset" />
      <DateRangePicker v-if="preset === 'custom'" v-model="custom" class="w-60" />
    </div>
    <ErrorMessage v-if="dash.error" :message="errText(dash.error)" />

    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <NumberCard title="Sales" :prefix="curP" :value="d ? s.total_sales : null" :format="num2" :loading="!d"
        :delta="pct(s.total_sales, d && d.previous.total_sales)" delta-suffix="%" :delta-format="num0" :delta-caption="d && d.previous.total_sales ? prevCaption : ''" />
      <NumberCard title="Orders" :value="d ? s.order_count : null" :loading="!d"
        :delta="pct(s.order_count, d && d.previous.order_count)" delta-suffix="%" :delta-format="num0" :delta-caption="d && d.previous.order_count ? prevCaption : ''" />
      <NumberCard title="Average bill" :prefix="curP" :value="d ? s.avg_order : null" :format="num2" :loading="!d" />
      <NumberCard title="Guests" :value="d ? s.total_guests : null" :loading="!d" :delta-caption="d && s.total_guests ? money(s.total_sales / s.total_guests) + ' per guest' : ''" />
      <NumberCard title="Tips" :prefix="curP" :value="d ? s.total_tips : null" :format="num2" :loading="!d" />
      <NumberCard title="Voids" :value="d ? s.void_summary.count : null" :loading="!d"
        :delta-caption="d ? money(s.void_summary.amount) + ' · ' + s.void_summary.void_rate + '% of orders' : ''" />
    </div>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div class="h-72 lg:col-span-2">
        <BarChart v-if="d && d.days > 1" title="Sales by day" :subtitle="cur" :data="byDay" x="day" y="sales" :format="num2" :loading="!d" />
        <div v-else-if="noTimes" class="flex h-full flex-col justify-center rounded-lg border border-outline-gray-1 p-6">
          <p class="text-base-semibold">Sales by hour</p>
          <p class="mt-2 text-p-sm text-ink-gray-6">These sales reached ERPNext without the time of sale, so they all show at midnight. The hour chart appears once the POS terminals send the sale time.</p>
        </div>
        <BarChart v-else title="Sales by hour" :subtitle="cur" :data="byHour" x="hour" y="sales" :format="num2" :loading="!d" />
      </div>
      <div class="h-72">
        <DonutChart title="Payments" :subtitle="cur" :data="payments" category="method" value="amount" :format="num2" :loading="!d" />
      </div>
    </div>

    <section v-if="!outlet" class="space-y-2">
      <h2 class="text-lg-semibold">Outlets</h2>
      <div class="overflow-x-auto">
        <List :columns="['minmax(180px,1fr)', '9rem', '6rem', '8rem', '9rem', '10rem']" class="card min-w-[760px] list-row-px-3">
          <ListHeader>
            <ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell class="justify-end">Sales</ListHeaderCell><ListHeaderCell class="justify-end">Orders</ListHeaderCell>
            <ListHeaderCell class="justify-end">Average bill</ListHeaderCell><ListHeaderCell>Last sale synced</ListHeaderCell><ListHeaderCell>Last shift closed</ListHeaderCell>
          </ListHeader>
          <ListRow v-for="o in (d ? d.outlets : [])" :key="o.pos_profile" class="min-h-10" @click="outlet = o.pos_profile">
            <ListCell class="text-base-medium">{{ o.pos_profile }}</ListCell>
            <ListCell class="justify-end num">{{ money(o.total_sales) }}</ListCell>
            <ListCell class="justify-end num">{{ o.order_count }}</ListCell>
            <ListCell class="justify-end text-ink-gray-6 num">{{ o.order_count ? money(o.total_sales / o.order_count) : '' }}</ListCell>
            <ListCell class="text-sm" :class="stale(o.last_sale) ? 'text-ink-amber-6' : 'text-ink-gray-6'">{{ ago(o.last_sale, d.generated_at) || 'no sales in 30 days' }}</ListCell>
            <ListCell class="text-sm text-ink-gray-6">{{ ago(o.last_shift, d.generated_at) || 'none yet' }}</ListCell>
          </ListRow>
          <Empty v-if="d && !d.outlets.length">No outlets you can see.</Empty>
        </List>
      </div>
      <p class="text-p-sm text-ink-gray-5">Each POS sends its sales every few minutes. Amber means nothing has arrived for over 3 hours: the POS may be offline or closed.</p>
    </section>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <section class="space-y-2">
        <h2 class="text-lg-semibold">Top items</h2>
        <List :columns="['minmax(140px,1fr)', '5rem', '8rem']" class="card list-row-px-3">
          <ListHeader><ListHeaderCell>Item</ListHeaderCell><ListHeaderCell class="justify-end">Qty</ListHeaderCell><ListHeaderCell class="justify-end">Sales</ListHeaderCell></ListHeader>
          <ListRow v-for="i in topItems" :key="i.item_code" class="min-h-10">
            <ListCell class="flex-col !items-start"><span class="w-full truncate">{{ i.item_name }}</span><span class="text-xs text-ink-gray-4">{{ i.item_group }}</span></ListCell>
            <ListCell class="justify-end num">{{ fmt(i.total_qty, 2) }}</ListCell>
            <ListCell class="justify-end text-base-medium num">{{ money(i.total_amount) }}</ListCell>
          </ListRow>
          <Empty v-if="d && !topItems.length">No items sold in this period.</Empty>
        </List>
      </section>
      <div class="space-y-4">
        <section class="space-y-2">
          <h2 class="text-lg-semibold">Order types</h2>
          <List :columns="['minmax(120px,1fr)', '5rem', '8rem']" class="card list-row-px-3">
            <ListRow v-for="t in (d ? s.order_type_breakdown : [])" :key="t.type" class="min-h-10">
              <ListCell>{{ t.type }}</ListCell><ListCell class="justify-end num">{{ t.count }}</ListCell><ListCell class="justify-end num">{{ money(t.total) }}</ListCell>
            </ListRow>
            <Empty v-if="d && !s.order_type_breakdown.length">No orders.</Empty>
          </List>
        </section>
        <section class="space-y-2">
          <h2 class="text-lg-semibold">Voids by reason</h2>
          <List :columns="['minmax(120px,1fr)', '5rem', '8rem']" class="card list-row-px-3">
            <ListRow v-for="v in (d ? s.void_summary.by_reason : [])" :key="v.reason" class="min-h-10">
              <ListCell>{{ v.reason }}</ListCell><ListCell class="justify-end num">{{ v.count }}</ListCell><ListCell class="justify-end num">{{ money(v.amount) }}</ListCell>
            </ListRow>
            <Empty v-if="d && !s.void_summary.by_reason.length">No voids.</Empty>
          </List>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Button, DateRangePicker, ErrorMessage, Select, TabButtons } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import { BarChart, DonutChart, NumberCard } from 'frappe-ui/charts'
import Header from '../../components/Header.vue'
import Empty from '../../components/Empty.vue'
import { errText, fmt, fmtDate } from '../../api'
import { useRead, money as moneyCur, ago } from '../api'
import { state, setOutlet } from '../state'

const today = state.ctx.today
const day = (n) => { const x = new Date(today + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const presets = [
  { key: 'today', label: 'Today', range: () => [today, today] },
  { key: 'yesterday', label: 'Yesterday', range: () => [day(-1), day(-1)] },
  { key: 'week', label: 'Last 7 days', range: () => [day(-6), today] },
  { key: 'month', label: 'This month', range: () => [today.slice(0, 8) + '01', today] },
  { key: 'custom', label: 'Custom', range: () => custom.value },
]
// ?from=YYYY-MM-DD&to=YYYY-MM-DD opens a custom range (shareable link)
const route = useRoute()
const qFrom = /^\d{4}-\d{2}-\d{2}$/.test(route.query.from || '') ? route.query.from : null
const qTo = /^\d{4}-\d{2}-\d{2}$/.test(route.query.to || '') ? route.query.to : qFrom
const preset = ref(qFrom ? 'custom' : 'today')
const custom = ref(qFrom ? [qFrom, qTo] : [day(-6), today])
const range = computed(() => {
  const r = presets.find((p) => p.key === preset.value).range()
  return [r[0] || today, r[1] || r[0] || today]
})

const outlet = ref(state.outlet)
watch(outlet, (v) => setOutlet(v))
const outletOptions = computed(() => [{ label: 'All outlets', value: '' }, ...state.ctx.profiles.map((p) => ({ label: p.name, value: p.name }))])

const dash = useRead('manager.get_dashboard', () => ({ pos_profile: outlet.value || null, from_date: range.value[0], to_date: range.value[1] }))
const d = computed(() => dash.data)
const s = computed(() => (d.value ? d.value.sales : {}))

// live while the range includes today
const timer = setInterval(() => { if (range.value[1] >= today && !dash.loading) dash.reload() }, 60000)
onBeforeUnmount(() => clearInterval(timer))

const cur = state.ctx.currency || ''
const curP = cur ? cur + ' ' : ''
const money = (v) => moneyCur(v)
const num2 = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num0 = (v) => Number(v || 0).toLocaleString('en', { maximumFractionDigits: 0 })
const pct = (now, before) => (d.value && before ? ((Number(now || 0) - before) / before) * 100 : null)

const title = computed(() => presets.find((p) => p.key === preset.value).label === 'Custom' ? 'Sales' : presets.find((p) => p.key === preset.value).label)
const rangeText = computed(() => (outlet.value || 'All outlets') + ' · ' + (range.value[0] === range.value[1] ? fmtDate(range.value[0]) : fmtDate(range.value[0]) + ' to ' + fmtDate(range.value[1])))
const prevCaption = computed(() => (d.value ? (d.value.days === 1 ? 'vs the day before' : `vs the previous ${d.value.days} days`) : ''))

const byHour = computed(() => (d.value ? s.value.hourly_sales.map((h) => ({ hour: String(h.hour).padStart(2, '0') + ':00', sales: Math.round(h.total * 100) / 100 })) : []))
const noTimes = computed(() => !!d.value && s.value.hourly_sales.length > 0 && s.value.hourly_sales.every((h) => h.hour === 0))
const byDay = computed(() => (d.value ? s.value.daily_sales.map((x) => ({ day: fmtDate(x.date), sales: Math.round(x.total * 100) / 100 })) : []))
const payments = computed(() => (d.value ? s.value.payment_breakdown.map((p) => ({ method: p.mode_of_payment, amount: Math.round(p.total * 100) / 100 })) : []))
const topItems = computed(() => (d.value ? s.value.top_items.filter((i) => i.total_qty > 0).sort((a, b) => b.total_amount - a.total_amount).slice(0, 10) : []))
const stale = (t) => t && range.value[1] >= today && Date.parse(String(d.value.generated_at).replace(' ', 'T')) - Date.parse(String(t).replace(' ', 'T')) > 3 * 3600 * 1000
</script>
