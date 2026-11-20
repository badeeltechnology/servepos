<template>
  <FrappeUIProvider>
    <div class="h-screen w-full bg-surface-base text-ink-gray-8">
      <div v-if="state.loading" class="flex h-full items-center justify-center"><LoadingText text="Opening ServePOS…" /></div>
      <div v-else-if="state.error" class="p-8"><ErrorMessage :message="state.error" /></div>
      <DesktopShell v-else>
        <template #sidebar>
          <Sidebar width="14rem" v-model:collapsed="collapsed" class="border-r border-outline-gray-1">
            <SidebarHeader title="ServePOS" :subtitle="state.ctx.company || 'Manager'" :menu-items="menu">
              <template #prefix>
                <div class="flex size-full items-center justify-center bg-surface-gray-7 text-xs-semibold text-ink-white">SP</div>
              </template>
            </SidebarHeader>
            <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
              <div class="space-y-0.5">
                <template v-for="item in nav" :key="item.key || item.route || item.href">
                  <SidebarLabel v-if="item.section" divider class="pt-3">{{ item.section }}</SidebarLabel>
                  <SidebarItem v-else-if="item.route" :label="item.label" :icon="item.icon" :route="item.route" :active="item.route === '/' ? $route.path === '/' : $route.path.startsWith(item.route)" />
                  <SidebarItem v-else :label="item.label" :icon="item.icon" :href="item.href" />
                </template>
              </div>
            </ScrollArea>
            <div class="space-y-0.5 border-t border-outline-gray-1 px-2 py-2">
              <SidebarCollapseToggle />
            </div>
          </Sidebar>
        </template>
        <router-view :key="$route.fullPath" />
      </DesktopShell>
    </div>
  </FrappeUIProvider>
</template>

<script setup>
import { computed, ref } from 'vue'
import { DesktopShell, ErrorMessage, FrappeUIProvider, LoadingText, ScrollArea, Sidebar, SidebarCollapseToggle, SidebarHeader, SidebarItem, SidebarLabel } from 'frappe-ui'
import { state } from './state'

const collapsed = ref(window.innerWidth < 1280)

async function logout() {
  await fetch('/api/method/logout', { method: 'POST', headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' } })
  window.location.href = '/login'
}

const menu = computed(() => [
  ...(state.ctx.desk ? [{ label: 'Open ERPNext desk', icon: 'lucide-app-window', onClick: () => (window.location.href = '/app') }] : []),
  { label: 'Log out ' + (state.ctx.full_name || ''), icon: 'lucide-log-out', onClick: logout },
])

const nav = computed(() => {
  const out = [
    { route: '/', label: 'Today', icon: 'lucide-house' },
    { route: '/sales', label: 'Sales', icon: 'lucide-chart-column' },
  ]
  if (state.ctx.is_manager) {
    out.push(
      { section: 'Menu', key: 'm' },
      { route: '/items', label: 'Menu items', icon: 'lucide-utensils' },
      { route: '/modifiers', label: 'Modifiers', icon: 'lucide-list-plus' },
      { section: 'Restaurant', key: 'r' },
      { route: '/floor', label: 'Tables and rooms', icon: 'lucide-armchair' },
      { route: '/staff', label: 'Waiters', icon: 'lucide-users' },
      { route: '/offers', label: 'Promos and vouchers', icon: 'lucide-ticket-percent' },
    )
  }
  out.push({ section: 'Stock', key: 'x' })
  if (state.ctx.is_manager) out.push({ route: '/day-close', label: 'Day close', icon: 'lucide-calendar-check' })
  out.push({ href: '/stock', label: 'Stock orders', icon: 'lucide-package' })
  if (state.ctx.is_manager) out.push({ route: '/settings', label: 'Settings', icon: 'lucide-settings' })
  return out
})
</script>
