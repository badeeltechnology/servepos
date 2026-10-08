<template>
  <Dropdown :options="options" align="end">
    <Button v-if="label" :label="label" icon-left="lucide-download" />
    <Button v-else icon="lucide-download" aria-label="Download PDF or Excel" />
  </Dropdown>
</template>
<script setup>
import { computed } from 'vue'
import { Button, Dropdown } from 'frappe-ui'
// PDF opens in a new tab (print from there); Excel downloads.
const props = defineProps({ kind: String, params: Object, label: { type: String, default: 'Download' }, print: { type: Boolean, default: true } })
const url = (fmt) => '/api/method/servepos.stock_orders.exports.download?' + new URLSearchParams({ kind: props.kind, fmt, ...Object.fromEntries(Object.entries(props.params || {}).filter(([, v]) => v != null && v !== '')) })
const options = computed(() => [
  { label: props.print ? 'PDF / print' : 'PDF', icon: 'lucide-file-text', onClick: () => window.open(url('pdf'), '_blank') },
  { label: 'Excel', icon: 'lucide-sheet', onClick: () => (window.location.href = url('xlsx')) },
])
</script>
