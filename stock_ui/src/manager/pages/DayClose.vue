<template>
  <Header title="Day close" :subtitle="list.data ? `Business day now: ${fmtDate(list.data.business_date)}` : ''">
    <Badge v-if="list.data && list.data.open_shortfalls" theme="amber" :label="`${list.data.open_shortfalls} items short`" />
    <Button variant="solid" label="Close a day" icon-left="lucide-calendar-check" @click="openClose" />
  </Header>
  <div class="space-y-3 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-end gap-2">
      <Select v-model="outlet" :options="outletOptions()" class="w-56" aria-label="Outlet" />
      <TabButtons :options="presets.filter((p) => p.key !== 'today').map((p) => ({ label: p.label, value: p.key }))" v-model="preset" />
      <DateRangePicker v-if="preset === 'custom'" v-model="custom" class="w-60" />
    </div>
    <p class="text-p-sm text-ink-gray-6">Each outlet's day is closed once: what the recipes used leaves the outlet's stock. Stock never goes below zero. Anything missing is held as "short" until the stock arrives or a count settles it.</p>
    <div class="overflow-x-auto">
      <List :columns="['8rem', 'minmax(10rem,1fr)', '11rem', '6rem', '8rem', '6rem']" class="-mx-3 min-w-[700px] list-row-px-3">
        <ListHeader><ListHeaderCell>Day</ListHeaderCell><ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell>Status</ListHeaderCell><ListHeaderCell class="justify-end">Invoices</ListHeaderCell><ListHeaderCell class="justify-end">Used ({{ cur }})</ListHeaderCell><ListHeaderCell class="justify-end">Short</ListHeaderCell></ListHeader>
        <ListRows :items="(list.data && list.data.rows) || []" v-slot="{ item }">
          <ListRow class="min-h-10" @click="open(item.name)">
            <ListCell>{{ fmtDate(item.business_date) }}</ListCell>
            <ListCell class="truncate">{{ item.pos_profile }}</ListCell>
            <ListCell class="gap-1"><Badge :theme="themes[item.status]" :label="item.status" /><span v-if="item.no_recipe" class="lucide-circle-alert size-4 text-ink-amber-6" title="Some items sold have no recipe" /></ListCell>
            <ListCell class="justify-end num">{{ item.invoices }}</ListCell>
            <ListCell class="justify-end num">{{ money(item.consumed_value) }}</ListCell>
            <ListCell class="justify-end num" :class="item.short_lines ? 'text-ink-amber-6' : 'text-ink-gray-4'">{{ item.short_lines }}</ListCell>
          </ListRow>
        </ListRows>
      </List>
    </div>
    <div v-if="list.data && !list.data.rows.length" class="py-12 text-center text-p-sm text-ink-gray-5">No days closed in this period. Days close automatically after the business day ends.</div>
  </div>

  <Dialog v-model:open="cl.open" title="Close a day" size="2xl">
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <FormControl type="select" label="Outlet" v-model="cl.outlet" :options="outletOptions(false)" />
        <FormControl type="date" label="Business day" v-model="cl.date" />
      </div>
      <div v-if="cl.loading" class="py-4"><LoadingText /></div>
      <template v-else-if="cl.preview">
        <p class="text-p-sm text-ink-gray-6">{{ cl.preview.invoices }} invoices, {{ fmt(cl.preview.items_sold, 2) }} items sold.</p>
        <div v-if="cl.preview.pending_deliveries.length" class="rounded-6 bg-surface-amber-1 p-2 text-p-sm text-ink-amber-7">Deliveries not yet received: {{ cl.preview.pending_deliveries.join(', ') }}. Receive them first so their stock counts.</div>
        <div v-if="cl.preview.no_recipe.length" class="rounded-6 bg-surface-amber-1 p-2 text-p-sm text-ink-amber-7">Sold without a recipe (nothing is taken for these): {{ cl.preview.no_recipe.join(', ') }}</div>
        <div class="max-h-[40vh] overflow-y-auto rounded-6 border border-outline-gray-2">
          <div class="grid grid-cols-[1fr_6rem_6rem_6rem] gap-2 border-b border-outline-gray-1 px-3 py-1.5 text-xs text-ink-gray-5"><span>Ingredient</span><span class="text-right">Needed</span><span class="text-right">In stock</span><span class="text-right">Short</span></div>
          <div v-for="l in cl.preview.lines" :key="l.item_code" class="grid grid-cols-[1fr_6rem_6rem_6rem] gap-2 px-3 py-1 text-base">
            <span class="truncate">{{ l.item_name }} <span class="text-xs text-ink-gray-5">{{ l.stock_uom }}</span></span>
            <span class="text-right num">{{ fmt(l.needed_qty, 3) }}</span><span class="text-right num">{{ fmt(l.in_stock, 3) }}</span>
            <span class="text-right num" :class="l.needed_qty > l.in_stock ? 'text-ink-amber-6' : 'text-ink-gray-4'">{{ l.needed_qty > l.in_stock ? fmt(l.needed_qty - Math.max(l.in_stock, 0), 3) : '' }}</span>
          </div>
          <div v-if="!cl.preview.lines.length" class="px-3 py-4 text-p-sm text-ink-gray-5">Nothing to take out of stock for this day.</div>
        </div>
      </template>
    </div>
    <template #actions="{ close }">
      <div class="flex items-center justify-between gap-2">
        <span class="text-p-sm text-ink-gray-5">{{ cl.date >= (list.data && list.data.business_date) ? 'This day has not ended yet.' : '' }}</span>
        <div class="flex gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Close day" :disabled="!cl.outlet || !cl.date" :loading="cl.busy" @click="doClose(close)" /></div>
      </div>
    </template>
  </Dialog>

  <Dialog v-model:open="dt.open" :title="dt.d ? `${dt.d.pos_profile} · ${fmtDate(dt.d.business_date)}` : 'Day close'" size="2xl">
    <div v-if="!dt.d" class="py-6"><LoadingText /></div>
    <div v-else class="space-y-3">
      <div class="flex flex-wrap items-center gap-3 text-base">
        <Badge :theme="themes[dt.d.status]" :label="dt.d.status" />
        <span>{{ dt.d.invoices }} invoices</span><span>Used {{ cur }} {{ money(dt.d.consumed_value) }}</span>
        <a v-if="dt.d.consumption_entry" :href="`/app/stock-entry/${dt.d.consumption_entry}`" target="_blank" class="text-ink-blue-6 hover:underline">{{ dt.d.consumption_entry }}</a>
      </div>
      <div v-if="dt.d.warnings" class="rounded-6 bg-surface-amber-1 p-2 text-p-sm text-ink-amber-7">{{ dt.d.warnings }}</div>
      <div v-if="dt.d.no_recipe" class="rounded-6 bg-surface-amber-1 p-2 text-p-sm text-ink-amber-7">Sold without a recipe: {{ dt.d.no_recipe }}</div>
      <div class="max-h-[45vh] overflow-y-auto rounded-6 border border-outline-gray-2">
        <div class="grid grid-cols-[1fr_5rem_5rem_5rem_8rem] gap-2 border-b border-outline-gray-1 px-3 py-1.5 text-xs text-ink-gray-5"><span>Ingredient</span><span class="text-right">Needed</span><span class="text-right">Posted</span><span class="text-right">Short</span><span>Status</span></div>
        <div v-for="l in dt.d.lines" :key="l.name" class="grid grid-cols-[1fr_5rem_5rem_5rem_8rem] items-center gap-2 px-3 py-1 text-base">
          <span class="truncate">{{ l.item_name }} <span class="text-xs text-ink-gray-5">{{ l.stock_uom }}</span></span>
          <span class="text-right num">{{ fmt(l.needed_qty, 3) }}</span><span class="text-right num">{{ fmt(l.posted_qty, 3) }}</span>
          <span class="text-right num" :class="l.short_qty ? 'text-ink-amber-6' : 'text-ink-gray-4'">{{ l.short_qty ? fmt(l.short_qty, 3) : '' }}</span>
          <span><Badge :theme="lineThemes[l.status]" :label="l.status" /></span>
        </div>
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-between gap-2">
        <Button v-if="dt.d && dt.d.status !== 'Cancelled'" variant="ghost" theme="red" label="Undo this close" @click="undo(close)" /><span v-else />
        <div class="flex gap-2"><Button v-if="dt.d && dt.d.short_lines" label="Try short items again" :loading="dt.busy" @click="retry" /><Button label="Close" @click="close" /></div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, Button, DateRangePicker, Dialog, FormControl, LoadingText, Select, TabButtons, dialog } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import { useRead, get, post, act, shiftDate } from '../api'
