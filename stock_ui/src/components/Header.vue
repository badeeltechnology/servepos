<template>
  <PageHeader>
    <div class="flex min-w-0 items-center gap-2">
      <PageHeaderBackButton v-if="back" :fallback-route="back" label="" />
      <PageHeaderTitle :title="title" class="truncate" />
      <slot name="status" />
      <span v-if="subtitle" class="hidden truncate text-base text-ink-gray-5 md:inline">{{ subtitle }}</span>
    </div>
    <div class="flex shrink-0 items-center gap-2"><slot /></div>
  </PageHeader>
</template>
<script setup>
import { PageHeader, PageHeaderBackButton, PageHeaderTitle } from 'frappe-ui'
defineProps({ title: String, subtitle: String, back: [String, Object] })
</script>
