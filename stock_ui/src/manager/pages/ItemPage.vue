<template>
  <Header :title="isNew ? 'New item' : form.item_name || name" back="/items">
    <template #status><Badge v-if="!isNew && loaded" :theme="statusTheme" :label="statusLabel" /></template>
    <span v-if="dirty" class="hidden text-p-sm text-ink-gray-5 sm:inline">Not saved</span>
    <Dropdown v-if="!isNew" :options="[{ label: 'Delete item', icon: 'lucide-trash-2', theme: 'red', onClick: remove }]" align="end"><Button icon="lucide-ellipsis" aria-label="More" /></Dropdown>
    <Button variant="solid" :label="isNew ? 'Create' : 'Save'" :disabled="!dirty || !valid" :loading="saving" @click="save" />
  </Header>

  <div v-if="!loaded" class="p-10"><LoadingText /></div>
  <div v-else class="grid grid-cols-1 gap-6 px-3 pb-16 pt-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <div class="space-y-5">
      <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormControl label="Name" v-model="form.item_name" placeholder="e.g. Chicken burger" :required="true" />
        <FormControl label="Name in Arabic" v-model="form.servepos_item_name_ar" dir="rtl" />
        <div>
          <FormControl type="select" label="Category" v-model="form.item_group" :options="groupOpts" />
          <Button variant="ghost" size="sm" class="mt-1" label="New category" icon-left="lucide-plus" @click="newCategory" />
        </div>
        <FormControl type="number" label="Price" v-model="form.standard_rate" :step="0.5" min="0" />
        <FormControl v-if="isNew" label="Item code" v-model="form.item_code" placeholder="Made from the name if empty" />
      </section>
      <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormControl type="textarea" label="Description" v-model="form.description" :rows="3" />
        <FormControl type="textarea" label="Description in Arabic" v-model="form.servepos_description_ar" :rows="3" dir="rtl" />
      </section>
      <section>
        <div class="mb-1.5 text-xs text-ink-gray-5">Photo</div>
        <div class="flex items-center gap-4">
          <img v-if="form.image" :src="form.image" class="size-28 rounded-6 border border-outline-gray-1 object-cover" alt="" />
          <div v-else class="flex size-28 items-center justify-center rounded-6 border border-dashed border-outline-gray-3 text-ink-gray-4"><span class="lucide-image size-6" /></div>
          <div class="space-y-2">
            <input ref="file" type="file" accept="image/*" class="hidden" @change="upload" />
            <Button :label="form.image ? 'Change photo' : 'Upload photo'" icon-left="lucide-upload" :loading="uploading" @click="$refs.file.click()" />
            <Button v-if="form.image" variant="ghost" label="Remove" @click="form.image = ''" />
            <p class="text-p-sm text-ink-gray-5">Shown on the POS and the online menu.</p>
          </div>
        </div>
      </section>

      <RecipeEditor id="recipe" class="scroll-mt-16" v-if="!isNew" :item="form.name" :price="Number(form.standard_rate) || 0" :stock-item="!!form.is_stock_item" />

      <section class="space-y-2">
        <div class="flex items-center justify-between"><h2 class="text-base-semibold">Modifier groups</h2>
          <Select v-model="addGroup" :options="groupChoices" placeholder="Add a group" class="w-56" /></div>
        <List :columns="['minmax(0,1fr)', '7rem', '6.5rem']" class="list-row-px-2">
          <ListRows :items="form.modifier_groups" row-key="modifier_group" v-slot="{ item: m, index: i }">
            <ListRow class="min-h-10">
              <ListCell class="truncate">{{ m.modifier_group }}</ListCell>
              <ListCell><Checkbox v-model="m.is_required" label="Required" /></ListCell>
              <ListCell class="justify-end">
                <Button variant="ghost" size="sm" icon="lucide-arrow-up" aria-label="Move up" :disabled="i === 0" @click="moveMod(i, -1)" />
                <Button variant="ghost" size="sm" icon="lucide-arrow-down" aria-label="Move down" :disabled="i === form.modifier_groups.length - 1" @click="moveMod(i, 1)" />
                <Button variant="ghost" size="sm" icon="lucide-x" aria-label="Remove" @click="form.modifier_groups.splice(i, 1)" />
              </ListCell>
            </ListRow>
          </ListRows>
        </List>
        <p v-if="!form.modifier_groups.length" class="text-p-sm text-ink-gray-5">No modifier groups. Add one to offer choices like size or extras.</p>
      </section>
    </div>

    <aside class="space-y-5 lg:border-l lg:border-outline-gray-1 lg:pl-6">
      <section class="space-y-3">
        <h2 class="text-base-semibold">Status</h2>
        <label class="flex items-start justify-between gap-3"><span><span class="text-base">Sold out</span><span class="block text-p-sm text-ink-gray-5">Hidden on every POS until it is back. Use it for today's shortages.</span></span>
          <Switch :model-value="!form.servepos_is_available" @update:model-value="(v) => (form.servepos_is_available = v ? 0 : 1)" /></label>
        <label class="flex items-start justify-between gap-3"><span><span class="text-base">Disabled</span><span class="block text-p-sm text-ink-gray-5">Taken off every POS and the online menu.</span></span>
          <Switch :model-value="!!form.servepos_is_disabled" @update:model-value="(v) => (form.servepos_is_disabled = v ? 1 : 0)" /></label>
      </section>

      <section class="space-y-2">
        <h2 class="text-base-semibold">Where it is sold</h2>
        <label class="flex items-start justify-between gap-3"><span><span class="text-base">All outlets</span><span class="block text-p-sm text-ink-gray-5">Including outlets added later.</span></span>
          <Switch v-model="form.all_outlets" /></label>
        <label v-if="form.all_outlets" class="flex items-center justify-between gap-3 text-base">Also on the online menu <Switch v-model="form.web_all" /></label>
        <List v-else :columns="['minmax(0,1fr)', '3.5rem', '3.5rem']" class="list-row-px-2">
          <ListHeader><ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell class="justify-center">POS</ListHeaderCell><ListHeaderCell class="justify-center">Online</ListHeaderCell></ListHeader>
          <ListRows :items="state.setup.profiles" row-key="name" v-slot="{ item: p }">
            <ListRow class="min-h-9">
              <ListCell class="truncate">{{ p.name }}</ListCell>
              <ListCell class="justify-center"><Checkbox v-model="cell(p.name).pos" /></ListCell>
              <ListCell class="justify-center"><Checkbox v-model="cell(p.name).web" /></ListCell>
            </ListRow>
          </ListRows>
        </List>
      </section>
    </aside>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Badge, Button, Checkbox, Dropdown, FormControl, LoadingText, Select, Switch, dialog, toast } from 'frappe-ui'
