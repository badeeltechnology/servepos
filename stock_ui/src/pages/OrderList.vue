<template>
  <Header :title="meta.title">
    <DatePicker v-if="view === 'to_ship'" v-model="upTo" class="w-44" placeholder="Due up to" />
    <TabButtons v-if="view === 'history'" :options="[{ label: 'All', value: 'All' }, { label: 'Open', value: 'Open' }]" v-model="filter" />
  </Header>
  <div class="space-y-3 px-3 pb-10 pt-5 sm:px-5">
    <p class="text-p-sm text-ink-gray-6">{{ meta.help }}</p>
    <LoadingText v-if="list.loading && !list.data" />
    <OrderRows v-else :rows="shown" :party="party" :party-label="outward ? 'To' : 'From'" :time-field="timeField" :time-label="timeLabel" :empty="meta.empty" />
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { DatePicker, LoadingText, TabButtons } from 'frappe-ui'
import Header from '../components/Header.vue'
import OrderRows from '../components/OrderRows.vue'
import { useRead } from '../api'
import { state } from '../state'

const route = useRoute()
const view = computed(() => route.params.view)
const upTo = ref(state.ctx.for_date)
const filter = ref('All')
const META = {
  incoming: { title: 'Receive', help: 'Deliveries on the way to you. Open one and type what actually arrived.', empty: 'Nothing on the way.' },
  to_ship: { title: 'To ship', help: 'Submitted orders and transfer requests waiting for you. Late orders first.', empty: 'Nothing waiting to ship.' },
  discrepancies: { title: 'Discrepancies', help: 'Deliveries where the outlet received less than you shipped. Decide where the missing stock goes.', empty: 'No discrepancies.' },
  history: { title: 'Order history', help: 'Everything ordered for this location, newest first.', empty: 'No orders yet.' },
}
const meta = computed(() => META[view.value] || META.history)
const outward = computed(() => ['to_ship', 'discrepancies', 'shipped'].includes(view.value))
const timeField = computed(() => (view.value === 'incoming' ? 'shipped_on' : view.value === 'discrepancies' ? 'received_on' : 'submitted_on'))
const timeLabel = computed(() => ({ shipped_on: 'Shipped', received_on: 'Received', submitted_on: 'Submitted' })[timeField.value])
const party = (o) => (o.order_type !== 'Order' ? o.order_type + ': ' : '') + (outward.value ? o.to_location : o.from_location)
const list = useRead('list_orders', () => ({ view: view.value, location_name: state.location.name, for_date: view.value === 'to_ship' ? upTo.value : undefined }))
const shown = computed(() => (list.data || []).filter((o) => view.value !== 'history' || filter.value === 'All' || !['Closed', 'Cancelled', 'Received'].includes(o.status)))
</script>
