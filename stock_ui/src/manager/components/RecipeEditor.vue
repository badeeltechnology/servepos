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
    <div v-if="stockItem" class="rounded-6 bg-surface-gray-1 p-3 text-p-sm text-ink-gray-6">This item is kept in stock, so each sale takes it out of stock directly. Recipes are for menu items that are made from ingredients.</div>
    <template v-else>
      <div class="overflow-x-auto rounded-6 border border-outline-gray-2">
        <div class="grid min-w-[620px] grid-cols-[minmax(10rem,1fr)_6rem_7rem_5rem_6rem_2rem] gap-2 border-b border-outline-gray-1 px-3 py-1.5 text-xs text-ink-gray-5">
          <span>Ingredient</span><span>Amount</span><span>Unit</span><span title="Usable share after trimming and cooking">Yield %</span><span class="text-right">Cost</span><span />
        </div>
        <div v-for="(l, i) in lines" :key="l.item_code" class="grid min-w-[620px] grid-cols-[minmax(10rem,1fr)_6rem_7rem_5rem_6rem_2rem] items-center gap-2 px-3 py-1">
          <span class="min-w-0"><span class="block truncate text-base">{{ l.item_name }}</span><span v-if="l.is_recipe" class="text-xs text-ink-blue-6">prep recipe</span></span>
          <TextInput type="number" v-model="l.qty" min="0" step="any" />
          <Select v-model="l.uom" :options="l.uoms.map((u) => ({ label: u.uom, value: u.uom }))" />
          <TextInput type="number" v-model="l.yield_percent" min="1" max="100" />
          <span class="text-right text-sm num">{{ money(lineCost(l)) }}</span>
          <Button variant="ghost" size="sm" icon="lucide-x" aria-label="Remove" @click="lines.splice(i, 1)" />
        </div>
        <div v-if="!lines.length && !loading" class="px-3 py-4 text-p-sm text-ink-gray-5">No recipe yet. Add the ingredients one portion uses.</div>
        <div v-if="loading" class="px-3 py-4"><LoadingText /></div>
      </div>
      <div class="relative">
        <TextInput v-model="q" placeholder="Add an ingredient: type its name" :debounce="250"><template #prefix><span class="lucide-plus size-4 text-ink-gray-5" /></template></TextInput>
        <div v-if="found.length" class="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-6 border border-outline-gray-2 bg-surface-white p-1 shadow-lg">
          <button v-for="f in found" :key="f.name" class="flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left hover:bg-surface-gray-2" @click="add(f)">
            <span class="min-w-0 flex-1 truncate text-base">{{ f.item_name }}</span>
            <span v-if="f.is_recipe" class="text-xs text-ink-blue-6">prep recipe</span>
            <span class="text-xs text-ink-gray-5">{{ money(f.unit_cost) }} / {{ f.stock_uom }}</span>
          </button>
        </div>
      </div>
      <div v-if="lines.length" class="flex flex-wrap gap-6 rounded-6 bg-surface-gray-1 px-3 py-2 text-base">
        <span>Cost per portion <b class="num">{{ cur }} {{ money(total) }}</b></span>
        <span v-if="price">Food cost <b class="num" :class="pct > 35 ? 'text-ink-red-6' : pct > 30 ? 'text-ink-amber-6' : 'text-ink-green-6'">{{ pct.toFixed(1) }} %</b> of {{ money(price) }}</span>
        <span v-if="r.versions && r.versions.length" class="text-p-sm text-ink-gray-5">{{ r.versions.length }} version{{ r.versions.length > 1 ? 's' : '' }} saved</span>
      </div>
    </template>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { Button, LoadingText, Select, TextInput, dialog } from 'frappe-ui'
import { get, post, act } from '../api'
import { state } from '../state'

const props = defineProps({ item: String, price: Number, stockItem: Boolean })
const cur = state.ctx.currency || ''
const r = ref({}), lines = ref([]), saved = ref('[]'), loading = ref(false), saving = ref(false), q = ref(''), found = ref([])
const money = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const snap = () => JSON.stringify(lines.value.map((l) => [l.item_code, Number(l.qty), l.uom, Number(l.yield_percent)]))
const dirty = computed(() => snap() !== saved.value)

async function load() {
  if (!props.item || props.stockItem) return
  loading.value = true
  try {
    r.value = await get('recipes.recipe.get_recipe', { item: props.item })
    lines.value = r.value.lines.map((l) => ({ ...l, qty: +Number(l.qty).toFixed(4) }))
    saved.value = snap()
  } finally { loading.value = false }
}
watch(() => props.item, load, { immediate: true })
watch(q, async (v) => { found.value = v && v.length > 1 ? (await get('recipes.recipe.search_ingredients', { txt: v, exclude: props.item })).filter((f) => !lines.value.some((l) => l.item_code === f.name)) : [] })

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
  const res = await act(() => post('recipes.recipe.save_recipe', { item: props.item, lines: lines.value.map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom, yield_percent: Number(l.yield_percent) || 100 })) }), 'Recipe saved')
  saving.value = false
  if (res) { r.value = res; lines.value = res.lines.map((l) => ({ ...l, qty: +Number(l.qty).toFixed(4) })); saved.value = snap() }
}
function remove() {
  dialog.danger({ title: 'Remove the recipe?', message: 'Sales of this item will stop taking ingredients out of stock. Saved versions are kept.', confirmLabel: 'Remove',
    onConfirm: async () => { await post('recipes.recipe.remove_recipe', { item: props.item }); await load() } })
}
</script>
