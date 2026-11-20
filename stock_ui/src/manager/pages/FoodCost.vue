<template>
  <Header title="Food cost" :subtitle="(outlet || 'All outlets') + ' · ' + label" />
  <div class="space-y-5 px-3 pb-16 pt-4 sm:px-5">
    <div class="flex flex-wrap items-end gap-2">
      <Select v-model="outlet" :options="outletOptions()" class="w-56" aria-label="Outlet" />
      <TabButtons :options="presets.map((p) => ({ label: p.label, value: p.key }))" v-model="preset" />
      <DateRangePicker v-if="preset === 'custom'" v-model="custom" class="w-60" />
    </div>

    <div v-if="!d" class="py-10"><LoadingText /></div>
    <template v-else>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
        <NumberCard title="Food cost" :value="d.total.recipe_sales ? d.total.food_cost_pct : null" suffix=" %" :format="(v) => Number(v).toFixed(1)"
          :delta-caption="`of sales of items with a recipe`" />
        <NumberCard title="Ingredient cost" :prefix="curP" :value="d.total.cost" :format="num2" :delta-caption="`on ${num2(d.total.recipe_sales)} of sales`" />
        <NumberCard title="Sales covered" :value="d.total.coverage_pct" suffix=" %" :format="(v) => Math.round(v)" :delta-caption="`${d.recipes} recipes`" />
        <NumberCard title="Taken out at day close" :prefix="curP" :value="d.posted" :format="num2" :delta-caption="d.short_lines ? `${d.short_lines} ingredient lines short` : 'nothing short'" />
        <NumberCard title="Waste recorded" :prefix="curP" :value="d.waste" :format="num2" />
      </div>
      <p class="max-w-4xl text-p-sm text-ink-gray-6">
        Food cost is what the recipes say the sales used, at today's ingredient costs. "Taken out at day close" is what was actually posted from stock;
        it is lower when ingredients were short or days are not closed yet. Items without a recipe are left out of the food cost %.
      </p>

      <div v-if="d.daily.length > 1" class="h-72">
        <LineChart title="Food cost by day" subtitle="% of sales of items with a recipe" :data="daily" x="day" y="pct" :format="(v) => Number(v).toFixed(1) + ' %'" />
      </div>

      <section class="space-y-2">
        <h2 class="text-base-semibold">By outlet</h2>
        <div class="overflow-x-auto">
          <List :columns="['minmax(160px,1.2fr)', '8rem', '6rem', '8rem', '7rem', '8rem', '6rem', '7rem']" class="-mx-3 min-w-[860px] list-row-px-3">
            <ListHeader>
              <ListHeaderCell>Outlet</ListHeaderCell><ListHeaderCell class="justify-end">Sales</ListHeaderCell><ListHeaderCell class="justify-end">Covered</ListHeaderCell>
              <ListHeaderCell class="justify-end">Ingredient cost</ListHeaderCell><ListHeaderCell class="justify-end">Food cost</ListHeaderCell>
              <ListHeaderCell class="justify-end">Day close</ListHeaderCell><ListHeaderCell class="justify-end">Short</ListHeaderCell><ListHeaderCell class="justify-end">Waste</ListHeaderCell>
            </ListHeader>
            <ListRows :items="d.outlets" row-key="pos_profile" v-slot="{ item }">
              <ListRow class="min-h-10">
                <ListCell class="truncate">{{ item.pos_profile }}</ListCell>
                <ListCell class="justify-end num">{{ num2(item.sales) }}</ListCell>
                <ListCell class="justify-end num">{{ Math.round(item.coverage_pct) }} %</ListCell>
                <ListCell class="justify-end num">{{ num2(item.cost) }}</ListCell>
                <ListCell class="justify-end"><Badge v-if="item.recipe_sales" :theme="pctTheme(item.food_cost_pct)" :label="item.food_cost_pct.toFixed(1) + ' %'" /></ListCell>
                <ListCell class="justify-end num">{{ item.closed_days ? num2(item.posted) : 'not closed' }}</ListCell>
                <ListCell class="justify-end num" :class="item.short_lines ? 'text-ink-amber-6' : 'text-ink-gray-4'">{{ item.short_lines || 0 }}</ListCell>
                <ListCell class="justify-end num">{{ item.waste ? num2(item.waste) : '' }}</ListCell>
              </ListRow>
            </ListRows>
          </List>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section class="space-y-2">
          <h2 class="text-base-semibold">Highest food cost</h2>
          <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
            <div class="grid grid-cols-[1fr_5rem_7rem_5rem] gap-2 px-3 py-1.5 text-xs text-ink-gray-5"><span>Item</span><span class="text-right">Sold</span><span class="text-right">Sales</span><span class="text-right">Food cost</span></div>
            <router-link v-for="i in d.highest" :key="i.item_code" :to="{ name: 'item', params: { name: i.item_code }, hash: '#recipe' }" class="grid grid-cols-[1fr_5rem_7rem_5rem] gap-2 px-3 py-1.5 text-base hover:bg-surface-gray-1">
              <span class="truncate">{{ i.item_name }}</span><span class="text-right num">{{ fmt(i.qty, 0) }}</span><span class="text-right num">{{ num2(i.sales) }}</span>
              <span class="text-right num" :class="i.food_cost_pct > 35 ? 'text-ink-red-6' : ''">{{ i.food_cost_pct.toFixed(1) }} %</span>
            </router-link>
            <div v-if="!d.highest.length" class="px-3 py-4 text-p-sm text-ink-gray-5">No item with a recipe sold in this period.</div>
          </div>
        </section>
        <section class="space-y-2">
          <h2 class="text-base-semibold">Best sellers without a recipe</h2>
          <div class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2">
            <div class="grid grid-cols-[1fr_5rem_7rem_6rem] gap-2 px-3 py-1.5 text-xs text-ink-gray-5"><span>Item</span><span class="text-right">Sold</span><span class="text-right">Sales</span><span /></div>
            <router-link v-for="i in d.no_recipe" :key="i.item_code" :to="{ name: 'item', params: { name: i.item_code }, hash: '#recipe' }" class="grid grid-cols-[1fr_5rem_7rem_6rem] gap-2 px-3 py-1.5 text-base hover:bg-surface-gray-1">
              <span class="truncate">{{ i.item_name }}</span><span class="text-right num">{{ fmt(i.qty, 0) }}</span><span class="text-right num">{{ num2(i.sales) }}</span>
              <span class="text-right text-sm text-ink-blue-6">Add recipe</span>
            </router-link>
            <div v-if="!d.no_recipe.length" class="px-3 py-4 text-p-sm text-ink-gray-5">Every item sold has a recipe.</div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, DateRangePicker, LoadingText, Select, TabButtons } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { LineChart, NumberCard } from 'frappe-ui/charts'
import Header from '../../components/Header.vue'
import { useRead } from '../api'
import { fmt, fmtDate } from '../../api'
import { state, setOutlet, outletOptions } from '../state'
import { usePeriod } from '../period'

const route = useRoute()
const { presets, preset, custom, range, label } = usePeriod('days30', route.query)
const outlet = ref(state.outlet)
watch(outlet, (v) => setOutlet(v))
const r = useRead('manager.get_food_cost', () => ({ pos_profile: outlet.value || null, from_date: range.value[0], to_date: range.value[1] }))
const d = computed(() => r.data)
const curP = state.ctx.currency ? state.ctx.currency + ' ' : ''
const num2 = (v) => Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTheme = (p) => (p > 35 ? 'red' : p > 30 ? 'orange' : 'green')
const daily = computed(() => ((d.value && d.value.daily) || []).filter((x) => x.recipe_sales).map((x) => ({ day: fmtDate(x.date), pct: Number(x.food_cost_pct.toFixed(1)) })))
</script>