import { fmt, fmtDate } from '../../api'
import { state, outletOptions } from '../state'
import { usePeriod } from '../period'

const route = useRoute()
const { presets, preset, custom, range } = usePeriod('week', route.query)
const outlet = ref(state.outlet), cur = state.ctx.currency || ''
const money = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const themes = { Closed: 'green', 'Closed with shortfall': 'amber', 'Nothing to post': 'gray', Cancelled: 'gray' }
const lineThemes = { Posted: 'green', Short: 'amber', 'Posted later': 'blue', 'Settled by count': 'gray', Cancelled: 'gray' }
const list = useRead('recipes.api.list_day_closes', () => ({ pos_profile: outlet.value || null, from_date: range.value[0], to_date: range.value[1] }))

const cl = reactive({ open: false, outlet: '', date: '', preview: null, loading: false, busy: false })
function openClose() { Object.assign(cl, { open: true, outlet: outlet.value || state.ctx.profiles[0]?.name, date: shiftDate(list.data?.business_date || state.ctx.today, -1), preview: null }) }
watch(() => [cl.open, cl.outlet, cl.date], async () => {
  if (!cl.open || !cl.outlet || !cl.date) return
  cl.loading = true
  try { cl.preview = await get('recipes.api.preview_day', { pos_profile: cl.outlet, business_date: cl.date }) } finally { cl.loading = false }
})
async function doClose(close) {
  const now = list.data && cl.date >= list.data.business_date
  const go = async () => {
    cl.busy = true
    const name = await act(() => post('recipes.api.close_day', { pos_profile: cl.outlet, business_date: cl.date, force: now ? 1 : 0 }), 'Day closed')
    cl.busy = false
    if (name) { close(); list.reload(); open(name) }
  }
  if (now) dialog.confirm({ title: 'Close a day that has not ended?', message: 'Sales made later on this business day will not be counted in this close.', confirmLabel: 'Close now', onConfirm: go })
  else go()
}

const dt = reactive({ open: false, d: null, busy: false })
async function open(name) { Object.assign(dt, { open: true, d: null }); dt.d = await get('recipes.api.get_day_close', { name }) }
async function retry() {
  dt.busy = true
  const r = await act(() => post('recipes.api.retry_shortfalls', { name: dt.d.name }), (r) => (r.length ? 'Posted what is now in stock' : 'Still not in stock'))
  dt.busy = false
  if (r) { open(dt.d.name); list.reload() }
}
function undo(close) {
  dialog.danger({ title: 'Undo this day close?', message: 'Its stock entries are cancelled and the ingredients go back to stock. You can close the day again after fixing recipes.', confirmLabel: 'Undo',
    onConfirm: async () => { await post('recipes.api.cancel_day_close', { name: dt.d.name }); close(); list.reload() } })
}
</script>
