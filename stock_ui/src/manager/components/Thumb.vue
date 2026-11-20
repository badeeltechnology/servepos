<template>
  <img v-if="src && !broken" :src="src" class="size-8 shrink-0 rounded-4 border border-outline-gray-1 object-cover" alt="" @error="broken = true" />
  <div v-else class="flex size-8 shrink-0 items-center justify-center rounded-4 bg-surface-gray-2 text-xs-semibold text-ink-gray-5">{{ (text || '?').slice(0, 1).toUpperCase() }}</div>
</template>
<script setup>
import { ref } from 'vue'
defineProps({ src: String, text: String })
const broken = ref(false)
</script>
