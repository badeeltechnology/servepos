<template>
  <FrappeUIProvider>
    <div class="h-screen w-full bg-surface-base text-ink-gray-8">
      <div v-if="state.loading" class="flex h-full items-center justify-center"><LoadingText text="Opening ServePOS…" /></div>
      <div v-else-if="state.error" class="p-8"><ErrorMessage :message="state.error" /></div>
      <DesktopShell v-else>
        <template #sidebar>
          <Sidebar width="14rem" v-model:collapsed="collapsed" class="border-r border-outline-gray-1">
            <SidebarHeader :title="header.title" :subtitle="header.subtitle" :menu-items="menu">
              <template #prefix>
                <div class="flex size-full items-center justify-center text-xs-semibold text-white" :style="{ background: header.color }">{{ header.initials }}</div>
              </template>
            </SidebarHeader>
            <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
              <div class="space-y-0.5">
                <template v-for="item in nav" :key="item.key || item.route">
                  <SidebarLabel v-if="item.section" divider class="pt-3">{{ item.section }}</SidebarLabel>
                  <SidebarItem v-else :label="item.label" :icon="item.icon" :route="item.route" :active="isActive(item.route)" />
                </template>
              </div>
            </ScrollArea>
            <div class="space-y-0.5 border-t border-outline-gray-1 px-2 py-2">
              <SidebarItem v-if="state.ctx.is_manager" label="Settings" icon="lucide-settings" route="/settings" :active="isActive('/settings')" />
              <SidebarCollapseToggle />
            </div>
          </Sidebar>
        </template>

        <div v-if="$route.meta.stock && !stock.location && !(stock.ctx && stock.ctx.is_buyer)" class="px-5 pt-10">
          <Alert theme="amber" title="No outlet assigned" description="Your user has no outlet or kitchen. Ask the administrator to add a User Permission on your warehouse." />
        </div>
        <router-view v-else :key="($route.meta.stock && stock.location ? stock.location.name : '') + $route.fullPath" />
      </DesktopShell>
    </div>
  </FrappeUIProvider>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Alert, DesktopShell, ErrorMessage, FrappeUIProvider, LoadingText, ScrollArea, Sidebar, SidebarCollapseToggle, SidebarHeader, SidebarItem, SidebarLabel } from 'frappe-ui'
import { state, switchLocation } from './state'
import { state as stock, myLocations, isProvider, shipsHere } from '../state'

const route = useRoute()
const router = useRouter()
// icons only on tablets, full labels on wide screens; the toggle at the bottom switches it
const collapsed = ref(window.innerWidth < 1280)

const viewer = computed(() => !!state.ctx.is_viewer)
const loc = computed(() => stock.location)

// Managers see the business; outlet and kitchen staff see their own place, as before.
const header = computed(() => {
  if (viewer.value || !loc.value) {
    return { title: 'ServePOS', subtitle: state.ctx.company || 'Back office', color: '#525252', initials: 'SP' }
  }
  const l = loc.value
  return {
    title: l.name,
    subtitle: l.location_group || (isProvider.value ? 'Provider' : 'Outlet'),
    color: l.color || '#525252',
    initials: l.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
  }
})

function isActive(r) {
  if (r === '/') return route.path === '/'
  return route.path === r || route.path.startsWith(r + '/')
}

