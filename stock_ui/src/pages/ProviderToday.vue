<template>
  <Header title="Today" :subtitle="state.location.name + (pick.data ? ' · deliveries for ' + fmtDate(pick.data.for_date) : '')">
    <Button v-if="shipsHere" icon-left="lucide-table-2" label="Picking sheet" route="/picking" />
    <Button v-if="shipsHere" variant="solid" icon-left="lucide-truck" label="Ship orders" route="/list/to_ship" />
  </Header>
  <div class="space-y-6 px-3 pb-10 pt-5 sm:px-5">
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <NumberCard title="To ship" :value="toShip.data ? toShip.data.length : null" :loading="!toShip.data"
        :delta-caption="late ? late + ' late, approve or cancel' : 'orders and transfer requests'" />
      <NumberCard title="Outlets ordered" :value="pick.data ? pick.data.outlets.length : null" :loading="!pick.data"
        :target="pick.data ? pick.data.outlets.length + pick.data.not_ordered.length : undefined" delta-caption="for the next delivery" />
      <NumberCard title="To make" :value="pick.data ? pick.data.rows.filter((r) => r.to_make > 0).length : null" :loading="!pick.data"
        delta-caption="items short in stock for the picking sheet" />
      <NumberCard title="Discrepancies" :value="disc.data ? disc.data.length : null" :loading="!disc.data"
        :delta-caption="disc.data && disc.data.length ? 'waiting for your decision' : 'nothing to resolve'" />
    </div>

    <Alert v-if="pick.data && pick.data.not_ordered.length" theme="amber" title="No order yet from"
      :description="pick.data.not_ordered.join(', ')" />

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section class="space-y-2">
        <h2 class="text-lg-semibold">Waiting to ship</h2>
        <OrderRows :rows="toShip.data || []" :party="(o) => (o.order_type !== 'Order' ? o.order_type + ': ' : '') + o.to_location" party-label="To" empty="Nothing waiting to ship." />
      </section>
      <section class="space-y-2">
        <h2 class="text-lg-semibold">Discrepancies</h2>
        <OrderRows :rows="disc.data || []" :party="(o) => o.to_location" party-label="Outlet" time-field="received_on" time-label="Received" empty="No discrepancies." />
        <h2 class="pt-4 text-lg-semibold">Coming to {{ state.location.name }}</h2>
        <OrderRows :rows="incoming.data || []" :party="(o) => (o.order_type !== 'Order' ? o.order_type + ' from ' : '') + o.from_location" party-label="From" time-field="shipped_on" time-label="Shipped" empty="Nothing on the way." />
      </section>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { Alert, Button } from 'frappe-ui'
import { NumberCard } from 'frappe-ui/charts'
import Header from '../components/Header.vue'
import OrderRows from '../components/OrderRows.vue'
import { useRead, fmtDate } from '../api'
import { state, shipsHere } from '../state'
const loc = () => state.location.name
const toShip = useRead('list_orders', () => ({ view: 'to_ship', location_name: loc() }))
const disc = useRead('list_orders', () => ({ view: 'discrepancies', location_name: loc() }))
const incoming = useRead('list_orders', () => ({ view: 'incoming', location_name: loc() }))
const pick = useRead('get_picking', () => ({ provider: loc() }))
const late = computed(() => (toShip.data || []).filter((o) => o.is_late).length)
</script>
