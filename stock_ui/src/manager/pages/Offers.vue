<template>
  <Header title="Promos and vouchers">
    <template v-if="tab === 'promos'"><Button variant="solid" label="Add promo" icon-left="lucide-plus" @click="editPromo(null)" /></template>
    <template v-else>
      <Button label="Make many codes" icon-left="lucide-layers" @click="openBatch" />
      <Button variant="solid" label="Add voucher" icon-left="lucide-plus" @click="editVoucher(null)" />
    </template>
  </Header>
  <div class="space-y-3 px-3 pb-16 pt-4 sm:px-5">
    <TabButtons v-model="tab" :options="[{ label: 'Promos', value: 'promos' }, { label: 'Vouchers', value: 'vouchers' }]" />

    <template v-if="tab === 'promos'">
      <p class="text-p-sm text-ink-gray-6">A promo is a discount the cashier picks on the POS, such as a staff or partner discount.</p>
      <div class="overflow-x-auto">
        <List :columns="['minmax(160px,1fr)', '7rem', '10rem', 'minmax(140px,1fr)', '5rem']" class="-mx-3 min-w-[680px] list-row-px-3">
          <ListHeader><ListHeaderCell>Promo</ListHeaderCell><ListHeaderCell>Discount</ListHeaderCell><ListHeaderCell>Outlets</ListHeaderCell><ListHeaderCell>Note</ListHeaderCell><ListHeaderCell>On</ListHeaderCell></ListHeader>
          <ListRows :items="promos.data || []" v-slot="{ item }">
            <ListRow class="relative min-h-11">
              <button class="absolute inset-0" :aria-label="'Open ' + item.promo_name" @click="editPromo(item)" />
              <ListCell class="text-base-medium" :class="item.enabled ? '' : 'text-ink-gray-5'">{{ item.promo_name }}</ListCell>
              <ListCell><Badge theme="green" :label="item.discount_type === 'Percentage' ? `${fmt(item.discount_value)} %` : `${cur} ${fmt(item.discount_value)}`" /></ListCell>
              <ListCell class="text-sm text-ink-gray-6">{{ item.outlets.length ? (item.outlets.length === 1 ? item.outlets[0] : `${item.outlets.length} outlets`) : 'All outlets' }}</ListCell>
              <ListCell class="truncate text-sm text-ink-gray-6">{{ item.description }}</ListCell>
              <ListCell><Switch class="relative" :model-value="!!item.enabled" @update:model-value="(v) => togglePromo(item, v)" /></ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>
      <div v-if="promos.data && !promos.data.length" class="py-12 text-center text-p-sm text-ink-gray-5">No promos yet. Examples: Staff 20 %, Partner 10 %.</div>
    </template>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <TextInput v-model="vq" placeholder="Search code" class="w-48" :debounce="250"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
        <TabButtons v-model="vstate" :options="['Active', 'Used up', 'Expired', 'Off', 'All'].map((s) => ({ label: s, value: s }))" />
      </div>
      <p class="text-p-sm text-ink-gray-6">A voucher is a 6-digit code the guest gives at the POS for a percentage off.</p>
      <div class="overflow-x-auto">
        <List :columns="['8rem', '6rem', '6rem', '7rem', '8rem', '10rem', 'minmax(120px,1fr)']" class="-mx-3 min-w-[760px] list-row-px-3">
          <ListHeader><ListHeaderCell>Code</ListHeaderCell><ListHeaderCell>Status</ListHeaderCell><ListHeaderCell>Discount</ListHeaderCell><ListHeaderCell>Used</ListHeaderCell><ListHeaderCell>Expires</ListHeaderCell><ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell>Note</ListHeaderCell></ListHeader>
          <ListRows :items="vrows" v-slot="{ item }">
            <ListRow class="relative min-h-11">
              <button class="absolute inset-0" :aria-label="'Open ' + item.code" @click="editVoucher(item)" />
              <ListCell class="font-mono text-base-medium tracking-wider">{{ item.code }}</ListCell>
              <ListCell><Badge :theme="{ Active: 'green', 'Used up': 'gray', Expired: 'amber', Off: 'gray' }[item.state]" :label="item.state" /></ListCell>
              <ListCell class="num">{{ fmt(item.discount_percent) }} %</ListCell>
              <ListCell class="num">{{ item.times_used }} / {{ item.max_uses || '∞' }}</ListCell>
              <ListCell class="text-sm">{{ fmtDate(item.expires_on) }}</ListCell>
              <ListCell class="text-sm text-ink-gray-6">{{ item.pos_profile || 'All outlets' }}</ListCell>
              <ListCell class="truncate text-sm text-ink-gray-6">{{ item.description }}</ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>
      <div v-if="vouchers.data && !vrows.length" class="py-12 text-center text-p-sm text-ink-gray-5">No vouchers here.</div>
    </template>
  </div>

  <Dialog v-model:open="pd.open" :title="pd.f.name || 'New promo'" size="lg">
    <div class="space-y-3">
      <FormControl label="Name" v-model="pd.f.promo_name" placeholder="e.g. Staff" />
      <div class="grid grid-cols-2 gap-3">
        <FormControl type="select" label="Type" v-model="pd.f.discount_type" :options="[{ label: 'Percentage', value: 'Percentage' }, { label: 'Fixed amount', value: 'Amount' }]" />
        <FormControl type="number" :label="pd.f.discount_type === 'Percentage' ? 'Discount %' : `Discount (${cur})`" v-model="pd.f.discount_value" min="0" />
      </div>
      <FormControl label="Note" v-model="pd.f.description" />
      <label class="flex items-center justify-between text-base">On <Switch v-model="pd.f.enabled" /></label>
      <label class="flex items-center justify-between"><span class="text-base-semibold">Outlets</span><span class="flex items-center gap-2 text-sm text-ink-gray-6">All outlets <Switch v-model="pd.all" /></span></label>
      <OutletPicker v-if="!pd.all" v-model="pd.f.outlets" :profiles="state.setup.profiles" />
    </div>
    <template #actions="{ close }">
      <div class="flex justify-between gap-2"><Button v-if="pd.f.name" variant="ghost" theme="red" label="Delete" @click="removePromo(close)" /><span v-else />
        <div class="flex gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Save" :loading="busy" @click="savePromo(close)" /></div></div>
    </template>
  </Dialog>

  <Dialog v-model:open="vd.open" :title="vd.f.name ? `Voucher ${vd.f.code}` : 'New voucher'" size="lg">
    <div class="space-y-3">
      <FormControl v-if="!vd.f.name" label="Code" v-model="vd.f.code" placeholder="Leave empty to generate" maxlength="6" inputmode="numeric" />
      <div class="grid grid-cols-2 gap-3">
        <FormControl type="number" label="Discount %" v-model="vd.f.discount_percent" min="1" max="100" />
        <FormControl type="number" label="Times it can be used" v-model="vd.f.max_uses" min="0" description="0 = unlimited" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <FormControl type="date" label="Expires on" v-model="vd.f.expires_on" />
        <FormControl type="select" label="Outlet" v-model="vd.f.pos_profile" :options="outletOptions('All outlets')" />
      </div>
      <FormControl label="Note" v-model="vd.f.description" placeholder="e.g. Birthday guest" />
      <label v-if="vd.f.name" class="flex items-center justify-between text-base">On <Switch v-model="vd.f.is_active" /></label>
      <p v-if="vd.f.name" class="text-p-sm text-ink-gray-5">Used {{ vd.f.times_used }} times.</p>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-between gap-2"><Button v-if="vd.f.name && !vd.f.times_used" variant="ghost" theme="red" label="Delete" @click="removeVoucher(close)" /><span v-else />
        <div class="flex gap-2"><Button label="Cancel" @click="close" /><Button variant="solid" label="Save" :disabled="!vd.f.expires_on" :loading="busy" @click="saveVoucher(close)" /></div></div>
    </template>
  </Dialog>

  <Dialog v-model:open="bd.open" title="Make many voucher codes" size="lg">
    <div v-if="!bd.codes.length" class="space-y-3">
      <div class="grid grid-cols-3 gap-3">
        <FormControl type="number" label="How many codes" v-model="bd.f.count" min="1" max="500" />
        <FormControl type="number" label="Discount %" v-model="bd.f.discount_percent" />
        <FormControl type="number" label="Uses per code" v-model="bd.f.max_uses" description="0 = unlimited" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <FormControl type="date" label="Expires on" v-model="bd.f.expires_on" />
        <FormControl type="select" label="Outlet" v-model="bd.f.pos_profile" :options="outletOptions('All outlets')" />
      </div>
      <FormControl label="Note" v-model="bd.f.description" placeholder="e.g. Ramadan campaign" />
    </div>
    <div v-else class="space-y-2">
      <p class="text-p-sm text-ink-gray-6">{{ bd.codes.length }} codes made. Download them to share or print.</p>
      <div class="max-h-60 overflow-y-auto rounded-6 bg-surface-gray-1 p-3 font-mono text-base">{{ bd.codes.join('  ') }}</div>
    </div>
    <template #actions="{ close }">
      <div class="flex justify-end gap-2">
        <template v-if="!bd.codes.length"><Button label="Cancel" @click="close" /><Button variant="solid" :label="`Make ${bd.f.count} codes`" :disabled="!bd.f.expires_on" :loading="busy" @click="makeBatch" /></template>
        <template v-else><Button label="Download CSV" icon-left="lucide-download" @click="downloadCodes" /><Button variant="solid" label="Done" @click="close" /></template>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { Badge, Button, Dialog, FormControl, Switch, TabButtons, TextInput, dialog } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import OutletPicker from '../components/OutletPicker.vue'
