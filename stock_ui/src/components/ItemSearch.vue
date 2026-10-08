<template>
  <Combobox v-model="picked" v-model:query="query" :options="options" :filterable="false" :loading="search.loading"
    :placeholder="placeholder" :empty-text="query.length < 2 && !all ? 'Type to search' : 'No items found'" open-on-focus @update:model-value="choose" />
</template>
<script setup>
import { computed, ref } from 'vue'
import { Combobox } from 'frappe-ui'
import { useRead, fmt } from '../api'

// Server-side item search. `method` is an API method name; `params(query)` builds its arguments.
const props = defineProps({ method: String, params: Function, placeholder: String, exclude: { type: Array, default: () => [] }, all: Boolean })
const emit = defineEmits(['add'])
const picked = ref(null)
const query = ref('')
const search = useRead(props.method, () => props.params(query.value), { immediate: props.all })
const options = computed(() =>
  (search.data || [])
    .filter((r) => !props.exclude.includes(r.item_code))
    .slice(0, 30)
    .map((r) => ({ value: r.item_code, label: r.item_name, description: r.actual_qty !== undefined ? `${r.item_code} · ${fmt(r.actual_qty)} ${r.stock_uom}` : r.item_code })),
)
function choose(code) {
  if (!code) return
  const row = (search.data || []).find((r) => r.item_code === code)
  if (row) emit('add', row)
  // let the combobox finish its own update first, then empty it for the next item
  setTimeout(() => { picked.value = null; query.value = '' }, 0)
}
</script>
