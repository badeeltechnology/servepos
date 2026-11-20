<template>
  <Header title="Recipes" :subtitle="r.data ? `${r.data.counts.with} of ${r.data.counts.all} menu items have a recipe` : ''" />
  <div class="space-y-4 px-3 pb-16 pt-4 sm:px-5">
    <div v-if="r.data" class="rounded-6 bg-surface-gray-1 px-4 py-3 text-p-base text-ink-gray-7">
      Recipes cover <b class="num">{{ Math.round(r.data.sales_covered_pct) }} %</b> of the last 30 days' sales.
      Items without a recipe take nothing out of stock at day close, so start with the best sellers at the top of
      <button class="text-ink-blue-6 hover:underline" @click="status = 'without'">No recipe yet</button>.
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <TextInput v-model="q" placeholder="Search menu items" class="w-64" :debounce="300"><template #prefix><span class="lucide-search size-4 text-ink-gray-5" /></template></TextInput>
      <Select v-model="group" :options="groupOptions" class="w-56" aria-label="Category" />
      <TabButtons v-model="status" :options="tabs" />
    </div>
    <div class="overflow-x-auto">
      <List :columns="['minmax(220px,1.4fr)', 'minmax(120px,1fr)', '6rem', '6rem', '7rem', '6rem', '8rem', '2.5rem']" class="-mx-3 min-w-[860px] list-row-px-3">
        <ListHeader>
          <ListHeaderCell>Menu item</ListHeaderCell><ListHeaderCell>Category</ListHeaderCell>
          <ListHeaderCell class="justify-end">Price</ListHeaderCell><ListHeaderCell class="justify-end">Cost</ListHeaderCell>
          <ListHeaderCell class="justify-end">Food cost</ListHeaderCell><ListHeaderCell class="justify-end">Ingredients</ListHeaderCell>
          <ListHeaderCell class="justify-end">Sold, 30 days</ListHeaderCell><ListHeaderCell />
        </ListHeader>
        <ListRows :items="rows" row-key="item_code" v-slot="{ item }">
          <ListRow class="min-h-12" :route="{ name: 'item', params: { name: item.item_code }, hash: '#recipe' }">
            <ListCell class="gap-2">
              <Thumb :src="item.image" :text="item.item_name" />
              <span class="min-w-0 flex-col"><span class="block truncate">{{ item.item_name }}</span><span class="block truncate text-xs text-ink-gray-4">{{ item.item_code }}</span></span>
            </ListCell>
            <ListCell class="truncate text-sm text-ink-gray-6">{{ item.item_group }}</ListCell>
            <ListCell class="justify-end num">{{ money2(item.price) }}</ListCell>
            <ListCell class="justify-end num">{{ item.has_recipe ? money2(item.cost) : '' }}</ListCell>
            <ListCell class="justify-end">
              <Badge v-if="item.has_recipe && item.food_cost_pct !== null" :theme="pctTheme(item.food_cost_pct)" :label="item.food_cost_pct.toFixed(1) + ' %'" />
              <Badge v-else-if="!item.has_recipe" theme="gray" label="No recipe" />
            </ListCell>
            <ListCell class="justify-end num text-ink-gray-6">{{ item.ingredients || '' }}</ListCell>
            <ListCell class="justify-end num">{{ item.sales ? money2(item.sales) : '' }}</ListCell>
            <ListCell class="justify-end"><span class="lucide-chevron-right size-4 text-ink-gray-4" /></ListCell>
          </ListRow>
        </ListRows>
      </List>
    </div>
    <div v-if="r.loading && !r.data" class="py-8"><LoadingText /></div>
    <div v-else-if="r.data && !rows.length" class="py-10 text-center text-p-sm text-ink-gray-5">No menu items match.</div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Badge, LoadingText, Select, TabButtons, TextInput } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import Thumb from '../components/Thumb.vue'
import { useRead } from '../api'
import { state } from '../state'

const q = ref(''), group = ref(''), status = ref('all')
// one call returns every menu item; filtering by state happens here so the counts stay put
const r = useRead('servepos.recipes.recipe.list_recipes', () => ({ search: q.value || null, item_group: group.value || null }))
const groupOptions = computed(() => [{ label: 'All categories', value: '' }, ...((state.setup && state.setup.groups) || []).map((g) => ({ label: g.name || g, value: g.name || g }))])
const tabs = computed(() => {
  const c = (r.data && r.data.counts) || {}
  return [
    { label: `All ${c.all ?? ''}`, value: 'all' },
    { label: `With recipe ${c.with ?? ''}`, value: 'with' },
    { label: `No recipe yet ${c.without ?? ''}`, value: 'without' },
    { label: `Over 35 % ${c.high ?? ''}`, value: 'high' },
  ]
})
const rows = computed(() => ((r.data && r.data.rows) || []).filter((x) =>
  status.value === 'with' ? x.has_recipe : status.value === 'without' ? !x.has_recipe : status.value === 'high' ? (x.food_cost_pct || 0) > 35 : true))
const money2 = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTheme = (p) => (p > 35 ? 'red' : p > 30 ? 'orange' : 'green')
</script>
