<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <TabButtons v-model="metric" :options="[{ label: 'Orders', value: 'count' }, { label: 'Sales', value: 'total' }, { label: 'Average bill', value: 'avg' }]" />
      <span class="text-p-sm text-ink-gray-5">{{ metric === 'avg' ? 'Average bill in each hour' : 'Average per day: ' + (metric === 'count' ? 'orders' : 'sales') + ' in each hour of each weekday' }}</span>
    </div>
    <div v-if="!cells.length" class="rounded-6 border border-outline-gray-2 px-4 py-6 text-p-sm text-ink-gray-5">No sales in this period.</div>
    <div v-else class="overflow-x-auto">
      <div class="inline-grid min-w-full gap-px" :style="{ gridTemplateColumns: `3.5rem repeat(${hours.length}, minmax(2.75rem, 1fr)) 5rem` }">
        <span />
        <span v-for="h in hours" :key="'h' + h" class="pb-1 text-center text-xs text-ink-gray-5">{{ hourLabel(h) }}</span>
        <span class="pb-1 text-right text-xs text-ink-gray-5">Day</span>
        <template v-for="(w, wi) in WEEK" :key="w">
          <span class="flex items-center text-sm text-ink-gray-6">{{ w }}</span>
          <Tooltip v-for="h in hours" :key="w + h" :text="tip(wi, h)">
            <div class="flex h-9 items-center justify-center rounded-4 text-xs num" :style="cellStyle(wi, h)">{{ short(val(wi, h)) }}</div>
          </Tooltip>
          <span class="flex items-center justify-end text-sm num">{{ short(dayVal(wi)) }}</span>
        </template>
      </div>
    </div>
    <p v-if="peak" class="text-p-sm text-ink-gray-6">Busiest: <b>{{ WEEK[peak.wd] }} {{ hourLabel(peak.h) }}</b>. Quietest open hour: <b>{{ WEEK[low.wd] }} {{ hourLabel(low.h) }}</b>.</p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { TabButtons, Tooltip } from 'frappe-ui'

const props = defineProps({ cells: { type: Array, default: () => [] }, range: Array, dayStart: { type: Number, default: 5 } })
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const metric = ref('count')

// how many of each weekday the period holds, to turn totals into an average day
const weekdays = computed(() => {
  const n = [0, 0, 0, 0, 0, 0, 0]
  if (!props.range) return n
  const d = new Date(props.range[0] + 'T00:00:00'), end = new Date(props.range[1] + 'T00:00:00')
  for (let i = 0; d <= end && i < 1000; i++, d.setDate(d.getDate() + 1)) n[(d.getDay() + 6) % 7]++
  return n
})
const map = computed(() => {
  const m = {}
  for (const c of props.cells) m[c.weekday + ':' + c.hour] = c
  return m
})
// hours in business-day order (from the day start, past midnight), only those with sales
const hours = computed(() => {
  const seen = new Set(props.cells.map((c) => c.hour))
  return Array.from({ length: 24 }, (_, i) => (i + props.dayStart) % 24).filter((h) => seen.has(h))
})
function val(wd, h) {
  const c = map.value[wd + ':' + h]
  if (!c) return 0
  if (metric.value === 'avg') return c.count ? c.total / c.count : 0
  return (metric.value === 'count' ? c.count : c.total) / (weekdays.value[wd] || 1)
}
function dayVal(wd) {
  const cs = props.cells.filter((c) => c.weekday === wd)
  const count = cs.reduce((a, c) => a + c.count, 0), total = cs.reduce((a, c) => a + c.total, 0)
  if (metric.value === 'avg') return count ? total / count : 0
  return (metric.value === 'count' ? count : total) / (weekdays.value[wd] || 1)
}
const max = computed(() => Math.max(0, ...WEEK.flatMap((_, wd) => hours.value.map((h) => val(wd, h)))))
function cellStyle(wd, h) {
  const v = val(wd, h), t = max.value ? v / max.value : 0
  return { background: v ? `rgba(36, 144, 239, ${0.08 + t * 0.82})` : 'var(--surface-gray-1, #f8f8f8)', color: t > 0.55 ? '#fff' : 'inherit' }
}
const short = (v) => (!v ? '' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v >= 10 ? Math.round(v) : v.toFixed(1))
const hourLabel = (h) => String(h).padStart(2, '0') + ':00'
function tip(wd, h) {
  const c = map.value[wd + ':' + h]
  if (!c) return `${WEEK[wd]} ${hourLabel(h)}: no sales`
  const n = weekdays.value[wd] || 1
  return `${WEEK[wd]} ${hourLabel(h)}: ${(c.count / n).toFixed(1)} orders, ${(c.total / n).toFixed(0)} sales on an average day; average bill ${(c.count ? c.total / c.count : 0).toFixed(2)}`
}
const ranked = computed(() => {
  const out = []
  for (let wd = 0; wd < 7; wd++) for (const h of hours.value) if (map.value[wd + ':' + h]) out.push({ wd, h, v: val(wd, h) })
  return out.sort((a, b) => b.v - a.v)
})
const peak = computed(() => ranked.value[0])
const low = computed(() => ranked.value[ranked.value.length - 1])
</script>
