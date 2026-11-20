<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)" title="Popular items" size="lg">
    <div class="space-y-3">
      <Select v-model="profile" :options="outletOptions(false)" aria-label="Outlet" />
      <p class="text-p-sm text-ink-gray-6">These items show first on the POS Popular tab, in this order. Up to {{ MAX }}.</p>
      <div v-if="loading" class="py-6"><LoadingText /></div>
      <div v-else class="max-h-[40vh] divide-y divide-outline-gray-1 overflow-y-auto rounded-6 border border-outline-gray-2">
        <div v-for="(r, i) in pins" :key="r.item_code" class="flex items-center gap-2 px-3 py-1.5">
          <span class="w-6 text-right text-xs text-ink-gray-4 num">{{ i + 1 }}</span>
          <div class="min-w-0 flex-1"><div class="truncate text-base">{{ r.item_name }}</div><div class="text-xs text-ink-gray-5">{{ r.item_group }}</div></div>
          <Badge v-if="r.on_outlet === false" theme="amber" label="Not on this outlet" />
          <Button variant="ghost" size="sm" icon="lucide-arrow-up" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)" />
          <Button variant="ghost" size="sm" icon="lucide-arrow-down" aria-label="Move down" :disabled="i === pins.length - 1" @click="move(i, 1)" />
          <Button variant="ghost" size="sm" icon="lucide-x" aria-label="Unpin" @click="pins.splice(i, 1); dirty = true" />
        </div>
        <div v-if="!pins.length" class="px-3 py-6 text-center text-p-sm text-ink-gray-5">No pinned items on this outlet.</div>
      </div>
      <div class="relative">
        <TextInput v-model="q" placeholder="Add an item: type its name" :debounce="250" :disabled="pins.length >= MAX" />
        <div v-if="found.length" class="absolute z-10 mt-1 w-full rounded-6 border border-outline-gray-2 bg-surface-white p-1 shadow-lg">
          <button v-for="f in found" :key="f.name" class="block w-full rounded-4 px-2 py-1.5 text-left text-base hover:bg-surface-gray-2" @click="add(f)">{{ f.item_name }} <span class="text-xs text-ink-gray-5">{{ f.item_group }}</span></button>
        </div>
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex items-center justify-between"><span class="text-p-sm text-ink-gray-5">{{ pins.length }} / {{ MAX }}</span>
        <div class="flex gap-2"><Button label="Close" @click="close" /><Button variant="solid" label="Save" :disabled="!dirty" :loading="saving" @click="save" /></div></div>
    </template>
  </Dialog>
</template>
<script setup>
import { ref, watch } from 'vue'
import { Badge, Button, Dialog, LoadingText, Select, TextInput } from 'frappe-ui'
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
