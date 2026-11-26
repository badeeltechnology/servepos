<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)" title="Popular items" size="lg">
    <div class="space-y-3">
      <Select v-model="profile" :options="outletOptions(false)" aria-label="Outlet" />
      <p class="text-p-sm text-ink-gray-6">These items show first on the POS Popular tab, in this order. Up to {{ MAX }}.</p>
      <div v-if="loading" class="py-6"><LoadingText /></div>
      <div v-else class="max-h-[40vh] overflow-y-auto">
        <List :columns="['2rem', 'minmax(0,1fr)', 'auto', 'auto']" class="list-row-px-2">
          <ListRows :items="pins" row-key="item_code" v-slot="{ item: r, index: i }">
            <ListRow class="min-h-11">
              <ListCell class="justify-end text-xs text-ink-gray-4 num">{{ i + 1 }}</ListCell>
              <ListCell class="min-w-0 flex-col !items-start"><span class="w-full truncate">{{ r.item_name }}</span><span class="text-xs text-ink-gray-5">{{ r.item_group }}</span></ListCell>
              <ListCell><Badge v-if="r.on_outlet === false" theme="orange" label="Not on this outlet" /></ListCell>
              <ListCell class="justify-end">
                <Button variant="ghost" size="sm" icon="lucide-arrow-up" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)" />
                <Button variant="ghost" size="sm" icon="lucide-arrow-down" aria-label="Move down" :disabled="i === pins.length - 1" @click="move(i, 1)" />
                <Button variant="ghost" size="sm" icon="lucide-x" aria-label="Unpin" @click="pins.splice(i, 1); dirty = true" />
              </ListCell>
            </ListRow>
          </ListRows>
        </List>
        <p v-if="!pins.length" class="py-6 text-center text-p-sm text-ink-gray-5">No pinned items on this outlet.</p>
      </div>
      <Combobox class="w-full" :model-value="null" v-model:query="q" :options="found.map((f) => ({ label: f.item_name, value: f.name, description: f.item_group }))" :filterable="false"
        placeholder="Add an item: type its name" empty-text="Type two letters or more to search this outlet's menu" :disabled="pins.length >= MAX"
        @update:model-value="(v) => { const f = found.find((x) => x.name === v); if (f) add(f) }" @update:open="(o) => o && (q = '')" />
    </div>
    <template #actions="{ close }">
      <div class="flex items-center justify-between"><span class="text-p-sm text-ink-gray-5">{{ pins.length }} / {{ MAX }}</span>
        <div class="flex gap-2"><Button label="Close" @click="close" /><Button variant="solid" label="Save" :disabled="!dirty" :loading="saving" @click="save" /></div></div>
    </template>
  </Dialog>
</template>
<script setup>
import { ref, watch } from 'vue'
import { Badge, Button, Combobox, Dialog, LoadingText, Select } from 'frappe-ui'
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list'
import { get, post, act } from '../api'
import { outletOptions } from '../state'
const MAX = 24
const props = defineProps({ open: Boolean, outlet: String })
const emit = defineEmits(['update:open', 'saved'])
const profile = ref(props.outlet || ''), pins = ref([]), loading = ref(false), dirty = ref(false), saving = ref(false), q = ref(''), found = ref([])
watch(() => props.outlet, (v) => { if (v && !profile.value) profile.value = v })
watch(() => [props.open, profile.value], async () => {
  if (!props.open || !profile.value) return
  loading.value = true
  try { pins.value = await get('menu_admin.get_pinned', { pos_profile: profile.value }); dirty.value = false } finally { loading.value = false }
}, { immediate: true })
watch(q, async (v) => {
  if (!v || v.length < 2) return (found.value = [])
  const r = await get('admin.list_items', { search: v, outlet: profile.value, status: 'active', page_length: 8 })
  const have = new Set(pins.value.map((p) => p.item_code))
  found.value = r.rows.filter((x) => !have.has(x.name))
})
function add(f) { pins.value.push({ item_code: f.name, item_name: f.item_name, item_group: f.item_group, on_outlet: true }); q.value = ''; found.value = []; dirty.value = true }
function move(i, d) { const a = [...pins.value]; [a[i], a[i + d]] = [a[i + d], a[i]]; pins.value = a; dirty.value = true }
async function save() {
  saving.value = true
  // items that left the outlet menu cannot stay pinned; they are dropped on save
  const keep = pins.value.filter((p) => p.on_outlet !== false).map((p) => p.item_code)
  const dropped = pins.value.length - keep.length
  const r = await act(() => post('menu_admin.set_pinned', { pos_profile: profile.value, items: keep }), dropped ? `Saved. ${dropped} items not on this outlet were unpinned.` : 'Popular items saved')
  saving.value = false
  if (r) { pins.value = r; dirty.value = false; emit('saved') }
}
</script>
