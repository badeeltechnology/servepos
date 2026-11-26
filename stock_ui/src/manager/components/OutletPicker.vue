<template>
  <!-- Pick outlets: a selectable frappe-ui List, whose header checkbox selects or clears all. -->
  <div class="max-h-72 overflow-y-auto">
    <List :selection="selected" selectable :columns="['minmax(0,1fr)', 'auto']" class="list-row-px-2" @update:selection="pick">
      <ListHeader>
        <ListHeaderCell>{{ selected.length }} of {{ profiles.length }} outlets</ListHeaderCell><ListHeaderCell />
      </ListHeader>
      <ListRows :items="profiles" row-key="name" v-slot="{ item: p, value }">
        <ListRow :value="value" class="min-h-9">
          <ListCell class="truncate">{{ p.name }}</ListCell>
          <ListCell class="text-xs text-ink-gray-5">{{ p.branch && p.branch !== p.name ? p.branch : '' }}</ListCell>
        </ListRow>
      </ListRows>
    </List>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'

const props = defineProps({ modelValue: { type: Array, default: () => [] }, profiles: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
// only outlets that are offered here count (a saved list can name outlets this user does not see)
const selected = computed(() => props.profiles.map((p) => p.name).filter((n) => props.modelValue.includes(n)))
function pick(v) {
  const s = new Set(v)
  emit('update:modelValue', props.profiles.map((p) => p.name).filter((n) => s.has(n)))
}
</script>
