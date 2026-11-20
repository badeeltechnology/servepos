<template>
  <Header title="Settings" />
  <div class="max-w-3xl space-y-6 px-3 pb-16 pt-4 sm:px-5">
    <section class="space-y-2">
      <h2 class="text-base-semibold">More settings in ERPNext</h2>
      <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
        <a v-for="l in links" :key="l.href" :href="l.href" target="_blank" class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-gray-1">
          <span :class="l.icon" class="size-4 text-ink-gray-5" />
          <span class="flex-1"><span class="block text-base">{{ l.label }}</span><span class="block text-p-sm text-ink-gray-5">{{ l.text }}</span></span>
          <span class="lucide-external-link size-4 text-ink-gray-4" />
        </a>
      </div>
    </section>

    <section v-if="state.setup.is_system_manager" class="space-y-3">
      <div><h2 class="text-base-semibold">Push notifications</h2>
        <p class="text-p-sm text-ink-gray-6">Lets the waiter app ring when a guest calls a waiter. It uses a Firebase service account key.</p></div>
      <div v-if="!fcm.data" class="py-2"><LoadingText /></div>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <Badge :theme="fcm.data.configured ? 'green' : 'gray'" :label="fcm.data.configured ? `Set up: ${fcm.data.project_id}` : 'Not set up'" />
          <Badge v-if="!fcm.data.google_auth_installed" theme="red" label="google-auth package missing on the server" />
        </div>
        <div v-if="fcm.data.configured" class="flex flex-wrap gap-2">
          <Button label="Send a test" :loading="testing" @click="test" />
          <Button variant="ghost" theme="red" label="Remove key" @click="remove" />
          <span v-if="testResult" class="text-p-sm" :class="testResult.ok ? 'text-ink-green-6' : 'text-ink-red-6'">{{ testResult.text }}</span>
        </div>
        <div class="space-y-2">
          <FormControl type="textarea" :label="fcm.data.configured ? 'Replace the key' : 'Paste the service account JSON'" v-model="json" :rows="5" placeholder='{"type": "service_account", ...}' />
          <Button variant="solid" label="Save key" :disabled="!json.trim()" :loading="saving" @click="save" />
        </div>
      </template>
    </section>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { Badge, Button, FormControl, LoadingText, dialog } from 'frappe-ui'
import Header from '../../components/Header.vue'
import { useRead, post, act } from '../api'
import { state } from '../state'

const links = [
  { href: '/app/pos-profile', icon: 'lucide-store', label: 'Outlets (POS Profiles)', text: 'Payment methods, price list, taxes, guest ordering, waiter app mode' },
  { href: '/app/servepos-void-reason', icon: 'lucide-ban', label: 'Void reasons', text: 'Reasons the cashier picks when removing an item' },
  { href: '/app/servepos-kitchen-station', icon: 'lucide-chef-hat', label: 'Kitchen stations', text: 'Where kitchen tickets print, by category' },
  { href: '/app/servepos-mobile-settings', icon: 'lucide-smartphone', label: 'Waiter app', text: 'Login length, ordering hours, old app switch' },
  { href: '/app/servepos-stock-settings', icon: 'lucide-package', label: 'Stock orders', text: 'Order cut-off times, counting days, markup' },
]
const fcm = useRead('settings.get_fcm_status', {}, { immediate: !!state.setup.is_system_manager })
const json = ref(''), saving = ref(false), testing = ref(false), testResult = ref(null)
async function save() {
  saving.value = true
  const ok = await act(() => post('settings.save_fcm_credentials', { credentials_json: json.value }), 'Key saved')
  saving.value = false
  if (ok) { json.value = ''; fcm.reload() }
}
async function test() {
  testing.value = true
  try {
    const r = await post('settings.test_fcm_connection', {})
    testResult.value = r && r.success ? { ok: true, text: `Connected to ${r.project_id}` } : { ok: false, text: (r && r.error) || 'Could not connect' }
  } catch (e) {
    testResult.value = { ok: false, text: e.message }
  } finally { testing.value = false }
}
function remove() {
  dialog.danger({ title: 'Remove the push key?', message: 'The waiter app stops ringing for guest calls until a new key is saved.', confirmLabel: 'Remove',
    onConfirm: async () => { await post('settings.remove_fcm_credentials', {}); fcm.reload() } })
}
</script>
