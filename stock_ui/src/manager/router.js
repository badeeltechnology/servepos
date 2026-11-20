import { createRouter, createWebHistory } from 'vue-router'
import { state, loadContext } from './state'

const routes = [
  { path: '/', name: 'today', component: () => import('./pages/Today.vue') },
  { path: '/:p(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory('/manage'), routes })

router.beforeEach(async () => {
  if (!state.ctx && !state.error) await loadContext()
})

export default router
