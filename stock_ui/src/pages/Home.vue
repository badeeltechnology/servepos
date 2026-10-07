<template>
  <ProviderToday v-if="isProvider" />
  <template v-else>
    <Header title="Today" :subtitle="home.data ? 'Deliveries for ' + fmtDate(home.data.for_date) : ''">
      <Badge v-if="cut.order_cutoff" :theme="cut.orders_open ? 'green' : 'amber'" variant="subtle" size="md"
        :label="cut.orders_open ? 'Orders open until ' + cut.order_cutoff : 'Past ' + cut.order_cutoff + ': late orders'" />
      <Button variant="solid" icon-left="lucide-plus" label="New order" route="/order" />
    </Header>

    <div v-if="home.data" class="space-y-6 px-3 pb-10 pt-5 sm:px-5">
      <!-- figures -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <template v-if="money">
          <NumberCard title="Stock on hand" :value="home.data.stock_value" :prefix="cur" :format="fmtMoney" :delta-caption="home.data.items_in_stock + ' items in stock'" />
          <NumberCard title="Received this week" :value="home.data.received_week_total" :prefix="cur" :format="fmtMoney"
            :sparkline="{ data: home.data.received_week.map((d) => d.value), type: 'bar' }" />
        </template>
        <template v-else>
          <NumberCard title="Items in stock" :value="home.data.items_in_stock" delta-caption="items with stock in your outlet" />
          <NumberCard title="Received this week" :value="home.data.received_week_orders" suffix=" deliveries"
            :sparkline="{ data: home.data.received_week.map((d) => d.orders), type: 'bar' }" />
        </template>
        <NumberCard title="To receive" :value="home.data.incoming.length" :delta-caption="home.data.discrepancies.length ? home.data.discrepancies.length + ' with a discrepancy' : 'deliveries on the way'" />
        <NumberCard title="Next inventory" :value="invValue" :delta-caption="invCaption" />
      </div>

      <!-- today's orders -->
      <section class="space-y-2">
        <h2 class="text-lg-semibold">Orders for {{ fmtDate(home.data.for_date) }}</h2>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div v-for="c in cards" :key="c.provider" class="flex flex-col gap-3 rounded-6 border border-outline-gray-1 bg-surface-base p-4">
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full" :style="{ background: providerColor(c.provider) }" aria-hidden="true" />
              <span class="text-lg-semibold">{{ c.provider }}</span>
              <span class="flex-1" />
              <StatusBadge :status="c.order ? c.order.status : 'New'" />
            </div>
            <Progress v-if="c.list_items" :value="Math.round((100 * (c.filled || 0)) / c.list_items)" size="sm"
              :label="c.order ? `${c.filled} of ${c.list_items} items` : `${c.list_items} item${c.list_items === 1 ? '' : 's'} on your list`" />
            <p v-else class="text-p-sm text-ink-gray-5">No list yet: search and add items.</p>
            <p class="text-p-sm text-ink-gray-5">{{ cardHint(c) }}</p>
            <div class="mt-auto">
              <Button :variant="c.order && c.order.status !== 'Draft' ? 'subtle' : 'solid'" :route="'/order/' + encodeURIComponent(c.provider)"
                :label="c.order ? (c.order.status === 'Draft' ? 'Continue draft' : 'Open ' + c.order.name) : 'Order from ' + c.provider" />
            </div>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <!-- deliveries -->
        <section class="space-y-2">
          <h2 class="text-lg-semibold">To receive</h2>
          <List :columns="['auto', 'minmax(0,1fr)', 'auto']" class="rounded-6 border border-outline-gray-1 list-row-px-3">
            <ListRow v-for="o in home.data.incoming" :key="o.name" :route="'/o/' + o.name" class="min-h-14">
              <ListCell><span class="size-2 rounded-full" :style="{ background: providerColor(o.from_location) }" aria-hidden="true" /></ListCell>
              <ListCell class="flex-col !items-start"><span class="text-base-medium">{{ o.order_type === 'Order' ? o.from_location : o.order_type + ' from ' + o.from_location }}</span>
                <span class="mt-1 text-sm text-ink-gray-5">{{ o.name }} · {{ o.lines }} items · shipped {{ fmtTime(o.shipped_on) }}</span></ListCell>
              <ListCell><Button variant="solid" label="Receive" :route="'/o/' + o.name" /></ListCell>
            </ListRow>
            <ListRow v-for="o in home.data.discrepancies" :key="o.name" :route="'/o/' + o.name" class="min-h-14">
              <ListCell><span class="size-2 rounded-full bg-surface-red-7" aria-hidden="true" /></ListCell>
              <ListCell class="flex-col !items-start"><span class="text-base-medium">{{ o.from_location }}</span><span class="mt-1 text-sm text-ink-gray-5">{{ o.name }} · received less than shipped</span></ListCell>
              <ListCell><StatusBadge status="Discrepancy" /></ListCell>
            </ListRow>
            <Empty v-if="!home.data.incoming.length && !home.data.discrepancies.length">Nothing on the way.</Empty>
          </List>
        </section>

        <!-- transfers -->
        <section class="space-y-2">
          <div class="flex items-center"><h2 class="flex-1 text-lg-semibold">Transfers</h2><Button variant="ghost" icon-left="lucide-arrow-left-right" label="Ask another outlet" route="/transfers" /></div>
          <List :columns="['minmax(0,1fr)', 'auto']" class="rounded-6 border border-outline-gray-1 list-row-px-3">
            <ListRow v-for="o in home.data.transfers_asked" :key="o.name" :route="'/o/' + o.name" class="min-h-14">
              <ListCell class="flex-col !items-start"><span class="text-base-medium">{{ o.to_location }} asks you for stock</span><span class="mt-1 text-sm text-ink-gray-5">{{ o.name }} · {{ fmtTime(o.submitted_on) }}</span></ListCell>
              <ListCell><Button theme="blue" variant="solid" label="Review" :route="'/o/' + o.name" /></ListCell>
            </ListRow>
            <ListRow v-for="o in home.data.transfers_mine" :key="o.name" :route="'/o/' + o.name" class="min-h-14">
              <ListCell class="flex-col !items-start"><span class="text-base-medium">You asked {{ o.from_location }}</span><span class="mt-1 text-sm text-ink-gray-5">{{ o.name }} · {{ fmtTime(o.submitted_on) }}</span></ListCell>
              <ListCell><StatusBadge :status="o.status" /></ListCell>
            </ListRow>
            <Empty v-if="!home.data.transfers_asked.length && !home.data.transfers_mine.length">No open transfers.</Empty>
          </List>
        </section>
      </div>

      <!-- charts: values for managers, delivery counts for outlet staff -->
      <div class="grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div class="h-72 xl:col-span-3">
          <BarChart v-if="money" title="Received, last 7 days" :subtitle="'Value at cost, ' + cur.trim()" :data="weekRows" x="day" y="value" :format="fmtMoney" />
          <BarChart v-else title="Deliveries received, last 7 days" :data="weekRows" x="day" y="orders" />
        </div>
        <div class="h-72 xl:col-span-2">
          <DonutChart v-if="money" title="Where stock came from" subtitle="Last 30 days, value at cost" :data="home.data.received_month" category="provider" value="value" :format="fmtMoney" />
          <DonutChart v-else title="Deliveries by provider" subtitle="Last 30 days" :data="home.data.received_month" category="provider" value="orders" />
        </div>
      </div>
    </div>
    <div v-else class="grid grid-cols-2 gap-3 px-5 pt-5 lg:grid-cols-4">
      <ErrorMessage v-if="home.error" :message="errText(home.error)" class="col-span-full" />
      <template v-else><Skeleton v-for="i in 4" :key="i" class="h-24 rounded-6" /></template>
    </div>
  </template>
