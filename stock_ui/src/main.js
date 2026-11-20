import { createApp } from 'vue'
import './index.css'

// One bundle, two apps: /manage is the manager app, everything else is Stock Orders.
const path = window.location.pathname
const isManager = path === '/manage' || path.startsWith('/manage/')

const load = isManager
  ? Promise.all([import('./manager/App.vue'), import('./manager/router.js')])
  : Promise.all([import('./App.vue'), import('./router.js')])

load.then(([{ default: App }, { default: router }]) => createApp(App).use(router).mount('#app'))
