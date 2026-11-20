import { reactive } from 'vue'
import { getContext, get } from './api'

const KEY = 'servepos-manage-outlet'
export const state = reactive({ ctx: null, setup: null, outlet: '', loading: true, error: null })

export async function loadContext() {
  state.loading = true
  try {
    state.ctx = await getContext()
    if (state.ctx && state.ctx.is_manager) state.setup = await get('admin.get_setup')
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

export async function reloadSetup() {
  state.setup = await get('admin.get_setup')
}

/** '' = all outlets. Remembered per browser. */
export function setOutlet(name) {
  state.outlet = name || ''
  try { localStorage.setItem(KEY, state.outlet) } catch (e) {}
}

export const outletOptions = (all = 'All outlets') => [
  ...(all ? [{ label: all, value: '' }] : []),
  ...((state.ctx && state.ctx.profiles) || []).map((p) => ({ label: p.name, value: p.name })),
]
