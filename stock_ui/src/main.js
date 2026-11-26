import { createApp } from 'vue'
import './index.css'
import App from './manager/App.vue'
import router from './manager/router.js'

// One back-office app at /manage: sales, menu, restaurant setup and stock.
createApp(App).use(router).mount('#app')
