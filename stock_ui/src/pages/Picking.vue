<template>
  <Header title="Picking sheet" :subtitle="pick.data ? fmtDate(pick.data.for_date) : ''">
    <DatePicker v-model="date" class="w-40" />
    <DownloadMenu kind="picking" :params="{ provider: state.location.name, for_date: date }" label="Print / Excel" />
    <Button variant="solid" label="Ship orders" route="/list/to_ship" />
  </Header>
  <div v-if="pick.data" class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <div class="flex flex-wrap gap-2">
      <router-link v-for="o in pick.data.orders" :key="o.name" :to="'/o/' + o.name" class="card flex items-center gap-2 px-2.5 py-1.5 text-base hover:bg-surface-gray-1">
        {{ o.to_location }}<StatusBadge :status="o.status" /><Badge v-if="o.is_late" label="Late" theme="amber" variant="subtle" size="sm" />
      </router-link>
    </div>
    <Alert v-if="pick.data.not_ordered.length" theme="amber" title="No order yet" :description="pick.data.not_ordered.join(', ')" />
    <div class="overflow-x-auto">
      <List :columns="cols" class="card list-row-px-3" :style="{ minWidth: 260 + pick.data.outlets.length * 90 + 'px' }">
        <ListHeader>
          <ListHeaderCell>Item</ListHeaderCell>
          <ListHeaderCell v-for="o in pick.data.outlets" :key="o" class="justify-end text-right leading-tight">{{ o }}</ListHeaderCell>
          <ListHeaderCell class="justify-end">Total</ListHeaderCell><ListHeaderCell class="justify-end">In stock</ListHeaderCell>
          <ListHeaderCell v-if="makes" class="justify-end">To make</ListHeaderCell>
        </ListHeader>
        <ListRow v-for="r in pick.data.rows" :key="r.item_code" class="min-h-10">
          <ListCell class="flex-col !items-start"><span class="w-full truncate">{{ r.item_name }}</span><span class="text-xs text-ink-gray-4">{{ r.uom }}</span></ListCell>
          <ListCell v-for="o in pick.data.outlets" :key="o" class="justify-end num" :class="r.per[o] ? '' : 'text-ink-gray-3'">{{ r.per[o] ? fmt(r.per[o]) : '·' }}</ListCell>
          <ListCell class="justify-end text-base-semibold num">{{ fmt(r.total) }}</ListCell>
          <ListCell class="justify-end num" :class="r.stock < r.total ? 'text-ink-red-6' : 'text-ink-gray-6'">{{ fmt(r.stock) }}</ListCell>
          <ListCell v-if="makes" class="justify-end text-base-medium num">{{ r.to_make ? fmt(r.to_make) : '' }}</ListCell>
        </ListRow>
        <Empty v-if="!pick.data.rows.length">No orders for this date yet.</Empty>
      </List>
    </div>
    <p class="text-p-sm text-ink-gray-5">Quantities in the stock UOM. Totals include submitted and already shipped orders for the day.</p>
  </div>
  <div v-else class="px-5 pt-5"><LoadingText /></div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { Alert, Badge, Button, DatePicker, LoadingText } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import Header from '../components/Header.vue'
import StatusBadge from '../components/StatusBadge.vue'
import DownloadMenu from '../components/DownloadMenu.vue'
import Empty from '../components/Empty.vue'
import { useRead, fmt, fmtDate } from '../api'
import { state } from '../state'
const date = ref('')
const makes = computed(() => !!state.location.record_production_for_shortfall)
const pick = useRead('get_picking', () => ({ provider: state.location.name, for_date: date.value || undefined }), {
  onSuccess: (d) => { if (!date.value) date.value = d.for_date },
})
const cols = computed(() => ['minmax(160px,1fr)', ...(pick.data ? pick.data.outlets.map(() => '5rem') : []), '5rem', '5rem', ...(makes.value ? ['5rem'] : [])])
</script>