import Header from '../../components/Header.vue'
import RecipeEditor from '../components/RecipeEditor.vue'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { get, post, act } from '../api'
import { state, reloadSetup } from '../state'
import { errText } from '../../api'

const props = defineProps({ name: String })
const router = useRouter()
const isNew = computed(() => props.name === 'new')
const blank = () => ({ name: '', item_name: '', item_code: '', item_group: '', standard_rate: 0, description: '', servepos_item_name_ar: '', servepos_description_ar: '',
  image: '', servepos_is_disabled: 0, servepos_is_available: 1, modifier_groups: [], outlets: {}, all_outlets: true, web_all: false })
const form = reactive(blank())
const saved = ref(''), loaded = ref(false), saving = ref(false), uploading = ref(false), addGroup = ref('')

function cell(p) {
  if (!form.outlets[p]) form.outlets[p] = { pos: false, web: false }
  return form.outlets[p]
}
// opened from Recipes, Menu engineering or Food cost: go straight to the recipe
watch(loaded, (v) => { if (v && window.location.hash === '#recipe') nextTick(() => document.getElementById('recipe')?.scrollIntoView({ block: 'start' })) })

async function load() {
  loaded.value = false
  Object.assign(form, blank())
  if (!isNew.value) {
    const d = await get('admin.get_item', { name: props.name })
    Object.assign(form, d, { modifier_groups: d.modifier_groups.map((m) => ({ ...m, is_required: !!m.is_required })),
      all_outlets: !!d.all_outlets, web_all: d.all_outlets && Object.values(d.outlets).every((c) => c.web) })
  } else {
    form.item_group = state.setup.groups[0] || ''
  }
  for (const p of state.setup.profiles) cell(p.name)
  saved.value = JSON.stringify(form)
  loaded.value = true
}
watch(() => props.name, load, { immediate: true })

