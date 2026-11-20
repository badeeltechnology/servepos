<template>
  <Header title="Menu engineering" :subtitle="(outlet || 'All outlets') + ' · ' + label" />
  <div class="space-y-5 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-end gap-2">
      <Select v-model="outlet" :options="outletOptions()" class="w-56" aria-label="Outlet" />
      <TabButtons :options="presets.filter((p) => p.key !== 'today').map((p) => ({ label: p.label, value: p.key }))" v-model="preset" />
      <DateRangePicker v-if="preset === 'custom'" v-model="custom" class="w-60" />
      <Select v-model="group" :options="groupOptions" class="w-56" aria-label="Category" />
    </div>
    <p class="max-w-4xl text-p-sm text-ink-gray-6">
      Each item with a recipe, placed by how often it sells and how much it earns per portion (price less ingredient cost) against the average of the items shown.
      Compare items within one category for the clearest picture.
    </p>

    <div v-if="!d" class="py-10"><LoadingText /></div>
    <template v-else>
      <div v-if="!d.items.length" class="rounded-6 border border-outline-gray-2 px-4 py-6 text-p-base text-ink-gray-6">
        No item with a recipe sold in this period. Menu engineering needs the cost of each portion:
        <router-link to="/recipes" class="text-ink-blue-6 hover:underline">add recipes</router-link>, starting with the best sellers.
      </div>
      <template v-else>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button v-for="c in classes" :key="c.key" class="rounded-8 border p-4 text-left transition" :class="pick === c.key ? 'border-outline-gray-4 bg-surface-gray-2' : 'border-outline-gray-2 hover:bg-surface-gray-1'" @click="pick = pick === c.key ? '' : c.key">
            <div class="flex items-center justify-between"><span class="text-base-semibold">{{ c.label }}</span><Badge :theme="c.theme" :label="String(count(c.key))" /></div>
            <div class="mt-1 text-p-sm text-ink-gray-6">{{ c.what }}</div>
            <div class="mt-2 text-p-sm text-ink-gray-8">{{ c.todo }}</div>
          </button>
        </div>

        <section class="space-y-2">
          <h2 class="text-base-semibold">Popularity and profit</h2>
          <div class="relative h-[340px] rounded-6 border border-outline-gray-2">
            <!-- quadrant chart: x = share of portions sold, y = profit per portion -->
            <div class="absolute inset-0 m-8">
              <div class="absolute bottom-0 top-0 border-l border-dashed border-outline-gray-3" :style="{ left: xPos(d.popularity_line) + '%' }" />
              <div class="absolute left-0 right-0 border-t border-dashed border-outline-gray-3" :style="{ top: 100 - yPos(d.avg_margin) + '%' }" />
              <span class="absolute right-1 top-1 text-xs text-ink-gray-4">Stars</span><span class="absolute left-1 top-1 text-xs text-ink-gray-4">Puzzles</span>
              <span class="absolute bottom-1 right-1 text-xs text-ink-gray-4">Plowhorses</span><span class="absolute bottom-1 left-1 text-xs text-ink-gray-4">Dogs</span>
              <Tooltip v-for="i in d.items" :key="i.item_code" :text="`${i.item_name}: ${fmt(i.qty, 0)} sold, ${num2(i.margin)} profit per portion`">
                <button class="absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-white" :class="pick && pick !== i.class ? 'opacity-20' : ''"
                  :style="{ left: xPos(i.mix_pct) + '%', bottom: yPos(i.margin) + '%', background: dot(i.class) }" @click="$router.push({ name: 'item', params: { name: i.item_code }, hash: '#recipe' })" />
              </Tooltip>
            </div>
            <span class="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-ink-gray-5">Share of portions sold →</span>
            <span class="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-ink-gray-5">Profit per portion →</span>
          </div>
        </section>

        <div class="overflow-x-auto">
          <List :columns="['minmax(200px,1.4fr)', '7rem', '5rem', '6rem', '6rem', '6rem', '6rem', '8rem']" class="-mx-3 min-w-[860px] list-row-px-3">
            <ListHeader>
              <ListHeaderCell>Item</ListHeaderCell><ListHeaderCell>Class</ListHeaderCell><ListHeaderCell class="justify-end">Sold</ListHeaderCell>
              <ListHeaderCell class="justify-end">Price</ListHeaderCell><ListHeaderCell class="justify-end">Cost</ListHeaderCell><ListHeaderCell class="justify-end">Profit</ListHeaderCell>
              <ListHeaderCell class="justify-end">Food cost</ListHeaderCell><ListHeaderCell class="justify-end">Total profit</ListHeaderCell>
            </ListHeader>
            <ListRows :items="shown" row-key="item_code" v-slot="{ item }">
              <ListRow class="min-h-11" :route="{ name: 'item', params: { name: item.item_code }, hash: '#recipe' }">
                <ListCell class="min-w-0 flex-col !items-start"><span class="w-full truncate">{{ item.item_name }}</span><span class="text-xs text-ink-gray-4">{{ item.item_group }}</span></ListCell>
                <ListCell><Badge :theme="theme(item.class)" :label="item.class" /></ListCell>
                <ListCell class="justify-end num">{{ fmt(item.qty, 0) }}</ListCell>
                <ListCell class="justify-end num">{{ num2(item.price) }}</ListCell>
                <ListCell class="justify-end num">{{ num2(item.cost) }}</ListCell>
                <ListCell class="justify-end num">{{ num2(item.margin) }}</ListCell>
                <ListCell class="justify-end num" :class="item.food_cost_pct > 35 ? 'text-ink-red-6' : ''">{{ item.food_cost_pct.toFixed(1) }} %</ListCell>
                <ListCell class="justify-end text-base-medium num">{{ num2(item.total_margin) }}</ListCell>
              </ListRow>
            </ListRows>
          </List>
        </div>
      </template>

      <section v-if="d.no_recipe.length" class="space-y-2">
        <h2 class="text-base-semibold">Sold without a recipe</h2>
        <p class="text-p-sm text-ink-gray-6">{{ num2(d.no_recipe_sales) }} of sales ({{ Math.round(d.no_recipe_sales / Math.max(d.no_recipe_sales + d.costed_sales, 1) * 100) }} %) can't be placed because these items have no cost yet.</p>
        <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
          <router-link v-for="i in d.no_recipe.slice(0, noRecipeLimit)" :key="i.item_code" :to="{ name: 'item', params: { name: i.item_code }, hash: '#recipe' }"
            class="grid grid-cols-[1fr_6rem_8rem_6rem] items-center gap-2 px-3 py-1.5 text-base hover:bg-surface-gray-1">
            <span class="truncate">{{ i.item_name }} <span class="text-xs text-ink-gray-4">{{ i.item_group }}</span></span>
            <span class="text-right num">{{ fmt(i.qty, 0) }}</span><span class="text-right num">{{ num2(i.sales) }}</span>
            <span class="text-right text-sm text-ink-blue-6">Add recipe</span>
          </router-link>
        </div>
        <Button v-if="d.no_recipe.length > noRecipeLimit" :label="`Show all ${d.no_recipe.length}`" @click="noRecipeLimit = 1000" />
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, Button, DateRangePicker, LoadingText, Select, TabButtons, Tooltip } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import { useRead } from '../api'
import { fmt } from '../../api'
import { state, setOutlet, outletOptions } from '../state'
import { usePeriod } from '../period'

