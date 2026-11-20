<template>
  <section class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div><h2 class="text-base-semibold">Recipe</h2>
        <p class="text-p-sm text-ink-gray-5">What one portion uses. Ingredients leave stock once a day at day close.</p></div>
      <div class="flex items-center gap-2">
        <Button v-if="r.bom" variant="ghost" size="sm" label="Remove recipe" @click="remove" />
        <Button variant="solid" size="sm" label="Save recipe" :disabled="!dirty || !lines.length" :loading="saving" @click="save" />
      </div>
    </div>
    <Alert v-if="stockItem" theme="gray" title="Kept in stock" description="This item is kept in stock, so each sale takes it out of stock directly. Recipes are for menu items that are made from ingredients." />
    <template v-else>
      <div class="overflow-x-auto">
        <List :columns="['minmax(10rem,1fr)', '6rem', '7rem', '5rem', '6rem', '2.5rem']" class="min-w-[620px] list-row-px-2">
          <ListHeader>
            <ListHeaderCell>Ingredient</ListHeaderCell><ListHeaderCell>Amount</ListHeaderCell><ListHeaderCell>Unit</ListHeaderCell>
            <ListHeaderCell title="Usable share after trimming and cooking">Yield %</ListHeaderCell><ListHeaderCell class="justify-end">Cost</ListHeaderCell><ListHeaderCell />
          </ListHeader>
          <ListRows :items="lines" row-key="item_code" v-slot="{ item: l, index: i }">
            <ListRow class="min-h-11">
              <ListCell class="min-w-0 gap-2"><span class="truncate">{{ l.item_name }}</span><Badge v-if="l.is_recipe" theme="blue" label="prep recipe" /></ListCell>
              <ListCell><TextInput type="number" v-model="l.qty" min="0" step="any" class="w-full" /></ListCell>
              <ListCell><Select v-model="l.uom" :options="l.uoms.map((u) => ({ label: u.uom, value: u.uom }))" class="w-full" /></ListCell>
              <ListCell><TextInput type="number" v-model="l.yield_percent" min="1" max="100" class="w-full" /></ListCell>
              <ListCell class="justify-end num">{{ money(lineCost(l)) }}</ListCell>
              <ListCell class="justify-end"><Button variant="ghost" size="sm" icon="lucide-x" aria-label="Remove" @click="lines.splice(i, 1)" /></ListCell>
            </ListRow>
          </ListRows>
        </List>
        <p v-if="!lines.length && !loading" class="py-3 text-p-sm text-ink-gray-5">No recipe yet. Add the ingredients one portion uses.</p>
        <div v-if="loading" class="py-3"><LoadingText /></div>
      </div>
      <Combobox class="w-full" :model-value="null" v-model:query="q" :options="foundOptions" :filterable="false" :loading="searching"
        placeholder="Add an ingredient: type its name" empty-text="Type two letters or more to search stock items and prep recipes"
        @update:model-value="pick" @update:open="(o) => o && (q = '')">
        <template #prefix><span class="lucide-plus size-4 text-ink-gray-5" /></template>
        <template #item-suffix="{ item: option }">
          <Badge v-if="option.is_recipe" theme="blue" label="prep recipe" />
          <span class="text-xs text-ink-gray-5">{{ money(option.unit_cost) }} / {{ option.stock_uom }}</span>
        </template>
      </Combobox>
      <div v-if="lines.length" class="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
        <span>Cost per portion <b class="num">{{ cur }} {{ money(total) }}</b></span>
        <span v-if="price">Food cost <Badge :theme="pct > 35 ? 'red' : pct > 30 ? 'orange' : 'green'" :label="pct.toFixed(1) + ' %'" /> of {{ money(price) }}</span>
        <span v-if="r.versions && r.versions.length" class="text-p-sm text-ink-gray-5">{{ r.versions.length }} version{{ r.versions.length > 1 ? 's' : '' }} saved</span>
      </div>
    </template>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { Alert, Badge, Button, Combobox, LoadingText, Select, TextInput, dialog } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { get, post, act, amount } from '../api'
import { state } from '../state'

const props = defineProps({ item: String, price: Number, stockItem: Boolean })
const cur = state.ctx.currency || ''
const r = ref({}), lines = ref([]), saved = ref('[]'), loading = ref(false), saving = ref(false), q = ref(''), found = ref([])
const money = amount
const snap = () => JSON.stringify(lines.value.map((l) => [l.item_code, Number(l.qty), l.uom, Number(l.yield_percent)]))
const dirty = computed(() => snap() !== saved.value)

async function load() {
  if (!props.item || props.stockItem) return
  loading.value = true
  try {
    r.value = await get('servepos.recipes.recipe.get_recipe', { item: props.item })
    lines.value = r.value.lines.map((l) => ({ ...l, qty: +Number(l.qty).toFixed(4) }))
    saved.value = snap()
  } finally { loading.value = false }
}
watch(() => props.item, load, { immediate: true })
// ingredient search on the server (frappe-ui Combobox, server mode); a newer search wins over a slower older one
const searching = ref(false)
let seq = 0
watch(q, async (v) => {
  const mine = ++seq
  if (!v || v.length < 2) return (found.value = [])
  searching.value = true
  try {
    const res = await get('servepos.recipes.recipe.search_ingredients', { txt: v, exclude: props.item })
    if (mine === seq) found.value = res.filter((f) => !lines.value.some((l) => l.item_code === f.name))
  } finally { if (mine === seq) searching.value = false }
})
const foundOptions = computed(() => found.value.map((f) => ({ ...f, label: f.item_name, value: f.name })))
function pick(v) { const f = found.value.find((x) => x.name === v); if (f) add(f) }

const factor = (l) => (l.uoms.find((u) => u.uom === l.uom) || { factor: 1 }).factor
const lineCost = (l) => (Number(l.qty || 0) * factor(l) / ((Number(l.yield_percent) || 100) / 100)) * Number(l.unit_cost || 0)
const total = computed(() => lines.value.reduce((a, l) => a + lineCost(l), 0))
const pct = computed(() => (props.price ? (total.value / props.price) * 100 : 0))

function add(f) {
  lines.value.push({ item_code: f.name, item_name: f.item_name, qty: 1, uom: f.stock_uom, uoms: f.uoms, yield_percent: 100, unit_cost: f.unit_cost, is_recipe: f.is_recipe })
  q.value = ''
  found.value = []
}
async function save() {
  saving.value = true
  const res = await act(() => post('servepos.recipes.recipe.save_recipe', { item: props.item, lines: lines.value.map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom, yield_percent: Number(l.yield_percent) || 100 })) }), 'Recipe saved')
  saving.value = false
  if (res) { r.value = res; lines.value = res.lines.map((l) => ({ ...l, qty: +Number(l.qty).toFixed(4) })); saved.value = snap() }
}
function remove() {
  dialog.danger({ title: 'Remove the recipe?', message: 'Sales of this item will stop taking ingredients out of stock. Saved versions are kept.', confirmLabel: 'Remove',
    onConfirm: async () => { await post('servepos.recipes.recipe.remove_recipe', { item: props.item }); await load() } })
}
</script>
