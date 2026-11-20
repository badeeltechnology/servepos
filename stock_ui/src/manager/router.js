import { createRouter, createWebHistory } from 'vue-router'
import { state, loadContext } from './state'

// One app for the whole back office. meta.view: sales screens (ServePOS Manager or Reporter);
// meta.manager: setup screens (ServePOS Manager); meta.stock: stock screens, which check the
// user's outlet or kitchen on the server like before.
const view = { view: true }
const manager = { view: true, manager: true }
const stock = { stock: true }
const s = (path, name, page, meta = stock) => ({ path: '/stock' + path, name: 'stock-' + name, component: () => import(`../pages/${page}.vue`), meta })

const routes = [
  { path: '/', name: 'today', component: () => import('./pages/Today.vue'), meta: view },
  { path: '/sales', name: 'sales', component: () => import('./pages/Sales.vue'), meta: view },
  { path: '/items', name: 'items', component: () => import('./pages/Items.vue'), meta: manager },
  { path: '/items/:name', name: 'item', component: () => import('./pages/ItemPage.vue'), props: true, meta: manager },
  { path: '/modifiers', name: 'modifiers', component: () => import('./pages/Modifiers.vue'), meta: manager },
  { path: '/floor', name: 'floor', component: () => import('./pages/Floor.vue'), meta: manager },
  { path: '/floor/qr', name: 'qr', component: () => import('./pages/QrSheet.vue'), meta: manager },
  { path: '/staff', name: 'staff', component: () => import('./pages/Staff.vue'), meta: manager },
  { path: '/offers', name: 'offers', component: () => import('./pages/Offers.vue'), meta: manager },
  { path: '/day-close', name: 'day-close', component: () => import('./pages/DayClose.vue'), meta: manager },
  { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue'), meta: manager },

  { path: '/stock', name: 'stock', component: () => import('../pages/Start.vue'), meta: stock },
  s('/home', 'home', 'Home'),
  s('/order/:provider?', 'order', 'OrderForm'),
  s('/o/:name', 'order-view', 'OrderView'),
  s('/list/:view', 'list', 'OrderList'),
  s('/transfers', 'transfers', 'Transfers'),
  s('/returns', 'returns', 'Returns'),
  s('/emergency/:provider?', 'emergency', 'Emergency'),
  s('/send', 'send', 'Send'),
  s('/inventory', 'inventory', 'Inventory'),
  s('/picking', 'picking', 'Picking'),
  s('/buy', 'buy', 'ToBuy'),
  s('/reports', 'reports', 'Reports'),
  { path: '/:p(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory('/manage'), routes })

router.beforeEach(async (to) => {
  if (!state.ctx && !state.error) await loadContext()
  if (!state.ctx) return
  // stock-only users (outlet staff, kitchens, buyers) open straight on their stock screens
  if (to.meta.view && !state.ctx.is_viewer) return '/stock'
  if (to.meta.manager && !state.ctx.is_manager) return '/sales'
})

export default router
