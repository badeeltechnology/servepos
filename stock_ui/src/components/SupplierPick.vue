<template>
  <Combobox :model-value="modelValue" @update:model-value="(v) => emit('update:modelValue', v)" v-model:query="query" :options="options" :filterable="false"
    :loading="search.loading" placeholder="Choose supplier" empty-text="No supplier found" open-on-focus />
</template>
<script setup>
import { computed, ref } from 'vue'
import { Combobox } from 'frappe-ui'
import { useRead } from '../api'
const props = defineProps({ modelValue: String, suggested: String })
const emit = defineEmits(['update:modelValue'])
const query = ref('')
const search = useRead('search_suppliers', () => ({ txt: query.value }))
const options = computed(() => {
  const rows = (search.data || []).map((s) => ({ value: s.name, label: s.supplier_name, description: s.name === props.suggested ? 'Suggested: bought last time' : undefined }))
  // keep the current value and the suggestion selectable even when the search does not return them
  for (const v of [props.modelValue, props.suggested]) if (v && !rows.some((r) => r.value === v)) rows.unshift({ value: v, label: v })
  return rows
})
</script>
