<template>
  <section class="space-y-3">
    <div>
      <h2 class="text-base-semibold">Arabic translation</h2>
      <p class="text-p-sm text-ink-gray-6">For the Translate buttons next to Arabic names and descriptions on menu items. Claude and OpenAI write names the way Gulf menus do (Flat White: فلات وايت); Google Translate translates the meaning (أبيض مسطح).</p>
    </div>
    <div v-if="!s.data" class="py-2"><LoadingText /></div>
    <template v-else>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormControl type="select" label="Translate with" v-model="f.provider" :options="[{ label: 'Not set up', value: '' }, ...s.data.providers.map((p) => ({ label: p, value: p }))]" />
        <FormControl v-if="f.provider && f.provider !== 'Google Translate'" label="Model" v-model="f.model" :placeholder="s.data.default_model[f.provider]"
          :description="`Empty uses ${s.data.default_model[f.provider]}.`" />
        <FormControl v-if="f.provider" type="password" class="sm:col-span-2" :label="s.data.has_key ? 'API key (saved; type a new one to replace it)' : 'API key'" v-model="f.api_key"
          :placeholder="s.data.has_key ? '••••••••••••' : 'Paste the API key'" autocomplete="off" />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="solid" label="Save" :loading="saving" :disabled="!dirty" @click="save" />
        <Badge v-if="s.data.provider" :theme="s.data.has_key ? 'green' : 'orange'" :label="s.data.has_key ? `Using ${s.data.provider}` : 'API key missing'" />
        <Badge v-else theme="gray" label="Not set up" />
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Badge, Button, FormControl, LoadingText } from 'frappe-ui'
import { useRead, post, act } from '../api'

const s = useRead('servepos.api.translate.get_settings', {})
const f = reactive({ provider: '', model: '', api_key: '' })
const saving = ref(false)
watch(() => s.data, (d) => { if (d) Object.assign(f, { provider: d.provider, model: d.model, api_key: '' }) }, { immediate: true })
const dirty = computed(() => s.data && (f.provider !== s.data.provider || f.model !== s.data.model || !!f.api_key))
async function save() {
  saving.value = true
  const r = await act(() => post('servepos.api.translate.save_settings', { provider: f.provider, model: f.model, api_key: f.api_key || null }), 'Translation settings saved')
  saving.value = false
  if (r) s.reload()
}
</script>
