<template><Badge :label="status" :theme="theme" variant="subtle" size="md" /></template>
<script setup>
import { computed } from 'vue'
import { Badge } from 'frappe-ui'
const props = defineProps({ status: String })
const THEMES = { Draft: 'amber', New: 'gray', Submitted: 'blue', Shipped: 'violet', Received: 'green', Closed: 'gray', Discrepancy: 'red', Cancelled: 'gray', Counting: 'amber', Corrected: 'green', Due: 'amber' }
const theme = computed(() => THEMES[props.status] ?? 'gray')
</script>
