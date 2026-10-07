<template>
  <Header title="Returns" />
  <div class="grid grid-cols-1 gap-6 px-3 pb-10 pt-5 sm:px-5 xl:grid-cols-2">
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Return stock to a provider</h2>
      <p class="text-p-sm text-ink-gray-6">The stock leaves your warehouse now. The provider confirms what arrived.</p>
      <div class="space-y-1.5"><div class="text-xs text-ink-gray-5">Return to</div><TabButtons :options="providers" v-model="to" /></div>
      <div class="space-y-1.5"><div class="text-xs text-ink-gray-5">Reason</div><TabButtons :options="reasons.map((r) => ({ label: r, value: r }))" v-model="reason" /></div>
      <LineEditor v-model="lines" :location="state.location.name" placeholder="Search your stock…" have-label="You have" empty="Search above and add the items you are sending back." />
      <TextInput v-model="note" placeholder="Note (optional)" aria-label="Note" />
      <Button variant="solid" :disabled="!ready" :loading="sender.loading" :label="'Send return' + (to ? ' to ' + to : '')" @click="send" />
    </section>
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Returns</h2>
      <OrderRows :rows="list.data || []" :party="party" party-label="With" time-field="shipped_on" time-label="Sent" empty="No returns yet." />
    </section>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { Button, TabButtons, TextInput, toast } from 'frappe-ui'
import Header from '../components/Header.vue'
import OrderRows from '../components/OrderRows.vue'
import LineEditor from '../components/LineEditor.vue'
import { useRead, useWrite, errText } from '../api'
import { state } from '../state'
const reasons = ['Expired', 'Damaged', 'Quality', 'Excess', 'Wrong item']
const providers = computed(() => state.ctx.providers.filter((p) => p.name !== state.location.name).map((p) => ({ label: p.name, value: p.name })))
const to = ref(''), reason = ref(''), lines = ref([]), note = ref('')
const ready = computed(() => to.value && reason.value && lines.value.some((l) => Number(l.qty) > 0))
const party = (o) => (o.from_location === state.location.name ? 'To ' + o.to_location : 'From ' + o.from_location) + (o.reason ? ' · ' + o.reason : '')
const list = useRead('list_orders', () => ({ view: 'returns', location_name: state.location.name }))
const sender = useWrite('send_return')
async function send() {
  try {
    const r = await sender.submit({ from_location: state.location.name, to_location: to.value, reason: reason.value, note: note.value,
      lines: lines.value.filter((l) => Number(l.qty) > 0).map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom })) })
    toast.success(`${r.name} sent to ${to.value}`)
    lines.value = []; note.value = ''; reason.value = ''; list.reload()
  } catch (e) { toast.error(errText(e)) }
}
</script>
