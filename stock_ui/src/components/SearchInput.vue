<template>
  <TextInput :model-value="modelValue" @update:model-value="(v) => emit('update:modelValue', v)" type="search" :placeholder="placeholder" class="w-full sm:w-64" aria-label="Search">
    <template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template>
  </TextInput>
</template>
<script setup>
import { TextInput } from 'frappe-ui'
defineProps({ modelValue: String, placeholder: { type: String, default: 'Search' } })
const emit = defineEmits(['update:modelValue'])
</script>
