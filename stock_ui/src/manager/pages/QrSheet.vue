<template>
  <Header title="Table QR codes" back="/floor" :subtitle="subtitle">
    <Button variant="solid" label="Print" icon-left="lucide-printer" :disabled="!codes.length" @click="print" />
  </Header>
  <div class="px-3 pb-16 pt-4 sm:px-5">
    <p class="no-print mb-3 text-p-sm text-ink-gray-6">Guests scan the code to see the menu, order, or call a waiter. Print on A4: {{ codes.length }} {{ codes.length === 1 ? 'code' : 'codes' }}, 12 per page.</p>
    <div v-if="loading" class="py-10"><LoadingText text="Making QR codes…" /></div>
    <div class="print-area grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
      <div v-for="c in codes" :key="c.name" class="qr-card flex flex-col items-center rounded-6 border border-dashed border-outline-gray-3 p-4 text-center">
        <div class="size-36 [&_svg]:size-full" v-html="c.svg" />
        <div class="mt-2 text-xl-semibold">{{ c.name }}</div>
        <div class="text-xs text-ink-gray-6">Scan to see the menu or call a waiter</div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Button, LoadingText } from 'frappe-ui'
import Header from '../../components/Header.vue'
import { get, post } from '../api'

const route = useRoute()
const codes = ref([]), loading = ref(true)
const subtitle = computed(() => route.query.room || route.query.branch || 'All tables')
onMounted(async () => {
  try {
    const floor = await get('admin.list_floor', { branch: route.query.branch || null })
    const names = floor.tables.filter((t) => t.is_active && (!route.query.room || t.room === route.query.room)).map((t) => t.name)
    codes.value = names.length ? await post('admin.table_qr', { tables: names }) : []
  } finally {
    loading.value = false
  }
})
const print = () => window.print()
</script>
<style>
@media print {
  body * { visibility: hidden; }
  .print-area, .print-area * { visibility: visible; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; }
  .qr-card { break-inside: avoid; }
}
</style>