import { useRead, post, act, shiftDate } from '../api'
import { fmtDate } from '../../api'
import { state, outletOptions } from '../state'

const tab = ref('promos'), busy = ref(false), cur = state.ctx.currency || ''
const fmt = (v) => Number(v || 0).toLocaleString('en', { maximumFractionDigits: 2 })
const promos = useRead('admin.list_promos', {})
const vq = ref(''), vstate = ref('Active')
const vouchers = useRead('admin.list_vouchers', () => ({ search: vq.value || null }))
const vrows = computed(() => (vouchers.data || []).filter((v) => vstate.value === 'All' || v.state === vstate.value))

const pd = reactive({ open: false, all: true, f: {} })
function editPromo(p) {
  pd.f = p ? { name: p.name, promo_name: p.promo_name, discount_type: p.discount_type, discount_value: p.discount_value, description: p.description || '', enabled: !!p.enabled, outlets: [...p.outlets] }
    : { name: '', promo_name: '', discount_type: 'Percentage', discount_value: 10, description: '', enabled: true, outlets: [] }
  pd.all = !pd.f.outlets.length
  pd.open = true
}
async function savePromo(close) {
  busy.value = true
  const ok = await act(() => post('admin.save_promo', { data: { ...pd.f, enabled: pd.f.enabled ? 1 : 0, outlets: pd.all ? [] : pd.f.outlets } }), 'Promo saved')
  busy.value = false
  if (ok) { close(); promos.reload() }
}
async function togglePromo(p, v) {
  p.enabled = v ? 1 : 0
  if (!(await act(() => post('admin.save_promo', { data: { name: p.name, promo_name: p.promo_name, discount_type: p.discount_type, discount_value: p.discount_value, description: p.description, outlets: p.outlets, enabled: p.enabled } }), v ? 'Promo on' : 'Promo off'))) p.enabled = v ? 0 : 1
}
function removePromo(close) {
  dialog.danger({ title: `Delete ${pd.f.name}?`, confirmLabel: 'Delete', onConfirm: async () => { await post('admin.delete_promo', { name: pd.f.name }); close(); promos.reload() } })
}

