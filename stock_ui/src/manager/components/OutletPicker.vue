<template>
  <div class="rounded-6 border border-outline-gray-2">
    <div class="flex items-center justify-between border-b border-outline-gray-1 px-3 py-2">
      <span class="text-sm text-ink-gray-6">{{ picked }} of {{ profiles.length }} outlets</span>
      <Button variant="ghost" size="sm" :label="allOn ? 'Clear' : 'Select all'" @click="$emit('update:modelValue', allOn ? [] : profiles.map((p) => p.name))" />
    </div>
    <div class="max-h-64 overflow-y-auto p-1">
      <label v-for="p in profiles" :key="p.name" class="flex cursor-pointer items-center gap-2 rounded-4 px-2 py-1.5 hover:bg-surface-gray-2">
        <Checkbox :model-value="modelValue.includes(p.name)" @update:model-value="(v) => toggle(p.name, v)" />
        <span class="text-base">{{ p.name }}</span>
        <span v-if="p.branch && p.branch !== p.name" class="ml-auto text-xs text-ink-gray-5">{{ p.branch }}</span>
      </label>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { Button, Checkbox } from 'frappe-ui'
const props = defineProps({ modelValue: { type: Array, default: () => [] }, profiles: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const picked = computed(() => props.profiles.filter((p) => props.modelValue.includes(p.name)).length)
const allOn = computed(() => props.profiles.length && picked.value === props.profiles.length)
function toggle(name, on) {
  const s = new Set(props.modelValue)
  on ? s.add(name) : s.delete(name)
  emit('update:modelValue', props.profiles.map((p) => p.name).filter((n) => s.has(n)))
}
</script>
