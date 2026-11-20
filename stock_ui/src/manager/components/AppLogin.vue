<template>
  <div class="space-y-3 rounded-6 border border-outline-gray-2 p-3">
    <div class="flex items-center justify-between"><span class="text-base-semibold">Waiter app login</span>
      <Badge v-if="st" :theme="!st.has_login ? 'gray' : st.user_enabled ? 'green' : 'red'" :label="!st.has_login ? 'No login' : st.user_enabled ? 'Active' : 'Disabled'" /></div>
    <div v-if="!st" class="py-2"><LoadingText /></div>

    <div v-else-if="creds" class="space-y-2 rounded-6 bg-surface-green-1 p-3">
      <div class="text-p-sm text-ink-gray-8">Give these to the waiter. The password is shown only now.</div>
      <div class="grid grid-cols-[6rem_1fr] gap-1 text-base"><span class="text-ink-gray-5">Server</span><span class="break-all">{{ creds.server }}</span><span class="text-ink-gray-5">Username</span><span class="font-mono">{{ creds.username }}</span><span class="text-ink-gray-5">Password</span><span class="font-mono">{{ creds.password }}</span></div>
      <div class="flex gap-2"><Button size="sm" label="Copy" icon-left="lucide-copy" @click="copy" /><Button size="sm" variant="ghost" label="Done" @click="creds = null" /></div>
    </div>

    <template v-else-if="!st.has_login">
      <p class="text-p-sm text-ink-gray-6">A login lets this waiter sign in to the waiter app on their phone.</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <FormControl label="Username" v-model="f.username" />
        <FormControl label="Password" v-model="f.password"><template #suffix><Button size="sm" variant="ghost" icon="lucide-refresh-cw" aria-label="New password" @click="f.password = genPassword()" /></template></FormControl>
      </div>
      <Button variant="solid" label="Create login" :loading="busy" :disabled="!/^[a-z0-9._-]{3,30}$/.test(f.username) || f.password.length < 6" @click="create" />
    </template>

    <template v-else>
      <div class="grid grid-cols-[6rem_1fr] gap-1 text-base">
        <span class="text-ink-gray-5">Username</span><span class="font-mono">{{ st.username }}</span>
        <span class="text-ink-gray-5">Last login</span><span>{{ st.last_login ? fmtTime(st.last_login) : 'Never' }}</span>
        <span class="text-ink-gray-5">Phones</span><span>{{ st.devices.length ? st.devices.map((d) => d.device_name || d.platform).join(', ') : 'None signed in' }}</span>
      </div>
      <p v-if="!st.has_role" class="text-p-sm text-ink-red-6">This user is missing the ServePOS Waiter role.</p>
      <div v-if="reset.open" class="space-y-2 rounded-6 bg-surface-gray-1 p-2">
        <FormControl label="New password" v-model="reset.password" />
        <label class="flex items-center gap-2 text-base"><Checkbox v-model="reset.signOut" /> Sign out all phones now</label>
        <div class="flex gap-2"><Button size="sm" variant="solid" label="Set password" :disabled="reset.password.length < 6" :loading="busy" @click="doReset" /><Button size="sm" label="Cancel" @click="reset.open = false" /></div>
      </div>
      <div v-else class="flex flex-wrap gap-2">
        <Button size="sm" label="Reset password" @click="Object.assign(reset, { open: true, password: genPassword(), signOut: true })" />
        <Button size="sm" label="Sign out phones" :disabled="!st.devices.length" @click="run('revoke_app_devices', {}, 'Phones signed out')" />
        <Button size="sm" :label="st.user_enabled ? 'Disable' : 'Enable'" @click="run('set_app_login_enabled', { enabled: st.user_enabled ? 0 : 1 }, st.user_enabled ? 'Login disabled' : 'Login enabled')" />
        <Button size="sm" variant="ghost" theme="red" label="Remove login" @click="confirmRemove" />
      </div>
    </template>
  </div>
</template>
<script setup>
import { reactive, ref, watch } from 'vue'
import { Badge, Button, Checkbox, FormControl, LoadingText, dialog, toast } from 'frappe-ui'
import { get, post, act } from '../api'
import { fmtTime } from '../../api'

const props = defineProps({ waiter: String, waiterName: String })
const emit = defineEmits(['changed'])
const st = ref(null), busy = ref(false), creds = ref(null)
const f = reactive({ username: '', password: '' })
const reset = reactive({ open: false, password: '', signOut: true })

function slug(s) {
  let u = (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').replace(/([._-])\1+/g, '$1').replace(/^[._-]+|[._-]+$/g, '').slice(0, 30)
  if (!u) u = 'waiter'
  return u.length < 3 ? u + '.waiter' : u
}
function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789', a = new Uint32Array(8)
  crypto.getRandomValues(a)
  let p = Array.from(a, (n) => chars[n % chars.length]).join('')
  if (!/\d/.test(p)) p = p.slice(0, 7) + '7'
  return p
}
async function load() {
  st.value = null
  st.value = await get('mobile.admin.app_login_status', { waiter: props.waiter })
  if (!st.value.has_login) Object.assign(f, { username: slug(props.waiterName), password: genPassword() })
}
watch(() => props.waiter, load, { immediate: true })
const server = (r) => (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && r && r.site_url ? r.site_url : location.origin

async function create() {
  busy.value = true
  const r = await act(() => post('mobile.admin.create_app_login', { waiter: props.waiter, username: f.username, password: f.password }), 'Login created')
  busy.value = false
  if (r) { creds.value = { server: server(r), username: f.username, password: f.password }; await load(); emit('changed') }
}
async function doReset() {
  busy.value = true
  const pw = reset.password
  const r = await act(() => post('mobile.admin.reset_app_password', { waiter: props.waiter, password: pw, sign_out_devices: reset.signOut ? 1 : 0 }), 'Password changed')
  busy.value = false
  if (r) { reset.open = false; creds.value = { server: server(r), username: st.value.username, password: pw }; await load() }
}
async function run(method, args, msg) {
  if (await act(() => post('mobile.admin.' + method, { waiter: props.waiter, ...args }), msg)) { await load(); emit('changed') }
}
function confirmRemove() {
  dialog.danger({ title: 'Remove the app login?', message: 'The waiter is signed out and can no longer use the app. The user is kept for the records.', confirmLabel: 'Remove',
    onConfirm: async () => { await post('mobile.admin.remove_app_login', { waiter: props.waiter }); await load(); emit('changed') } })
}
async function copy() {
  const text = `Server: ${creds.value.server}\nUsername: ${creds.value.username}\nPassword: ${creds.value.password}`
  try { await navigator.clipboard.writeText(text) } catch (e) {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
  }
  toast.success('Copied')
}
</script>
