<template>
  <div v-if="!form" class="py-4"><LoadingText /></div>
  <div v-else class="space-y-6">
    <section v-for="sec in form" :key="sec.label" class="space-y-3">
      <h2 class="text-base-semibold">{{ sec.label }}</h2>
      <div class="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <template v-for="f in sec.fields" :key="f.fieldname">
          <div v-if="f.fieldtype === 'Check'" class="flex items-start justify-between gap-3 sm:col-span-2">
            <div><div class="text-base">{{ f.label }}</div><div v-if="f.description" class="text-p-sm text-ink-gray-5">{{ f.description }}</div></div>
            <Switch :model-value="!!vals[f.fieldname]" @update:model-value="(v) => (vals[f.fieldname] = v ? 1 : 0)" />
          </div>
          <FormControl v-else-if="f.fieldtype === 'Select' || f.fieldtype === 'Link'" type="select" :label="f.label" :description="f.description"
            :options="f.options.map((o) => ({ label: o || (f.fieldtype === 'Link' ? 'Not set' : ''), value: o }))" v-model="vals[f.fieldname]" />
          <FormControl v-else-if="f.fieldname === 'day_start_hour'" type="select" :label="f.label" :description="f.description"
            :options="hours" :model-value="Number(vals[f.fieldname] || 0)" @update:model-value="(v) => (vals[f.fieldname] = Number(v))" />
          <FormControl v-else :type="f.fieldtype === 'Time' ? 'time' : f.fieldtype === 'Data' ? 'text' : 'number'" :label="f.label" :description="f.description" v-model="vals[f.fieldname]" />
        </template>
      </div>
    </section>
    <div class="flex items-center gap-3">
      <Button variant="solid" label="Save stock settings" :disabled="!dirty" :loading="saving" @click="save" />
      <a href="/app/servepos-stock-settings" target="_blank" class="text-p-sm text-ink-gray-5 underline">Landing page and access per role (desk)</a>
    </div>
  </div>
</template>
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Button, FormControl, LoadingText, Switch } from 'frappe-ui'
import { get, post, act } from '../api'

// the business day start as a time, 00:00 to 23:00
const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0') + ':00', value: h }))
const form = ref(null), saving = ref(false)
const vals = reactive({}), orig = reactive({})
function fill(f) {
  form.value = f
  for (const s of f) for (const x of s.fields) { vals[x.fieldname] = x.value ?? ''; orig[x.fieldname] = x.value ?? '' }
}
const changed = () => Object.keys(vals).filter((k) => String(vals[k] ?? '') !== String(orig[k] ?? ''))
const dirty = computed(() => changed().length > 0)
onMounted(async () => fill(await get('admin.get_stock_settings')))
async function save() {
  saving.value = true
  const out = {}
  for (const k of changed()) out[k] = vals[k]
  const r = await act(() => post('admin.save_stock_settings', { values: out }), 'Stock settings saved')
  saving.value = false
  if (r && r !== true) fill(r)
}
</script>