const dirty = computed(() => loaded.value && JSON.stringify(form) !== saved.value)
const valid = computed(() => form.item_name.trim() && form.item_group && Number(form.standard_rate) >= 0)
const statusLabel = computed(() => (form.servepos_is_disabled ? 'Disabled' : !form.servepos_is_available ? 'Sold out' : 'Active'))
const statusTheme = computed(() => (form.servepos_is_disabled ? 'gray' : !form.servepos_is_available ? 'amber' : 'green'))
const groupOpts = computed(() => state.setup.groups.map((g) => ({ label: g, value: g })))
const groupChoices = computed(() => state.setup.modifier_groups.filter((g) => !form.modifier_groups.some((m) => m.modifier_group === g)).map((g) => ({ label: g, value: g })))
watch(addGroup, (g) => { if (g) { form.modifier_groups.push({ modifier_group: g, is_required: false }); addGroup.value = '' } })
function moveMod(i, d) { const a = form.modifier_groups; [a[i], a[i + d]] = [a[i + d], a[i]] }

async function save() {
  saving.value = true
  const payload = { ...form, name: isNew.value ? '' : form.name, modifier_groups: form.modifier_groups.map((m) => ({ modifier_group: m.modifier_group, is_required: m.is_required ? 1 : 0 })),
    all_outlets: form.all_outlets ? 1 : 0, web_all: form.web_all ? 1 : 0 }
  const r = await act(() => post('admin.save_item', { data: payload }), isNew.value ? 'Item created' : 'Saved. The POS picks it up on their next sync.')
  saving.value = false
  if (!r) return
  if (isNew.value) router.replace({ name: 'item', params: { name: r.name } })
  else { saved.value = JSON.stringify(form) }
}
function remove() {
  dialog.danger({ title: `Delete ${form.item_name}?`, message: 'Items with sales history cannot be deleted; disable them instead.', confirmLabel: 'Delete',
    onConfirm: async () => { if (await act(() => post('admin.delete_item', { name: form.name }), 'Item deleted')) router.push('/items') } })
}
function newCategory() {
  dialog.prompt({ title: 'New category', confirmLabel: 'Create', fields: [{ name: 'name', label: 'Name', placeholder: 'e.g. Desserts', required: true }],
    onConfirm: async ({ values }) => {
      const r = await post('admin.create_category', { name: values.name })
      await reloadSetup()
      form.item_group = r.name
      toast.success(`${r.name} added`)
    } })
}
async function upload(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!f) return
  uploading.value = true
  try {
    const body = new FormData()
    body.append('file', f); body.append('is_private', '0'); body.append('folder', 'Home')
    if (!isNew.value) { body.append('doctype', 'Item'); body.append('docname', form.name) }
    const res = await fetch('/api/method/upload_file', { method: 'POST', body, headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' } })
    const j = await res.json()
    if (!res.ok) throw new Error('Upload failed')
    form.image = j.message.file_url
  } catch (err) {
    toast.error(errText(err))
  } finally {
    uploading.value = false
  }
}
</script>
