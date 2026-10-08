<template>
  <List :columns="{ base: ['minmax(0,1fr)', '7rem'], md: ['8rem', 'minmax(0,1fr)', '7rem', '8rem', '7rem'] }" class="card list-row-px-3">
    <ListHeader class="hidden md:grid">
      <ListHeaderCell>Order</ListHeaderCell><ListHeaderCell>{{ partyLabel }}</ListHeaderCell><ListHeaderCell>For</ListHeaderCell><ListHeaderCell>{{ timeLabel }}</ListHeaderCell><ListHeaderCell>Status</ListHeaderCell>
    </ListHeader>
    <ListRow v-for="o in rows" :key="o.name" :route="'/o/' + o.name" class="min-h-12">
      <ListCell class="hidden gap-2 md:flex"><span class="size-2 shrink-0 rounded-full" :style="{ background: providerColor(o.from_location) }" /><span class="text-base-medium num">{{ o.name }}</span></ListCell>
      <ListCell class="flex-col !items-start"><span class="w-full truncate text-base">{{ party(o) }}</span><span class="text-sm text-ink-gray-5 md:hidden">{{ o.name }} · {{ o.lines }} lines</span></ListCell>
      <ListCell class="hidden text-ink-gray-6 md:flex">{{ fmtDate(o.for_date) }}</ListCell>
      <ListCell class="hidden text-ink-gray-6 md:flex">{{ fmtTime(o[timeField]) }}</ListCell>
      <ListCell class="gap-1"><StatusBadge :status="o.status" /><Badge v-if="o.is_late" label="Late" theme="amber" variant="subtle" size="sm" /></ListCell>
    </ListRow>
    <Empty v-if="!rows.length">{{ empty }}</Empty>
  </List>
</template>
<script setup>
import { Badge } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import StatusBadge from './StatusBadge.vue'
import Empty from './Empty.vue'
import { fmtDate, fmtTime } from '../api'
import { providerColor } from '../state'
defineProps({ rows: { type: Array, default: () => [] }, party: Function, partyLabel: String, timeField: { type: String, default: 'submitted_on' }, timeLabel: { type: String, default: 'Submitted' }, empty: String })
</script>