async function logout() {
  await fetch('/api/method/logout', { method: 'POST', headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' } })
  window.location.href = '/login'
}

const menu = computed(() => {
  const out = []
  if (myLocations.value.length > 1) {
    out.push({
      group: 'Switch outlet',
      options: myLocations.value.map((l) => ({
        label: l.name,
        icon: l.location_type === 'Provider' ? 'lucide-chef-hat' : 'lucide-store',
        selected: !!loc.value && l.name === loc.value.name,
        onClick: () => {
          switchLocation(l)
          if (route.meta.stock) router.push('/stock')
        },
      })),
    })
  }
  if (state.ctx.desk) out.push({ label: 'Open ERPNext desk', icon: 'lucide-app-window', onClick: () => (window.location.href = '/app') })
  out.push({ label: 'Log out ' + (state.ctx.full_name || ''), icon: 'lucide-log-out', onClick: logout })
  return out
})

/** Stock screens for the current outlet or kitchen. */
function stockItems(l) {
  const today = { route: '/stock/home', label: viewer.value ? 'Stock today' : 'Today', icon: viewer.value ? 'lucide-package' : 'lucide-house' }
  if (!isProvider.value) {
    return [
      today,
      { route: '/stock/order', label: 'New order', icon: 'lucide-square-plus' },
      { route: '/stock/emergency', label: 'Emergency order', icon: 'lucide-siren' },
      { route: '/stock/list/incoming', label: 'Receive', icon: 'lucide-inbox' },
      { route: '/stock/transfers', label: 'Transfers', icon: 'lucide-arrow-left-right' },
      { route: '/stock/send', label: 'Send stock', icon: 'lucide-send' },
      { route: '/stock/returns', label: 'Returns', icon: 'lucide-undo-2' },
      { route: '/stock/inventory', label: 'Inventory count', icon: 'lucide-clipboard-list' },
      { route: '/stock/list/history', label: 'Order history', icon: 'lucide-history' },
    ]
  }
  const out = [today]
  if (shipsHere.value) {
    out.push(
      { route: '/stock/picking', label: 'Picking sheet', icon: 'lucide-table-2' },
      { route: '/stock/list/to_ship', label: 'To ship', icon: 'lucide-truck' },
      { route: '/stock/send', label: 'Send stock', icon: 'lucide-send' },
      { route: '/stock/list/discrepancies', label: 'Discrepancies', icon: 'lucide-triangle-alert' },
    )
  }
  if (l.orders_from) out.push({ route: '/stock/order', label: 'Order from ' + l.orders_from, icon: 'lucide-square-plus' })
  out.push(
    { route: '/stock/list/incoming', label: 'Receive', icon: 'lucide-inbox' },
    { route: '/stock/returns', label: 'Returns', icon: 'lucide-undo-2' },
    { route: '/stock/inventory', label: 'Inventory count', icon: 'lucide-clipboard-list' },
  )
  return out
}

const nav = computed(() => {
  const out = []
  const m = state.ctx.is_manager
  if (viewer.value) out.push({ route: '/', label: 'Today', icon: 'lucide-house' })
  if (m) {
    out.push(
      { section: 'Menu', key: 'menu' },
      { route: '/items', label: 'Menu items', icon: 'lucide-utensils' },
      { route: '/modifiers', label: 'Modifiers', icon: 'lucide-list-plus' },
      { route: '/offers', label: 'Promos and vouchers', icon: 'lucide-ticket-percent' },
      { section: 'Restaurant', key: 'rest' },
      { route: '/floor', label: 'Tables and rooms', icon: 'lucide-armchair' },
      { route: '/staff', label: 'Waiters', icon: 'lucide-users' },
    )
  }
  if (loc.value || m) {
    // the section is named after the place, so it is clear whose stock this is
    if (viewer.value) out.push({ section: loc.value ? 'Stock · ' + loc.value.name : 'Stock', key: 'stock' })
    if (loc.value) out.push(...stockItems(loc.value))
    if (m) out.push({ route: '/day-close', label: 'Day close', icon: 'lucide-calendar-check' })
  }
  if (stock.ctx && stock.ctx.is_buyer) out.push({ section: 'Buying', key: 'buy' }, { route: '/stock/buy', label: 'To buy', icon: 'lucide-shopping-cart' })
  const reports = []
  if (viewer.value) reports.push({ route: '/sales', label: 'Sales', icon: 'lucide-chart-column' })
  if (stock.ctx && stock.ctx.is_admin) reports.push({ route: '/stock/reports', label: 'Stock and markup', icon: 'lucide-chart-pie' })
  if (reports.length) out.push({ section: 'Reports', key: 'rep' }, ...reports)
  return out
})
</script>
