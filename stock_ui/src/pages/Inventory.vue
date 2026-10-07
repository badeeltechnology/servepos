<template>
  <Header title="Inventory" :subtitle="inv.data && inv.data.name ? inv.data.name : ''">
    <template #status><StatusBadge v-if="inv.data" :status="inv.data.status" /></template>
    <template v-if="inv.data">
      <DownloadMenu kind="count" :params="{ location_name: state.location.name, count_date: date }" :label="inv.data.status === 'Counting' ? 'Count sheet' : 'Download'" />
      <template v-if="inv.data.status === 'Counting'">
        <Dropdown :options="moreOptions" align="end"><Button icon="lucide-ellipsis" aria-label="More" /></Dropdown>
        <Button label="Save, continue later" :loading="saver.loading && !submitting" @click="save(0)" />
        <Button variant="solid" label="Submit count" :loading="saver.loading && submitting" @click="askSubmit" />
      </template>
      <Button v-else-if="inv.data.can_correct && !correcting" label="Correct this count" icon-left="lucide-pencil" @click="correcting = true" />
      <template v-else-if="correcting">
        <Button label="Cancel" @click="cancelCorrect" />
        <Button variant="solid" label="Save correction" :loading="corrector.loading" @click="correct" />
      </template>
    </template>
  </Header>
  <div class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <DatePicker v-model="date" label="Count date" :max="state.ctx.today" class="w-40" />
      <TimePicker v-model="time" label="Count time" class="w-32" :disabled="!timeEditable" />
      <TextInput v-model="q" label="Find" placeholder="Item name or code" class="w-56" />
      <TabButtons :options="['All', 'Not counted', 'Counted'].map((v) => ({ label: v, value: v }))" v-model="show" />
      <span class="flex-1" />
      <div class="space-y-1.5"><div class="text-xs text-ink-gray-5">Counted</div><div class="flex h-7 items-center rounded-4 bg-surface-gray-2 px-3 text-base num">{{ counted }} of {{ lines.length }}</div></div>
    </div>
    <Alert v-if="banner" :theme="banner.theme" :title="banner.title" :description="banner.text" />
    <input ref="fileInput" type="file" accept=".xlsx" class="hidden" @change="importFile" />
    <p v-if="savedAt && inv.data && inv.data.status === 'Counting'" class="text-xs text-ink-gray-5">Saved automatically at {{ savedAt }}</p>

    <div class="overflow-x-auto" v-if="inv.data">
      <List :columns="cols" class="card min-w-[700px] list-row-px-3">
        <ListHeader>
          <ListHeaderCell>Item</ListHeaderCell><ListHeaderCell>Provider</ListHeaderCell><ListHeaderCell class="justify-end">Counted</ListHeaderCell><ListHeaderCell>UOM</ListHeaderCell>
          <ListHeaderCell class="justify-end">{{ inv.data.show_system ? 'System' : '' }}</ListHeaderCell><ListHeaderCell class="justify-end">{{ inv.data.show_system ? 'Difference' : '' }}</ListHeaderCell>
        </ListHeader>
        <ListRow v-for="l in visible" :key="l.item_code" class="min-h-11 py-1" :class="l.is_corrected ? 'bg-surface-blue-1' : ''">
          <ListCell class="flex-col !items-start"><span class="w-full truncate text-base">{{ l.item_name }}</span><span class="text-xs text-ink-gray-4 num">{{ l.item_code }}{{ l.is_corrected ? ' · was ' + fmt(l.original) : '' }}</span></ListCell>
          <ListCell class="text-sm text-ink-gray-5">{{ l.provider }}</ListCell>
          <ListCell><TextInput class="qty w-full" type="number" min="0" step="any" inputmode="decimal" variant="outline" :model-value="l.v" @update:model-value="(v) => (l.v = v)" :disabled="!editable" :aria-label="'Counted ' + l.item_name" @keydown.enter.prevent="nextInput($event)" /></ListCell>
          <ListCell>
            <Select v-if="l.uoms.length > 1 && inv.data.status === 'Counting'" v-model="l.uom" :options="l.uoms.map((u) => ({ value: u.uom, label: u.factor === 1 ? u.uom : `${u.uom} (${fmt(u.factor)} ${l.stock_uom})` }))" class="w-full" />
            <span v-else class="px-1 text-ink-gray-6">{{ l.uom }}</span>
          </ListCell>
          <ListCell class="justify-end text-ink-gray-6 num">{{ inv.data.show_system && l.system !== undefined ? fmt(l.system) : '' }}</ListCell>
          <ListCell class="justify-end text-base-medium num" :class="diffOf(l) < 0 ? 'text-ink-red-6' : diffOf(l) > 0 ? 'text-ink-amber-6' : 'text-ink-gray-5'">{{ inv.data.show_system && diffOf(l) !== null ? (diffOf(l) > 0 ? '+' : '') + fmt(diffOf(l)) : '' }}</ListCell>
        </ListRow>
        <Empty v-if="!visible.length">No items match.</Empty>
      </List>
    </div>
    <LoadingText v-else-if="inv.loading" />
    <p class="text-p-sm text-ink-gray-5">Type what is on the shelf. Leave a line blank if you did not count it; blank lines keep their system quantity. Enter moves to the next line.</p>

    <section v-if="past.data && past.data.length" class="space-y-2 pt-4">
      <h2 class="text-lg-semibold">Past counts</h2>
      <div class="card divide-y divide-outline-gray-1">
        <button v-for="c in past.data" :key="c.name" class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-gray-1" @click="date = c.count_date">
          <span class="w-36 text-base">{{ fmtDate(c.count_date) }} {{ String(c.count_time || '').slice(0, 5) }}</span>
          <span class="flex-1 text-sm text-ink-gray-5">{{ c.reconciliation || 'not submitted' }}{{ c.correction_reconciliation ? ' · corrected ' + c.correction_reconciliation : '' }}</span>
          <StatusBadge :status="c.status" />
        </button>
      </div>
    </section>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Alert, Button, DatePicker, Dropdown, LoadingText, Select, TabButtons, TextInput, TimePicker, dialog, toast } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import Header from '../components/Header.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Empty from '../components/Empty.vue'
