<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)" :title="current ? current : 'Categories and order'" size="lg">
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <Button v-if="current" icon="lucide-arrow-left" variant="ghost" aria-label="Back" @click="current = ''" />
        <Select v-model="outlet" :options="outletOptions(false)" class="flex-1" aria-label="Outlet" />
      </div>
      <p class="text-p-sm text-ink-gray-6">{{ current ? `The order of ${current} on the ${outlet} POS. Use the arrows, then save.` : `The order categories appear in on the ${outlet} POS. Open a category to order its items.` }}</p>

      <div v-if="loading" class="py-6"><LoadingText /></div>
      <div v-else class="max-h-[50vh] overflow-y-auto">
        <List :columns="['2rem', 'minmax(0,1fr)', 'auto', 'auto']" class="list-row-px-2">
          <ListRows :items="list" v-slot="{ item: r, index: i }">
            <ListRow class="min-h-10">
              <ListCell class="justify-end text-xs text-ink-gray-4 num">{{ i + 1 }}</ListCell>
              <ListCell class="min-w-0">
                <Button v-if="!current" variant="ghost" class="min-w-0 justify-start" :label="r.name" @click="openCategory(r.name)" />
                <span v-else class="truncate">{{ r.item_name }}</span>
              </ListCell>
              <ListCell class="text-xs text-ink-gray-5">{{ current ? '' : r.items + ' items' }}</ListCell>
              <ListCell class="justify-end">
                <Button variant="ghost" size="sm" icon="lucide-arrow-up" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)" />
                <Button variant="ghost" size="sm" icon="lucide-arrow-down" aria-label="Move down" :disabled="i === list.length - 1" @click="move(i, 1)" />
                <Button v-if="!current" variant="ghost" size="sm" icon="lucide-trash-2" aria-label="Delete category" :disabled="r.items > 0" :title="r.items ? 'Move its items out first' : 'Delete'" @click="remove(r.name)" />
              </ListCell>
            </ListRow>
          </ListRows>
        </List>
        <p v-if="!list.length" class="py-6 text-center text-p-sm text-ink-gray-5">Nothing here yet.</p>
      </div>

      <div v-if="!current" class="flex gap-2">
        <TextInput v-model="newName" placeholder="New category name" class="flex-1" @keydown.enter="create" />
        <Button label="Add category" :disabled="!newName.trim()" @click="create" />
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex items-center justify-between gap-2">
        <span class="text-p-sm text-ink-gray-5">{{ dirty ? 'Order changed, not saved yet' : '' }}</span>
        <div class="flex gap-2"><Button label="Close" @click="close" /><Button variant="solid" label="Save order" :disabled="!dirty" :loading="saving" @click="save" /></div>
      </div>
    </template>
  </Dialog>
</template>
<script setup>
import { ref, watch } from 'vue'
import { Button, Dialog, LoadingText, Select, TextInput, dialog } from 'frappe-ui'
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list'
import { get, post, act } from '../api'
import { state, outletOptions } from '../state'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'changed'])
const outlet = ref(state.outlet || state.setup.profiles[0]?.name || '')
const current = ref(''), list = ref([]), loading = ref(false), dirty = ref(false), saving = ref(false), newName = ref('')

async function load() {
  if (!props.open || !outlet.value) return
  loading.value = true
  try {
    list.value = current.value ? await get('admin.get_item_order', { pos_profile: outlet.value, item_group: current.value }) : await get('admin.list_categories', { outlet: outlet.value })
    dirty.value = false
  } finally {
    loading.value = false
  }
}
watch(() => [props.open, outlet.value, current.value], load, { immediate: true })
function openCategory(name) {
  if (dirty.value) return dialog.confirm({ title: 'Discard the changed order?', confirmLabel: 'Discard', onConfirm: () => (current.value = name) })
  current.value = name
}
function move(i, d) {
  const a = [...list.value]
  ;[a[i], a[i + d]] = [a[i + d], a[i]]
  list.value = a
  dirty.value = true
}
async function save() {
  saving.value = true
  const names = list.value.map((r) => r.name)
  const ok = current.value
    ? await act(() => post('admin.save_item_order', { pos_profile: outlet.value, item_group: current.value, items: names }), 'Item order saved')
    : await act(() => post('admin.save_category_order', { pos_profile: outlet.value, categories: names }), 'Category order saved')
  saving.value = false
  if (ok) dirty.value = false
}
async function create() {
  const name = newName.value.trim()
  if (!name) return
  if (await act(() => post('admin.create_category', { name }), `${name} added`)) { newName.value = ''; emit('changed'); load() }
}
function remove(name) {
  dialog.danger({ title: `Delete ${name}?`, message: 'The category is removed from ERPNext.', confirmLabel: 'Delete',
    onConfirm: async () => { if (await act(() => post('admin.delete_category', { name }), `${name} deleted`)) { emit('changed'); load() } } })
}
</script>
