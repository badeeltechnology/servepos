import { reactive, computed } from 'vue'
import { getContext } from './api'

const KEY = 'servepos-stock-location'
const key = () => KEY + ':' + ((state.ctx && state.ctx.user) || '')
function remember(v) { try { localStorage.setItem(key(), v) } catch (e) {} }
function recall() { try { return localStorage.getItem(key()) } catch (e) { return null } }

export const state = reactive({ ctx: null, location: null, loading: true, error: null })

export async function loadContext() {
  state.loading = true
  try {
    state.ctx = await getContext()
    if (!state.ctx) return
    const mine = [...state.ctx.my_providers, ...state.ctx.outlets]
    const saved = recall()
    state.location = mine.find((l) => l.name === saved) || mine[0] || null
    state.error = null
  } catch (e) {
    state.error = e.message
  } finally {
    state.loading = false
  }
}

export function setLocation(loc) {
  state.location = loc
  remember(loc.name)
}

export const myLocations = computed(() => (state.ctx ? [...state.ctx.my_providers, ...state.ctx.outlets] : []))
export const isProvider = computed(() => !!state.location && state.location.location_type === 'Provider')
export const shipsHere = computed(() => !!(state.ctx && state.location && state.ctx.ships_for.includes(state.location.name)))
export const providerColor = (name) => {
  const p = state.ctx && state.ctx.providers.find((x) => x.name === name)
  return (p && p.color) || '#7C7C7C'
}
