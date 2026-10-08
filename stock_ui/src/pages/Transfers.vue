<template>
  <Header title="Transfers" />
  <div class="grid grid-cols-1 gap-6 px-3 pb-10 pt-5 sm:px-5 xl:grid-cols-2">
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Ask another outlet</h2>
      <p class="text-p-sm text-ink-gray-6">The other outlet approves and sends what it can. Stock moves when they send and when you confirm receipt.</p>
      <Select v-model="from" :options="outlets" placeholder="Choose an outlet" label="Ask" />
      <LineEditor v-if="from" v-model="lines" :location="from" :placeholder="'Search what ' + from + ' has…'" have-label="They have" empty="Search above and add the items you need." />
      <TextInput v-if="from" v-model="note" placeholder="Note (optional), for example ran out before service" aria-label="Note" />
      <Button variant="solid" :disabled="!ready" :loading="sender.loading" :label="'Send request' + (from ? ' to ' + from : '')" @click="send" />
    </section>
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Transfers for {{ state.location.name }}</h2>
      <OrderRows :rows="list.data || []" :party="party" party-label="With" empty="No transfers yet." />
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
const outlets = computed(() => state.ctx.all_outlets.filter((o) => o.name !== state.location.name).map((o) => ({ value: o.name, label: o.name, description: o.location_group })))
const from = ref(null), lines = ref([]), note = ref('')
const ready = computed(() => from.value && lines.value.some((l) => Number(l.qty) > 0))
const party = (o) => (o.to_location === state.location.name ? 'You asked ' + o.from_location : o.to_location + ' asks you')
const list = useRead('list_orders', () => ({ view: 'transfers', location_name: state.location.name }))
const sender = useWrite('request_transfer')
async function send() {
  try {
    const r = await sender.submit({ from_location: from.value, to_location: state.location.name, note: note.value,
      lines: lines.value.filter((l) => Number(l.qty) > 0).map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom })) })
    toast.success(`${r.name} sent to ${from.value}`)
    lines.value = []; note.value = ''; list.reload()
  } catch (e) { toast.error(errText(e)) }
}
</script>
