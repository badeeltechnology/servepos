<template>
  <div class="space-y-2">
    <ItemSearch class="w-full max-w-md" method="get_stock_items" :params="(q) => ({ location_name: location, txt: q })" :exclude="modelValue.map((l) => l.item_code)" :placeholder="placeholder" all @add="add" :key="location" />
    <SearchInput v-if="modelValue.length > 6" v-model="q" placeholder="Find in the list" />
    <List v-if="modelValue.length" :columns="['minmax(160px,1fr)', '6rem', '7rem', '4rem', '2rem']" class="card list-row-px-3">
      <ListHeader><ListHeaderCell>Item</ListHeaderCell><ListHeaderCell class="justify-end">{{ haveLabel }}</ListHeaderCell><ListHeaderCell class="justify-end">Qty</ListHeaderCell><ListHeaderCell>UOM</ListHeaderCell><ListHeaderCell /></ListHeader>
      <ListRow v-for="l in modelValue.filter((x) => matches(q, x.item_name, x.item_code))" :key="l.item_code" class="min-h-11 py-1">
        <ListCell><span class="truncate">{{ l.item_name }}</span></ListCell>
        <ListCell class="justify-end text-ink-gray-5 num">{{ fmt(l.have) }}</ListCell>
        <ListCell><TextInput class="qty w-full" type="number" min="0" step="any" inputmode="decimal" variant="outline" :model-value="l.qty" @update:model-value="(v) => (l.qty = v)" :aria-label="'Qty for ' + l.item_name" /></ListCell>
        <ListCell class="text-ink-gray-6">{{ l.uom }}</ListCell>
        <ListCell><Button size="sm" variant="ghost" icon="lucide-x" :aria-label="'Remove ' + l.item_name" @click="modelValue.splice(modelValue.indexOf(l), 1)" /></ListCell>
      </ListRow>
    </List>
    <Empty v-else class="card">{{ empty }}</Empty>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { Button, TextInput } from 'frappe-ui'
import SearchInput from './SearchInput.vue'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import ItemSearch from './ItemSearch.vue'
import Empty from './Empty.vue'
import { fmt, matches } from '../api'
const q = ref('')
const props = defineProps({ modelValue: Array, location: String, placeholder: String, haveLabel: { type: String, default: 'In stock' }, empty: String })
function add(r) { props.modelValue.push({ item_code: r.item_code, item_name: r.item_name, uom: r.stock_uom, have: r.actual_qty, qty: '' }) }
</script>
