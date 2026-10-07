<template>
  <Header title="Today" :subtitle="home.data ? 'Orders for ' + fmtDate(home.data.for_date) : ''">
    <span v-if="cut.order_cutoff" class="hidden text-sm text-ink-gray-5 lg:inline">Changes until {{ cut.change_cutoff }} · orders until {{ cut.order_cutoff }}</span>
  </Header>
  <div class="space-y-6 px-3 pb-10 pt-5 sm:px-5">
    <template v-if="home.data">
      <section class="space-y-2">
        <h2 class="text-lg-semibold">Order</h2>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div v-for="c in cards" :key="c.provider" class="card flex flex-col gap-1 p-4" :style="{ borderTop: '3px solid ' + providerColor(c.provider) }">
            <div class="flex items-center gap-2"><span class="text-lg-semibold">{{ c.provider }}</span><span class="flex-1" /><StatusBadge :status="c.order ? c.order.status : 'New'" /></div>
            <p class="text-p-sm text-ink-gray-6">{{ c.order ? `${c.order.name} · ${c.filled} of ${c.list_items} items` : c.list_items ? `Your list has ${c.list_items} items` : 'No list yet: search and add items' }}</p>
            <p class="text-p-sm text-ink-gray-5">{{ cardHint(c) }}</p>
            <div class="pt-2"><Button :variant="c.order && c.order.status !== 'Draft' ? 'subtle' : 'solid'" :route="'/order/' + encodeURIComponent(c.provider)" :label="c.order ? (c.order.status === 'Draft' ? 'Continue' : 'Open') : 'New ' + c.provider + ' order'" /></div>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section class="space-y-2 lg:col-span-3">
          <h2 class="text-lg-semibold">To receive</h2>
          <div class="card divide-y divide-outline-gray-1">
            <router-link v-for="o in home.data.incoming" :key="o.name" :to="'/o/' + o.name" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-gray-1">
              <span class="size-2 shrink-0 rounded-full" :style="{ background: providerColor(o.from_location) }" />
              <span class="flex min-w-0 flex-1 flex-col"><span class="text-base-medium">{{ o.order_type === 'Order' ? o.from_location : o.order_type + ' from ' + o.from_location }}</span>
                <span class="mt-1 text-sm text-ink-gray-5">{{ o.name }} · {{ o.lines }} items · shipped {{ fmtTime(o.shipped_on) }}</span></span>
              <Button variant="solid" label="Receive" />
            </router-link>
            <router-link v-for="o in home.data.discrepancies" :key="o.name" :to="'/o/' + o.name" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-gray-1">
              <span class="size-2 shrink-0 rounded-full bg-surface-red-7" />
              <span class="flex min-w-0 flex-1 flex-col"><span class="text-base-medium">{{ o.from_location }}</span><span class="mt-1 text-sm text-ink-gray-5">{{ o.name }} · received less than shipped</span></span>
              <StatusBadge status="Discrepancy" />
            </router-link>
            <Empty v-if="!home.data.incoming.length && !home.data.discrepancies.length">Nothing on the way.</Empty>
          </div>
        </section>
        <div class="space-y-6 lg:col-span-2">
          <section class="space-y-2">
            <h2 class="text-lg-semibold">Transfers</h2>
            <div class="card divide-y divide-outline-gray-1">
              <router-link v-for="o in home.data.transfers_asked" :key="o.name" :to="'/o/' + o.name" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-gray-1">
                <span class="flex-1 text-base"><b>{{ o.to_location }}</b> asks you for stock</span><Button theme="blue" variant="solid" label="Review" />
              </router-link>
              <router-link v-for="o in home.data.transfers_mine" :key="o.name" :to="'/o/' + o.name" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-gray-1">
                <span class="flex-1 text-base">You asked <b>{{ o.from_location }}</b></span><StatusBadge :status="o.status" />
              </router-link>
              <Empty v-if="!home.data.transfers_asked.length && !home.data.transfers_mine.length">No open transfers.</Empty>
            </div>
          </section>
          <section class="space-y-2">
            <h2 class="text-lg-semibold">Inventory</h2>
            <div class="card space-y-3 p-4">
              <p class="text-p-sm text-ink-gray-6" v-if="home.data.inventory_due">{{ home.data.inventory_due.status === 'Next' ? 'Next count ' + fmtDate(home.data.inventory_due.date) : 'Count due today (' + home.data.inventory_due.status + ')' }}</p>
              <div class="flex flex-wrap gap-2">
                <Button route="/inventory" label="Inventory" icon-left="lucide-clipboard-list" />
                <Button route="/transfers" label="Ask another outlet" icon-left="lucide-arrow-left-right" />
                <Button route="/returns" label="Return" icon-left="lucide-undo-2" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
    <LoadingText v-else-if="home.loading" />
    <ErrorMessage v-else-if="home.error" :message="errText(home.error)" />
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { Button, ErrorMessage, LoadingText } from 'frappe-ui'
import Header from '../components/Header.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Empty from '../components/Empty.vue'
import { useRead, errText, fmtDate, fmtTime } from '../api'
import { state, providerColor } from '../state'

const home = useRead('get_home', () => ({ location_name: state.location.name }))
const cards = computed(() => state.ctx.providers.map((p) => (home.data.cards || []).find((c) => c.provider === p.name) || { provider: p.name, list_items: 0, order: null }))
const cut = computed(() => (home.data && home.data.cutoff) || {})
function cardHint(c) {
  const st = c.order && c.order.status
  if (st === 'Submitted') return cut.value.changes_open ? 'You can still change it until ' + cut.value.change_cutoff : 'Locked, with ' + c.provider
  if (st && st !== 'Draft') return 'This order is ' + st.toLowerCase()
  return cut.value.orders_open ? 'Order before ' + cut.value.order_cutoff : 'Past the cutoff: goes to ' + c.provider + ' as a late order'
}
</script>