</template>
<script setup>
import { computed } from 'vue'
import { Badge, Button, ErrorMessage, Progress, Skeleton } from 'frappe-ui'
import { List, ListCell, ListRow } from 'frappe-ui/list'
import { BarChart, DonutChart, NumberCard } from 'frappe-ui/charts'
import Header from '../components/Header.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Empty from '../components/Empty.vue'
import ProviderToday from './ProviderToday.vue'
import { useRead, errText, fmtDate, fmtTime } from '../api'
import { state, isProvider, providerColor } from '../state'

const home = useRead('get_home', () => ({ location_name: state.location.name }), { immediate: !isProvider.value })
const cut = computed(() => (home.data && home.data.cutoff) || {})
const cur = computed(() => (home.data && home.data.currency ? home.data.currency + ' ' : ''))
const money = computed(() => !!(home.data && home.data.see_amounts))
const fmtMoney = (v) => Number(v || 0).toLocaleString('en', { maximumFractionDigits: 0 })
const cards = computed(() => state.ctx.providers.map((p) => (home.data.cards || []).find((c) => c.provider === p.name) || { provider: p.name, list_items: 0, order: null }))
const weekRows = computed(() => home.data.received_week.map((d) => ({ day: fmtDate(d.date).split(' ').slice(0, 2).join(' '), value: d.value, orders: d.orders })))
const invValue = computed(() => {
  const d = home.data.inventory_due
  if (!d) return '-'
  return d.status === 'Next' ? (d.date ? fmtDate(d.date) : '-') : 'Today'
})
const invCaption = computed(() => {
  const d = home.data.inventory_due
  if (!d) return ''
  return d.status === 'Next' ? 'counts on the 15th and month end' : d.status === 'Due' ? 'count is due now' : 'today: ' + d.status.toLowerCase()
})
function cardHint(c) {
  const st = c.order && c.order.status
  if (st === 'Submitted') return cut.value.changes_open ? 'You can still change it until ' + cut.value.change_cutoff : 'Locked, with ' + c.provider
  if (st && st !== 'Draft') return 'This order is ' + st.toLowerCase()
  return cut.value.orders_open ? 'Order before ' + cut.value.order_cutoff : 'Past the cutoff: goes to ' + c.provider + ' as a late order'
}
</script>
