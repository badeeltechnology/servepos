<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)" title="Copy menu between outlets" size="lg">
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <FormControl type="select" label="Copy from" v-model="f.source" :options="opts" />
        <FormControl type="select" label="To" v-model="f.target" :options="opts.filter((o) => o.value !== f.source)" />
      </div>
      <TabButtons v-model="f.mode" :options="[{ label: 'Add only', value: 'add' }, { label: 'Replace', value: 'replace' }]" />
      <p class="text-p-sm text-ink-gray-6">{{ f.mode === 'add' ? 'Items on the source outlet are added to the target. Nothing is taken off.' : 'The target ends up with exactly the source menu: items not on the source are taken off.' }} Only the POS menu is copied, not the online menu.</p>
      <label class="flex items-center gap-2 text-base"><Checkbox v-model="f.order" /> Copy category and item order</label>
      <label class="flex items-center gap-2 text-base"><Checkbox v-model="f.mods" /> Copy which modifier groups show</label>
      <div v-if="preview" class="rounded-6 bg-surface-gray-1 p-3 text-p-sm">
        <div>{{ preview.source_items }} items on {{ f.source }}, {{ preview.target_items_before }} on {{ f.target }} now.</div>
        <div><b class="text-ink-green-6">+{{ preview.to_add }}</b> to add<span v-if="f.mode === 'replace'">, <b class="text-ink-red-6">−{{ preview.to_remove }}</b> to take off</span>, {{ preview.target_items_after }} after.</div>
        <div v-if="preview.modifier_groups_to_change">{{ preview.modifier_groups_to_change }} modifier groups change.</div>
        <div>{{ preview.copy_order ? 'Menu order is copied.' : f.order ? 'The source has no menu order to copy.' : '' }}</div>
      </div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-end gap-2"><Button label="Cancel" @click="close" />
        <Button v-if="!preview" variant="solid" label="Preview" :disabled="!f.source || !f.target" :loading="busy" @click="run(1)" />
        <Button v-else variant="solid" :theme="f.mode === 'replace' && preview.to_remove ? 'red' : 'gray'" label="Copy now" :loading="busy" @click="run(0, close)" /></div>
    </template>
  </Dialog>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Button, Checkbox, Dialog, FormControl, TabButtons } from 'frappe-ui'
import { post, act } from '../api'
import { state } from '../state'
defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'done'])
const opts = computed(() => state.setup.profiles.map((p) => ({ label: p.name, value: p.name })))
const f = reactive({ source: '', target: state.outlet || '', mode: 'add', order: true, mods: true })
const preview = ref(null), busy = ref(false)
watch(f, () => (preview.value = null), { deep: true })
async function run(pre, close) {
  busy.value = true
  const r = await act(() => post('menu_admin.copy_outlet_menu', { source_profile: f.source, target_profile: f.target, mode: f.mode,
    copy_order: f.order ? 1 : 0, copy_modifier_groups: f.mods ? 1 : 0, preview: pre }), pre ? null : `${f.target} now has the menu of ${f.source}`)
  busy.value = false
  if (!r) return
  if (pre) preview.value = r
  else { preview.value = null; emit('done'); close() }
}
</script>