const vd = reactive({ open: false, f: {} })
const inMonths = (n) => shiftDate(state.ctx.today, 30 * n)
function editVoucher(v) {
  vd.f = v ? { ...v, is_active: !!v.is_active, pos_profile: v.pos_profile || '' }
    : { name: '', code: '', discount_percent: 10, max_uses: 1, expires_on: inMonths(3), pos_profile: '', description: '', is_active: true }
  vd.open = true
}
async function saveVoucher(close) {
  busy.value = true
  const r = await act(() => post('admin.save_voucher', { data: { ...vd.f, is_active: vd.f.is_active ? 1 : 0 } }), (r) => `Voucher ${r.code} saved`)
  busy.value = false
  if (r) { close(); vouchers.reload() }
}
function removeVoucher(close) {
  dialog.danger({ title: `Delete voucher ${vd.f.code}?`, confirmLabel: 'Delete', onConfirm: async () => { await post('admin.delete_voucher', { name: vd.f.name }); close(); vouchers.reload() } })
}

const bd = reactive({ open: false, codes: [], f: {} })
function openBatch() { Object.assign(bd, { open: true, codes: [], f: { count: 20, discount_percent: 10, max_uses: 1, expires_on: inMonths(3), pos_profile: '', description: '' } }) }
async function makeBatch() {
  busy.value = true
  const r = await act(() => post('admin.generate_vouchers', { data: bd.f }), (r) => `${r.codes.length} codes made`)
  busy.value = false
  if (r) { bd.codes = r.codes; vouchers.reload() }
}
function downloadCodes() {
  const csv = 'code,discount_percent,uses,expires_on\n' + bd.codes.map((c) => `${c},${bd.f.discount_percent},${bd.f.max_uses || 'unlimited'},${bd.f.expires_on}`).join('\n')
  const a = document.createElement('a')
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
  a.download = `Vouchers ${bd.f.expires_on}.csv`
  a.click()
}
</script>
