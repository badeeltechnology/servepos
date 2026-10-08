import { createRouter, createWebHistory } from 'vue-router'
import { state, loadContext } from './state'

const routes = [
  { path: '/', name: 'start', component: () => import('./pages/Start.vue') },
  { path: '/home', name: 'home', component: () => import('./pages/Home.vue') },
  { path: '/order/:provider?', name: 'order', component: () => import('./pages/OrderForm.vue') },
  { path: '/o/:name', name: 'order-view', component: () => import('./pages/OrderView.vue') },
  { path: '/list/:view', name: 'list', component: () => import('./pages/OrderList.vue') },
  { path: '/transfers', name: 'transfers', component: () => import('./pages/Transfers.vue') },
  { path: '/returns', name: 'returns', component: () => import('./pages/Returns.vue') },
  { path: '/send', name: 'send', component: () => import('./pages/Send.vue') },
  { path: '/inventory', name: 'inventory', component: () => import('./pages/Inventory.vue') },
  { path: '/picking', name: 'picking', component: () => import('./pages/Picking.vue') },
  { path: '/buy', name: 'buy', component: () => import('./pages/ToBuy.vue') },
  { path: '/reports', name: 'reports', component: () => import('./pages/Reports.vue') },
  { path: '/:p(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory('/stock'), routes })

router.beforeEach(async () => {
  if (!state.ctx && !state.error) await loadContext()
})

export default router
