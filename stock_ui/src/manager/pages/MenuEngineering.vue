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
        <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <NumberCard v-for="c in classes" :key="c.key" :title="c.label" :value="count(c.key)" :delta-caption="c.todo" />
        </div>

        <div class="h-[380px]">
          <ScatterChart title="Popularity and profit" subtitle="Share of portions sold against profit per portion; the dashed lines are the averages that split the four groups"
            :data="d.items" x="mix_pct" y="margin" split-by="class" label="item_name" :format="num2"
            :x-axis="{ title: 'Share of portions sold (%)', min: 0 }" :y-axis="{ title: 'Profit per portion', min: 0 }"
            :reference-lines="[{ axis: 'x', value: d.popularity_line, label: 'Popular', dashed: true }, { value: d.avg_margin, label: 'Average profit', dashed: true }]"
            @select="(e) => $router.push({ name: 'item', params: { name: e.row.item_code }, hash: '#recipe' })" />
        </div>

        <TabButtons v-model="pick" :options="[{ label: 'All', value: '' }, ...classes.map((c) => ({ label: c.label, value: c.key }))]" />
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
        <SummaryList :rows="d.no_recipe.slice(0, noRecipeLimit)" :row-route="(i) => ({ name: 'item', params: { name: i.item_code }, hash: '#recipe' })"
          :cols="[{ key: 'item_name', label: 'Item' }, { key: 'item_group', label: 'Category', muted: true }, { key: 'qty', label: 'Sold', align: 'right', width: '5rem', format: (v) => fmt(v, 0) },
            { key: 'sales', label: 'Sales', align: 'right', width: '8rem', format: num2 }, { key: 'add', label: '', align: 'right', width: '6.5rem' }]">
          <template #cell-add><Badge theme="blue" label="Add recipe" /></template>
        </SummaryList>
        <Button v-if="d.no_recipe.length > noRecipeLimit" :label="`Show all ${d.no_recipe.length}`" @click="noRecipeLimit = 1000" />
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, Button, DateRangePicker, LoadingText, Select, TabButtons } from 'frappe-ui'
import { NumberCard, ScatterChart } from 'frappe-ui/charts'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import Header from '../../components/Header.vue'
import SummaryList from '../components/SummaryList.vue'
import { useRead, amount } from '../api'
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
const num2 = amount

const classes = [
  { key: 'Star', label: 'Stars', theme: 'green', what: 'Popular and profitable.', todo: 'Keep them visible, keep the quality and portion steady.' },
  { key: 'Plowhorse', label: 'Plowhorses', theme: 'blue', what: 'Popular, low profit per portion.', todo: 'Raise the price a little or cut the recipe cost.' },
  { key: 'Puzzle', label: 'Puzzles', theme: 'orange', what: 'Profitable, but few sell.', todo: 'Promote them: better menu spot, waiter suggestion, rename.' },
  { key: 'Dog', label: 'Dogs', theme: 'red', what: 'Neither popular nor profitable.', todo: 'Rework or take off the menu.' },
]
const theme = (c) => (classes.find((x) => x.key === c) || {}).theme || 'gray'
const count = (k) => ((d.value && d.value.items) || []).filter((i) => i.class === k).length
const shown = computed(() => ((d.value && d.value.items) || []).filter((i) => !pick.value || i.class === pick.value))


</script>
