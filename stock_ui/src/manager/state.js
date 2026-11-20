import { reactive } from 'vue'
import { getContext } from './api'

const KEY = 'servepos-manage-outlet'
export const state = reactive({ ctx: null, outlet: '', loading: true, error: null })

export async function loadContext() {
  state.loading = true
  try {
    state.ctx = await getContext()
    let saved = ''
    try { saved = localStorage.getItem(KEY) || '' } catch (e) {}
    state.outlet = state.ctx && state.ctx.profiles.some((p) => p.name === saved) ? saved : ''
    state.error = null
  } catch (e) {
    state.error = e.message
  } finally {
    state.loading = false
  }
}

/** '' = all outlets. Remembered per browser. */
export function setOutlet(name) {
  state.outlet = name || ''
  try { localStorage.setItem(KEY, state.outlet) } catch (e) {}
}