import DownloadMenu from '../components/DownloadMenu.vue'
import { useRead, useWrite, errText, fmt, fmtDate, blank } from '../api'
import { state } from '../state'

const nowHM = () => new Date().toTimeString().slice(0, 5)
const lines = ref([]), q = ref(''), show = ref('All'), date = ref(state.ctx.today), time = ref(nowHM()), correcting = ref(false), submitting = ref(false)
const cols = ['minmax(180px,1fr)', '6rem', '7rem', '9rem', '5rem', '6rem']
const inv = useRead('get_inventory', () => ({ location_name: state.location.name, count_date: date.value }), {
  onSuccess: (d) => {
    correcting.value = false
    lines.value = d.lines.map((l) => ({ ...l, v: l.counted ?? '' }))
    time.value = d.count_time ? d.count_time.slice(0, 5) : date.value === state.ctx.today ? nowHM() : '23:59'
  },
})
const past = useRead('list_inventory', () => ({ location_name: state.location.name }))
const saver = useWrite('save_inventory'), corrector = useWrite('correct_inventory')
const editable = computed(() => inv.data && (inv.data.status === 'Counting' || correcting.value))
const timeEditable = computed(() => inv.data && inv.data.status === 'Counting')
const counted = computed(() => lines.value.filter((l) => !blank(l.v)).length)
const visible = computed(() => {
  const t = q.value.toLowerCase()
  return lines.value.filter((l) => (!t || l.item_name.toLowerCase().includes(t) || l.item_code.toLowerCase().includes(t)) && (show.value === 'All' || (show.value === 'Counted') === !blank(l.v)))
})
const diffOf = (l) => (blank(l.v) || l.system === undefined || l.system === null ? null : Number(l.v) - l.system)
const banner = computed(() => {
  const d = inv.data
  if (!d) return null
  if (d.status === 'Counting') return { theme: 'gray', title: `Count for ${fmtDate(d.count_date)} at ${time.value}`, text: `Stock is set to what you count, as of this date and time. Counting days this month: ${d.days.join(', ')}.` }
  if (correcting.value) return { theme: 'blue', title: 'Correcting', text: 'Change only the lines that were wrong. Only changed lines are adjusted, and this can be done once.' }
  if (d.status === 'Submitted') return { theme: 'green', title: `Submitted as ${d.reconciliation}`, text: d.can_correct ? `You can correct it once within ${state.ctx.settings.correction_window_hours} hours.` : 'The correction window has passed.' }
  return { theme: 'green', title: 'Submitted and corrected', text: `${d.reconciliation}, corrected by ${d.correction}. No further changes.` }
})
function nextInput(e) {
  const all = [...document.querySelectorAll('.qty input:not(:disabled)')]
  const next = all[all.indexOf(e.target) + 1]
  if (next) { next.focus(); next.select() }
}
// --- quicker counting: paper / Excel round trip, fill the rest with 0, autosave
const fileInput = ref(null), savedAt = ref(''), dirty = ref(false)
const moreOptions = [
  { label: 'Upload filled count sheet (Excel)', icon: 'lucide-upload', onClick: () => fileInput.value && fileInput.value.click() },
  { label: 'Set uncounted lines to 0', icon: 'lucide-circle-slash', onClick: fillZero },
  { label: 'Clear all counts', icon: 'lucide-eraser', onClick: () => lines.value.forEach((l) => (l.v = '')) },
]
function fillZero() {
  const n = lines.value.filter((l) => blank(l.v)).length
  if (!n) return toast.info('Every line is already counted')
  dialog.confirm({ title: `Set ${n} uncounted line${n > 1 ? 's' : ''} to 0?`, message: 'Use this when everything you did not find on the shelf is really out of stock.', confirmLabel: 'Set to 0',
    onConfirm: () => { lines.value.forEach((l) => { if (blank(l.v)) l.v = 0 }); toast.success(`${n} lines set to 0`) } })
}
async function importFile(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!f) return
  const body = new FormData()
  body.append('file', f); body.append('location_name', state.location.name); body.append('count_date', date.value)
  try {
    const res = await fetch('/api/method/servepos.stock_orders.exports.import_counts', { method: 'POST', body, headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' } })
    const j = await res.json()
    if (!res.ok) throw new Error(JSON.parse(JSON.parse(j._server_messages || '["{}"]')[0]).message || 'Could not read the file')
    const byCode = Object.fromEntries(j.message.lines.map((l) => [l.item_code, l]))
    let n = 0
    lines.value.forEach((l) => { const x = byCode[l.item_code]; if (x) { l.v = x.counted; if (x.uom && l.uoms.some((u) => u.uom === x.uom)) l.uom = x.uom; n++ } })
    const unknown = j.message.lines.length - n
    toast.success(`${n} counts filled in from the sheet${unknown ? `, ${unknown} not on this list` : ''}. Check them and submit.`)
  } catch (err) { toast.error(errText(err)) }
}
watch(() => lines.value.map((l) => l.v + '|' + l.uom).join(), (a, b) => { if (b !== undefined && inv.data && inv.data.status === 'Counting') dirty.value = true })
const timer = setInterval(async () => {
  if (!dirty.value || saver.loading || !inv.data || inv.data.status !== 'Counting' || !counted.value) return
  dirty.value = false
  try {
    await saver.submit({ location_name: state.location.name, count_date: date.value, count_time: time.value, submit: 0,
      lines: lines.value.map((l) => ({ item_code: l.item_code, uom: l.uom, counted: blank(l.v) ? null : Number(l.v) })) })
    savedAt.value = new Date().toTimeString().slice(0, 5)
  } catch (e) { dirty.value = true }
}, 45000)
onBeforeUnmount(() => clearInterval(timer))
function cancelCorrect() { lines.value.forEach((l) => (l.v = l.counted ?? '')); correcting.value = false }
function askSubmit() {
  if (!counted.value) return toast.warning('Count at least one item')
  const left = lines.value.length - counted.value
  dialog.confirm({
    title: 'Submit the count?',
    message: (left ? `${left} item${left > 1 ? 's are' : ' is'} not counted and keep the system quantity. ` : '') + `Stock will be set to what you counted as of ${fmtDate(date.value)} ${time.value}.`,
    confirmLabel: 'Submit',
    onConfirm: () => save(1),
  })
}
async function save(submit) {
  submitting.value = !!submit
  try {
    const r = await saver.submit({ location_name: state.location.name, count_date: date.value, count_time: time.value, submit,
      lines: lines.value.map((l) => ({ item_code: l.item_code, uom: l.uom, counted: blank(l.v) ? null : Number(l.v) })) })
    toast.success(submit ? `${r.name} submitted (${r.reconciliation})` : 'Saved. You can continue later.')
    inv.reload(); past.reload()
  } catch (e) { toast.error(errText(e)) }
}
async function correct() {
  try {
    const r = await corrector.submit({ name: inv.data.name, lines: lines.value.filter((l) => !blank(l.v)).map((l) => ({ item_code: l.item_code, counted: Number(l.v) })) })
    toast.success(`Corrected ${r.changed} line${r.changed > 1 ? 's' : ''} (${r.correction})`)
    inv.reload(); past.reload()
  } catch (e) { toast.error(errText(e)) }
}
</script>
