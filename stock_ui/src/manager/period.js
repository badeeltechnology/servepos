// Date range presets on the site's today (not the browser's UTC date), shared by Today and Sales.
import { computed, ref } from 'vue'
import { shiftDate } from './api'
import { state } from './state'

export function usePeriod(initial = 'today', query = {}) {
  const today = state.ctx.today
  const monthStart = today.slice(0, 8) + '01'
  const lastMonthEnd = shiftDate(monthStart, -1)
  const presets = [
    { key: 'today', label: 'Today', range: () => [today, today] },
    { key: 'yesterday', label: 'Yesterday', range: () => [shiftDate(today, -1), shiftDate(today, -1)] },
    { key: 'week', label: 'Last 7 days', range: () => [shiftDate(today, -6), today] },
    { key: 'month', label: 'This month', range: () => [monthStart, today] },
    { key: 'lastmonth', label: 'Last month', range: () => [lastMonthEnd.slice(0, 8) + '01', lastMonthEnd] },
    { key: 'custom', label: 'Custom', range: () => custom.value },
  ]
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
  const preset = ref(ok(query.from) ? 'custom' : initial)
  const custom = ref(ok(query.from) ? [query.from, ok(query.to) ? query.to : query.from] : [shiftDate(today, -6), today])
  const range = computed(() => {
    const r = presets.find((p) => p.key === preset.value).range()
    return [r[0] || today, r[1] || r[0] || today]
  })
  const label = computed(() => presets.find((p) => p.key === preset.value).label)
  return { presets, preset, custom, range, label, today }
}
