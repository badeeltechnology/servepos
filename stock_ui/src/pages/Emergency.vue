<template>
  <Header title="Emergency order" />
  <div class="grid grid-cols-1 gap-6 px-3 pb-10 pt-5 sm:px-5 xl:grid-cols-2">
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Order now, outside the cutoffs</h2>
      <p class="text-p-sm text-ink-gray-6">
        For when today's orders are closed or already shipped. It goes to the provider as a separate order for today, marked
        Emergency and listed first on their To ship screen. You confirm what arrives as usual.
      </p>
      <TabButtons v-if="providers.length > 1" :options="providers.map((p) => ({ label: p, value: p }))" v-model="provider" />
      <LineEditor v-if="provider" v-model="lines" :location="provider" :key="provider" :placeholder="'Search what ' + provider + ' has…'" have-label="They have" empty="Search above and add what you need now." />
      <TextInput v-if="provider" v-model="reason" placeholder="Why is it urgent? For example: ran out of croissants before lunch" aria-label="Reason" />
      <TextInput v-if="provider" v-model="note" placeholder="Note for the provider (optional)" aria-label="Note" />
      <Button variant="solid" theme="red" :disabled="!ready" :loading="sender.loading" :label="'Send emergency order' + (provider ? ' to ' + provider : '')" @click="send" />
    </section>
    <section class="space-y-3">
      <h2 class="text-lg-semibold">Emergency orders from {{ state.location.name }}</h2>
      <OrderRows :rows="(list.data || []).filter((o) => o.is_emergency)" :party="(o) => 'From ' + o.from_location" party-label="From" empty="No emergency orders yet." />
    </section>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, TabButtons, TextInput, toast } from 'frappe-ui'
import Header from '../components/Header.vue'
import OrderRows from '../components/OrderRows.vue'
import LineEditor from '../components/LineEditor.vue'
import { useRead, useWrite, errText } from '../api'
import { state } from '../state'

const route = useRoute(), router = useRouter()
const isProv = computed(() => state.location.location_type === 'Provider')
const providers = computed(() => (isProv.value ? (state.location.orders_from ? [state.location.orders_from] : []) : state.ctx.providers.map((p) => p.name)))
const provider = ref(route.params.provider || providers.value[0] || null)
const lines = ref([]), reason = ref(''), note = ref('')
const ready = computed(() => provider.value && reason.value.trim() && lines.value.some((l) => Number(l.qty) > 0))
const list = useRead('list_orders', () => ({ view: 'history', location_name: state.location.name }))
const sender = useWrite('place_emergency_order')
async function send() {
  try {
    const r = await sender.submit({ location_name: state.location.name, provider: provider.value, reason: reason.value, note: note.value,
      lines: lines.value.filter((l) => Number(l.qty) > 0).map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom })) })
    toast.success(`${r.name} sent to ${provider.value} as an emergency order`)
    router.push('/o/' + r.name)
  } catch (e) { toast.error(errText(e)) }
}
</script>
