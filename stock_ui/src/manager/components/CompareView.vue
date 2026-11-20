<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-base text-ink-gray-6">Compare with</span>
      <TabButtons v-model="against" :options="[{ label: 'Period before', value: 'previous' }, { label: 'Same dates last year', value: 'last_year' }, { label: 'Other dates', value: 'custom' }]" />
      <DateRangePicker v-if="against === 'custom'" v-model="other" class="w-60" />
    </div>
    <div v-if="!d" class="py-10"><LoadingText /></div>
    <template v-else>
      <div class="text-p-sm text-ink-gray-6">
        <b class="text-ink-gray-8">{{ span(d.a) }}</b> against <b class="text-ink-gray-8">{{ span(d.b) }}</b>
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <NumberCard v-for="k in kpis.filter((k) => k.key !== 'avg_guest' || d.a.total_guests >= d.a.order_count * 0.5)" :key="k.key" :title="k.label" :prefix="k.money ? curP : ''" :value="d.a[k.key]" :format="k.money ? num2 : num0"
          :delta="pct(d.a[k.key], d.b[k.key])" delta-suffix="%" :delta-format="num0" :negative-is-better="k.lowerBetter"
          :delta-caption="'was ' + (k.money ? num2(d.b[k.key]) : num0(d.b[k.key]))" />
      </div>

      <div class="h-72">
        <LineChart title="Sales by day" :subtitle="`${span(d.a)} and ${span(d.b)}, day by day`" :data="days" x="day" :y="['This period', 'Compared with']" :format="num2" />
      </div>

      <section v-if="d.outlets.length > 1" class="space-y-2">
        <h2 class="text-base-semibold">Outlets side by side</h2>
        <div class="overflow-x-auto">
          <div class="min-w-[720px] divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
            <div class="grid grid-cols-[1fr_8rem_8rem_6rem_6rem_6rem_7rem] gap-2 px-3 py-1.5 text-xs text-ink-gray-5">
              <span>Outlet</span><span class="text-right">Sales</span><span class="text-right">Was</span><span class="text-right">Change</span>
              <span class="text-right">Orders</span><span class="text-right">Was</span><span class="text-right">Average bill</span>
            </div>
            <div v-for="o in d.outlets" :key="o.pos_profile" class="grid grid-cols-[1fr_8rem_8rem_6rem_6rem_6rem_7rem] items-center gap-2 px-3 py-1.5 text-base">
              <span class="truncate">{{ o.pos_profile }}</span>
              <span class="text-right num">{{ num2(o.a_sales) }}</span><span class="text-right num text-ink-gray-5">{{ num2(o.b_sales) }}</span>
              <span class="text-right"><Change :a="o.a_sales" :b="o.b_sales" /></span>
              <span class="text-right num">{{ o.a_orders }}</span><span class="text-right num text-ink-gray-5">{{ o.b_orders }}</span>
              <span class="text-right num">{{ o.a_orders ? num2(o.a_sales / o.a_orders) : '' }}</span>
            </div>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section class="space-y-2">
          <h2 class="text-base-semibold">Categories</h2>
          <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
            <div v-for="c in d.categories" :key="c.category" class="grid grid-cols-[1fr_7rem_5rem] gap-2 px-3 py-1.5 text-base">
              <span class="truncate">{{ c.category }}</span><span class="text-right num">{{ num2(c.a) }}</span><span class="text-right"><Change :a="c.a" :b="c.b" /></span>
            </div>
          </div>
        </section>
        <section v-for="[title, list] in [['Selling more', d.risers], ['Selling less', d.fallers]]" :key="title" class="space-y-2">
          <h2 class="text-base-semibold">{{ title }}</h2>
          <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
            <div v-for="m in list" :key="m.item_code" class="grid grid-cols-[1fr_7rem] gap-2 px-3 py-1.5 text-base">
              <span class="min-w-0"><span class="block truncate">{{ m.item_name }}</span><span class="text-xs text-ink-gray-5 num">{{ num0(m.b_qty) }} → {{ num0(m.a_qty) }} sold</span></span>
              <span class="text-right num" :class="m.change > 0 ? 'text-ink-green-6' : 'text-ink-red-6'">{{ m.change > 0 ? '+' : '' }}{{ num2(m.change) }}</span>
            </div>
            <div v-if="!list.length" class="px-3 py-4 text-p-sm text-ink-gray-5">Nothing.</div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, h, ref } from 'vue'
import { DateRangePicker, LoadingText, TabButtons } from 'frappe-ui'
import { LineChart, NumberCard } from 'frappe-ui/charts'
import { useRead, shiftDate } from '../api'
import { fmtDate } from '../../api'
import { state } from '../state'

const props = defineProps({ outlet: String, range: Array })
const against = ref('previous')
const other = ref([shiftDate(props.range[0], -7), shiftDate(props.range[1], -7)])
const r = useRead('manager.get_compare', () => ({ pos_profile: props.outlet || null, from_date: props.range[0], to_date: props.range[1],
  against: against.value, other_from: against.value === 'custom' ? other.value[0] : null, other_to: against.value === 'custom' ? other.value[1] : null }))
const d = computed(() => r.data)
const curP = state.ctx.currency ? state.ctx.currency + ' ' : ''
const num2 = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num0 = (v) => Number(v || 0).toLocaleString('en', { maximumFractionDigits: 0 })
const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null)
const span = (p) => (p.from_date === p.to_date ? fmtDate(p.from_date) : fmtDate(p.from_date) + ' to ' + fmtDate(p.to_date))
const kpis = [
  { key: 'total_sales', label: 'Sales', money: true }, { key: 'order_count', label: 'Orders' }, { key: 'avg_order', label: 'Average bill', money: true },
  { key: 'total_guests', label: 'Guests' }, { key: 'avg_guest', label: 'Per guest', money: true }, { key: 'total_discount', label: 'Discounts', money: true, lowerBetter: true },
]
// days of the two periods lined up: day 1 with day 1, and so on
const days = computed(() => {
  if (!d.value) return []
  const a = d.value.a.days, b = d.value.b.days
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({
    day: a[i] ? fmtDate(a[i].date) : 'Day ' + (i + 1), 'This period': a[i] ? a[i].total : null, 'Compared with': b[i] ? b[i].total : null }))
})
const Change = (p) => {
  const v = pct(p.a, p.b)
  if (v === null) return h('span', { class: 'text-xs text-ink-gray-4' }, p.a ? 'new' : '')
  return h('span', { class: 'num text-sm ' + (v >= 0 ? 'text-ink-green-6' : 'text-ink-red-6') }, (v >= 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(0) + ' %')
}
Change.props = ['a', 'b']
</script>
