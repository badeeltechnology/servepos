<template>
  <Header title="Reports">
    <DateRangePicker v-model="range" class="w-64" />
    <DownloadMenu kind="markup" :params="{ from_date: range[0], to_date: range[1] }" />
  </Header>
  <div class="space-y-3 px-3 pb-10 pt-5 sm:px-5">
    <h2 class="text-lg-semibold">Provider markup by outlet</h2>
    <p class="text-p-sm text-ink-gray-6">Value received from each provider at cost, and the markup on it ({{ state.ctx.settings.markup_mode === 'Accounts' ? 'posted to accounts on receipt' : 'reported only, not posted' }}).</p>
    <div class="overflow-x-auto">
      <List :columns="cols" class="card min-w-[640px] list-row-px-3">
        <ListHeader>
          <ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell>Provider</ListHeaderCell><ListHeaderCell class="justify-end">Orders</ListHeaderCell>
          <ListHeaderCell class="justify-end">Received at cost</ListHeaderCell><ListHeaderCell class="justify-end">Markup %</ListHeaderCell><ListHeaderCell class="justify-end">Markup</ListHeaderCell>
        </ListHeader>
        <ListRow v-for="r in rep.data || []" :key="r.outlet + r.provider" class="min-h-10">
          <ListCell>{{ r.outlet }}</ListCell><ListCell class="text-ink-gray-6">{{ r.provider }}</ListCell><ListCell class="justify-end num">{{ r.orders }}</ListCell>
          <ListCell class="justify-end num">{{ fmt(r.received_value, 2) }}</ListCell><ListCell class="justify-end text-ink-gray-6 num">{{ fmt(r.markup_percent, 2) }}</ListCell><ListCell class="justify-end text-base-medium num">{{ fmt(r.markup_amount, 2) }}</ListCell>
        </ListRow>
        <ListRow v-if="rep.data && rep.data.length" class="min-h-10 bg-surface-gray-1">
          <ListCell class="text-base-semibold">Total</ListCell><ListCell /><ListCell class="justify-end num">{{ sum('orders') }}</ListCell>
          <ListCell class="justify-end num">{{ fmt(sum('received_value'), 2) }}</ListCell><ListCell /><ListCell class="justify-end text-base-semibold num">{{ fmt(sum('markup_amount'), 2) }}</ListCell>
        </ListRow>
        <Empty v-if="rep.data && !rep.data.length">No received provider orders with a markup in this period.</Empty>
      </List>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { DateRangePicker } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import Header from '../components/Header.vue'
import Empty from '../components/Empty.vue'
import DownloadMenu from '../components/DownloadMenu.vue'
import { useRead, fmt } from '../api'
import { state } from '../state'
const t = state.ctx.today
const range = ref([t.slice(0, 8) + '01', t])
const cols = ['minmax(160px,1fr)', '10rem', '5rem', '9rem', '6rem', '8rem']
const rep = useRead('markup_report', () => ({ from_date: range.value[0] || t, to_date: range.value[1] || t }))
const sum = (k) => (rep.data || []).reduce((a, r) => a + Number(r[k] || 0), 0)
</script>
