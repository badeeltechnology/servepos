<template>
  <!-- A titled frappe-ui List for the small summary tables on report pages. -->
  <section class="space-y-2">
    <h2 v-if="title" class="text-base-semibold">{{ title }}</h2>
    <div class="overflow-x-auto">
      <List :columns="cols.map((c) => c.width || (c.align === 'right' ? '8rem' : 'minmax(140px,1fr)'))" :class="['-mx-3 list-row-px-3', minWidth]">
        <ListHeader>
          <ListHeaderCell v-for="c in cols" :key="c.label" :class="c.align === 'right' ? 'justify-end' : ''">{{ c.label }}</ListHeaderCell>
        </ListHeader>
        <ListRows :items="rows" v-slot="{ item }">
          <ListRow class="min-h-9" :route="rowRoute ? rowRoute(item) : undefined">
            <ListCell v-for="(c, i) in cols" :key="c.label" :class="[c.align === 'right' ? 'justify-end num' : 'min-w-0', i === 0 ? '' : '']">
              <slot :name="'cell-' + c.key" :item="item" :value="item[c.key]">
                <span :class="[c.align === 'right' ? '' : 'truncate', c.muted ? 'text-ink-gray-5' : '']">{{ c.format ? c.format(item[c.key], item) : item[c.key] }}</span>
              </slot>
            </ListCell>
          </ListRow>
        </ListRows>
      </List>
    </div>
    <p v-if="!rows.length" class="px-1 py-2 text-p-sm text-ink-gray-5">{{ empty }}</p>
  </section>
</template>

<script setup>
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'

defineProps({
  title: String,
  /** [{ key, label, align: 'right', width, format(value, row), muted }] */
  cols: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  rowRoute: Function,
  empty: { type: String, default: 'Nothing in this period.' },
  minWidth: { type: String, default: '' },
})
</script>
