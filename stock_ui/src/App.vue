<template>
  <FrappeUIProvider>
    <div class="h-screen w-full bg-surface-base text-ink-gray-8">
      <div v-if="state.loading" class="flex h-full items-center justify-center"><LoadingText text="Opening stock orders…" /></div>
      <div v-else-if="state.error" class="p-8"><ErrorMessage :message="state.error" /></div>
      <DesktopShell v-else>
        <template #sidebar>
          <Sidebar width="14rem" v-model:collapsed="collapsed" class="border-r border-outline-gray-1">
            <SidebarHeader :title="state.location ? state.location.name : 'Stock Orders'" :subtitle="subtitle" :menu-items="menu">
              <template #prefix>
                <div class="flex size-full items-center justify-center text-xs-semibold text-white" :style="{ background: badgeColor }">{{ initials }}</div>
              </template>
            </SidebarHeader>
            <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
              <div class="space-y-0.5">
                <template v-for="item in nav" :key="item.key || item.route">
                  <SidebarLabel v-if="item.section" divider class="pt-3">{{ item.section }}</SidebarLabel>
                  <SidebarItem v-else :label="item.label" :icon="item.icon" :route="item.route" :active="$route.path === item.route || (item.route === '/order' && $route.path.startsWith('/order'))" />
                </template>
              </div>
            </ScrollArea>
            <div class="space-y-0.5 border-t border-outline-gray-1 px-2 py-2">
              <SidebarItem v-if="state.ctx.is_admin" label="Settings" icon="lucide-settings" href="/app/servepos-stock-settings" />
              <SidebarCollapseToggle />
            </div>
          </Sidebar>
        </template>

        <div v-if="!state.location && !state.ctx.is_buyer" class="px-5 pt-10">
          <Alert theme="amber" title="No outlet assigned" description="Your user has no outlet or provider. Ask the administrator to add a User Permission on your warehouse." />
        </div>
        <router-view v-else :key="(state.location && state.location.name) + $route.fullPath" />
      </DesktopShell>
    </div>
  </FrappeUIProvider>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Alert, DesktopShell, ErrorMessage, FrappeUIProvider, LoadingText, ScrollArea, Sidebar, SidebarCollapseToggle, SidebarHeader, SidebarItem, SidebarLabel } from 'frappe-ui'
import { state, myLocations, setLocation, isProvider, shipsHere } from './state'

const router = useRouter()
// icons only on tablets, full labels on wide screens; the toggle at the bottom switches it
const collapsed = ref(window.innerWidth < 1280)
const initials = computed(() => (state.location ? state.location.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : 'SO'))
const badgeColor = computed(() => (state.location && state.location.color) || '#525252')
const subtitle = computed(() => (!state.location ? 'Stock Orders' : isProvider.value ? 'Provider' : state.location.location_group || 'Outlet'))

function pick(l) {
  setLocation(l)
  router.push('/')
}
async function logout() {
  await fetch('/api/method/logout', { method: 'POST', headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' } })
  window.location.href = '/login'
}

const menu = computed(() => {
  const out = []
  if (myLocations.value.length > 1) {
    out.push({
      group: 'Switch location',
      options: myLocations.value.map((l) => ({
        label: l.name,
        icon: l.location_type === 'Provider' ? 'lucide-chef-hat' : 'lucide-store',
        selected: state.location && l.name === state.location.name,
        onClick: () => pick(l),
      })),
    })
  }
  if (state.ctx && state.ctx.desk) out.push({ label: 'Open ERPNext desk', icon: 'lucide-app-window', onClick: () => (window.location.href = '/app') })
  out.push({ label: 'Log out ' + ((state.ctx && state.ctx.full_name) || ''), icon: 'lucide-log-out', onClick: logout })
  return out
})

const nav = computed(() => {
  const out = []
  const loc = state.location
  if (loc && !isProvider.value) {
    out.push(
      { route: '/home', label: 'Today', icon: 'lucide-house' },
      { route: '/order', label: 'New order', icon: 'lucide-square-plus' },
      { route: '/emergency', label: 'Emergency order', icon: 'lucide-siren' },
      { route: '/list/incoming', label: 'Receive', icon: 'lucide-inbox' },
      { route: '/transfers', label: 'Transfers', icon: 'lucide-arrow-left-right' },
      { route: '/send', label: 'Send stock', icon: 'lucide-send' },
      { route: '/returns', label: 'Returns', icon: 'lucide-undo-2' },
      { route: '/inventory', label: 'Inventory', icon: 'lucide-clipboard-list' },
      { route: '/list/history', label: 'Order history', icon: 'lucide-history' },
    )
  }
  if (loc && isProvider.value) {
    out.push({ route: '/home', label: 'Today', icon: 'lucide-house' })
    if (shipsHere.value) {
      out.push(
        { route: '/picking', label: 'Picking sheet', icon: 'lucide-table-2' },
        { route: '/list/to_ship', label: 'To ship', icon: 'lucide-truck' },
        { route: '/send', label: 'Send stock', icon: 'lucide-send' },
        { route: '/list/discrepancies', label: 'Discrepancies', icon: 'lucide-triangle-alert' },
      )
    }
    if (loc.orders_from) out.push({ route: '/order', label: 'Order from ' + loc.orders_from, icon: 'lucide-square-plus' })
    out.push(
      { route: '/list/incoming', label: 'Receive', icon: 'lucide-inbox' },
      { route: '/returns', label: 'Returns', icon: 'lucide-undo-2' },
      { route: '/inventory', label: 'Inventory', icon: 'lucide-clipboard-list' },
    )
  }
  if (state.ctx && state.ctx.is_buyer) out.push({ section: 'Procurement', key: 's1' }, { route: '/buy', label: 'To buy', icon: 'lucide-shopping-cart' })
  if (state.ctx && state.ctx.is_admin) out.push({ section: 'Management', key: 's2' }, { route: '/reports', label: 'Reports', icon: 'lucide-chart-column' })
  return out
})
</script>