const route = useRoute()
const { presets, preset, custom, range, label } = usePeriod('days30', route.query)
const outlet = ref(state.outlet)
watch(outlet, (v) => setOutlet(v))
const group = ref(''), pick = ref(''), noRecipeLimit = ref(10)
const r = useRead('manager.get_menu_engineering', () => ({ pos_profile: outlet.value || null, from_date: range.value[0], to_date: range.value[1], item_group: group.value || null }))
const d = computed(() => r.data)
const groupOptions = computed(() => [{ label: 'All categories', value: '' }, ...((d.value && d.value.groups) || []).map((g) => ({ label: g, value: g }))])
const num2 = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const classes = [
  { key: 'Star', label: 'Stars', theme: 'green', what: 'Popular and profitable.', todo: 'Keep them visible, keep the quality and portion steady.' },
  { key: 'Plowhorse', label: 'Plowhorses', theme: 'blue', what: 'Popular, low profit per portion.', todo: 'Raise the price a little or cut the recipe cost.' },
  { key: 'Puzzle', label: 'Puzzles', theme: 'orange', what: 'Profitable, but few sell.', todo: 'Promote them: better menu spot, waiter suggestion, rename.' },
  { key: 'Dog', label: 'Dogs', theme: 'red', what: 'Neither popular nor profitable.', todo: 'Rework or take off the menu.' },
]
const theme = (c) => (classes.find((x) => x.key === c) || {}).theme || 'gray'
const dot = (c) => ({ Star: '#30a66d', Plowhorse: '#2490ef', Puzzle: '#e79913', Dog: '#e03636' })[c]
const count = (k) => ((d.value && d.value.items) || []).filter((i) => i.class === k).length
const shown = computed(() => ((d.value && d.value.items) || []).filter((i) => !pick.value || i.class === pick.value))

// plot scales: both axes start at zero, with a little headroom
const maxX = computed(() => Math.max(...((d.value && d.value.items) || []).map((i) => i.mix_pct), d.value ? d.value.popularity_line * 2 : 1) * 1.05)
const minY = computed(() => Math.min(0, ...((d.value && d.value.items) || []).map((i) => i.margin)))
const maxY = computed(() => Math.max(...((d.value && d.value.items) || []).map((i) => i.margin), d.value ? d.value.avg_margin * 2 : 1) * 1.05)
const xPos = (v) => Math.max(0, Math.min(100, (v / (maxX.value || 1)) * 100))
const yPos = (v) => Math.max(0, Math.min(100, ((v - minY.value) / ((maxY.value - minY.value) || 1)) * 100))
</script>
