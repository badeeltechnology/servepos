<template>
  <div class="space-y-3">
    <TabButtons v-model="metric" :options="[{ label: 'Orders', value: 'count' }, { label: 'Sales', value: 'total' }, { label: 'Average bill', value: 'avg' }]" />
    <div class="h-[380px]">
      <HeatmapChart :title="titles[metric]" :subtitle="subtitles[metric]" :data="grid" x="hour" y="day" value="v" :format="fmtV" show-data-labels />
    </div>
    <p v-if="peak" class="text-p-sm text-ink-gray-6">Busiest: <b>{{ peak.day }} {{ peak.hour }}</b>. Quietest open hour: <b>{{ low.day }} {{ low.hour }}</b>.</p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { TabButtons } from 'frappe-ui'
import { HeatmapChart } from 'frappe-ui/charts'

const props = defineProps({ cells: { type: Array, default: () => [] }, range: Array, dayStart: { type: Number, default: 5 } })
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const metric = ref('count')
const titles = { count: 'Orders by hour', total: 'Sales by hour', avg: 'Average bill by hour' }
const subtitles = { count: 'On an average day of each weekday', total: 'On an average day of each weekday', avg: 'Across the period' }

// how many of each weekday the period holds, to turn totals into an average day
const weekdays = computed(() => {
  const n = [0, 0, 0, 0, 0, 0, 0]
  if (!props.range) return n
  const d = new Date(props.range[0] + 'T00:00:00'), end = new Date(props.range[1] + 'T00:00:00')
  for (let i = 0; d <= end && i < 1000; i++, d.setDate(d.getDate() + 1)) n[(d.getDay() + 6) % 7]++
  return n
})
// hours in business-day order (from the day start, past midnight), only those with sales
const hours = computed(() => {
  const seen = new Set(props.cells.map((c) => c.hour))
  return Array.from({ length: 24 }, (_, i) => (i + props.dayStart) % 24).filter((h) => seen.has(h))
})
const hourLabel = (h) => String(h).padStart(2, '0') + ':00'
// one row per cell, every weekday x hour, in the order the grid should read
const grid = computed(() => {
  const m = {}
  for (const c of props.cells) m[c.weekday + ':' + c.hour] = c
  const out = []
  WEEK.forEach((day, wd) => hours.value.forEach((h) => {
    const c = m[wd + ':' + h]
    let v = 0
    if (c) v = metric.value === 'avg' ? (c.count ? c.total / c.count : 0) : (metric.value === 'count' ? c.count : c.total) / (weekdays.value[wd] || 1)
    out.push({ day, hour: hourLabel(h), v: Math.round(v * 10) / 10 })
  }))
  return out
})
const fmtV = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v >= 10 ? String(Math.round(v)) : String(v))
const ranked = computed(() => grid.value.filter((c) => c.v > 0).sort((a, b) => b.v - a.v))
const peak = computed(() => ranked.value[0])
const low = computed(() => ranked.value[ranked.value.length - 1])
</script>
