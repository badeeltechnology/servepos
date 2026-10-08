<template>
  <Header title="Send stock" />
  <div class="grid grid-cols-1 gap-6 px-3 pb-10 pt-5 sm:px-5 xl:grid-cols-2">
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Send without an order</h2>
      <p class="text-p-sm text-ink-gray-6">
        The stock leaves {{ state.location.name }} now and is on the way until {{ to || 'the other side' }} confirms what arrived.
        {{ isProvider ? '' : 'To send stock back to a provider, use Returns.' }}
      </p>
      <Select v-model="to" :options="destinations" placeholder="Choose where to send" label="Send to" />
      <LineEditor v-if="to" v-model="lines" :location="state.location.name" placeholder="Search your stock…" have-label="You have" empty="Search above and add the items you are sending." />
      <TextInput v-if="to" v-model="note" placeholder="Note (optional), for example instead of mango in STO-26-00006" aria-label="Note" />
      <Button variant="solid" :disabled="!ready" :loading="sender.loading" :label="'Send' + (to ? ' to ' + to : '')" @click="send" />
    </section>
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Sent by {{ state.location.name }}</h2>
      <OrderRows :rows="list.data || []" :party="(o) => 'To ' + o.to_location" party-label="To" time-field="shipped_on" time-label="Sent" empty="Nothing sent without an order yet." />
    </section>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { Button, Select, TextInput, toast } from 'frappe-ui'
import Header from '../components/Header.vue'
import OrderRows from '../components/OrderRows.vue'
import LineEditor from '../components/LineEditor.vue'
import { useRead, useWrite, errText } from '../api'
import { state } from '../state'

const isProvider = computed(() => state.location.location_type === 'Provider')
const destinations = computed(() => {
  const here = state.location.name
  const outlets = state.ctx.all_outlets.filter((o) => o.name !== here).map((o) => ({ value: o.name, label: o.name, description: o.location_group }))
  if (!isProvider.value) return outlets
  const providers = state.ctx.providers.filter((p) => p.name !== here).map((p) => ({ value: p.name, label: p.name, description: 'Provider' }))
  return [...providers, ...outlets]
})
const to = ref(null), lines = ref([]), note = ref('')
const ready = computed(() => to.value && lines.value.some((l) => Number(l.qty) > 0))
const list = useRead('list_orders', () => ({ view: 'sent', location_name: state.location.name }))
const sender = useWrite('send_delivery')
async function send() {
  try {
    const r = await sender.submit({ from_location: state.location.name, to_location: to.value, note: note.value,
      lines: lines.value.filter((l) => Number(l.qty) > 0).map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom })) })
    toast.success(`${r.name} sent to ${to.value}: they confirm when it arrives`)
    lines.value = []; note.value = ''; list.reload()
  } catch (e) { toast.error(errText(e)) }
}
</script>
