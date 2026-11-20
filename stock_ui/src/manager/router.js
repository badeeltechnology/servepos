import { createRouter, createWebHistory } from 'vue-router'
import { state, loadContext } from './state'

const manager = { manager: true }
const routes = [
  { path: '/', name: 'today', component: () => import('./pages/Today.vue') },
  { path: '/sales', name: 'sales', component: () => import('./pages/Sales.vue') },
  { path: '/items', name: 'items', component: () => import('./pages/Items.vue'), meta: manager },
  { path: '/items/:name', name: 'item', component: () => import('./pages/ItemPage.vue'), props: true, meta: manager },
  { path: '/modifiers', name: 'modifiers', component: () => import('./pages/Modifiers.vue'), meta: manager },
  { path: '/floor', name: 'floor', component: () => import('./pages/Floor.vue'), meta: manager },
  { path: '/floor/qr', name: 'qr', component: () => import('./pages/QrSheet.vue'), meta: manager },
  { path: '/staff', name: 'staff', component: () => import('./pages/Staff.vue'), meta: manager },
  { path: '/offers', name: 'offers', component: () => import('./pages/Offers.vue'), meta: manager },
  { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue'), meta: manager },
  { path: '/:p(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory('/manage'), routes })

router.beforeEach(async (to) => {
  if (!state.ctx && !state.error) await loadContext()
  // reporters see Today and Sales only
  if (to.meta.manager && state.ctx && !state.ctx.is_manager) return '/sales'
})

export default router
