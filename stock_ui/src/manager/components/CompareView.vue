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

      <SummaryList v-if="d.outlets.length > 1" title="Outlets side by side" min-width="min-w-[760px]" :rows="d.outlets" :cols="[
        { key: 'pos_profile', label: 'Outlet' }, { key: 'a_sales', label: 'Sales', align: 'right', format: num2 }, { key: 'b_sales', label: 'Was', align: 'right', format: num2, muted: true },
        { key: 'change', label: 'Change', align: 'right', width: '6rem' }, { key: 'a_orders', label: 'Orders', align: 'right', width: '5rem' },
        { key: 'b_orders', label: 'Was', align: 'right', width: '5rem', muted: true }, { key: 'avg', label: 'Average bill', align: 'right', width: '7rem', format: (v, o) => (o.a_orders ? num2(o.a_sales / o.a_orders) : '') }]">
        <template #cell-change="{ item }"><Badge v-bind="change(item.a_sales, item.b_sales)" /></template>
      </SummaryList>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SummaryList title="Categories" :rows="d.categories" :cols="[{ key: 'category', label: 'Category' }, { key: 'a', label: 'Sales', align: 'right', width: '7rem', format: num2 }, { key: 'change', label: 'Change', align: 'right', width: '5.5rem' }]">
          <template #cell-change="{ item }"><Badge v-bind="change(item.a, item.b)" /></template>
        </SummaryList>
        <SummaryList v-for="[title, list] in [['Selling more', d.risers], ['Selling less', d.fallers]]" :key="title" :title="title" :rows="list" empty="Nothing."
          :row-route="(m) => ({ name: 'item', params: { name: m.item_code } })"
          :cols="[{ key: 'item_name', label: 'Item' }, { key: 'sold', label: 'Sold', align: 'right', width: '5.5rem', format: (v, m) => num0(m.b_qty) + ' → ' + num0(m.a_qty), muted: true }, { key: 'change', label: 'Change', align: 'right', width: '6rem' }]">
          <template #cell-change="{ item }"><Badge :theme="item.change > 0 ? 'green' : 'red'" :label="(item.change > 0 ? '+' : '') + num2(item.change)" /></template>
        </SummaryList>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Badge, DateRangePicker, LoadingText, TabButtons } from 'frappe-ui'
import SummaryList from './SummaryList.vue'
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
// change against the compared period as a frappe-ui Badge
const change = (a, b) => {
  const v = pct(a, b)
  if (v === null) return { label: a ? 'new' : '', theme: 'gray' }
  return { label: (v >= 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(0) + ' %', theme: v >= 0 ? 'green' : 'red' }
}
</script>
