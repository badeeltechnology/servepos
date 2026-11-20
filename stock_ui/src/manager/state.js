import { reactive } from 'vue'
import { getContext, get } from './api'
import { state as stock, loadContext as loadStock, setLocation, myLocations } from '../state'

const KEY = 'servepos-manage-outlet'
export const state = reactive({ ctx: null, setup: null, outlet: '', loading: true, error: null })

/** Loads who is signed in for both halves of the app: sales and menu (this module) and stock (../state). */
export async function loadContext() {
  state.loading = true
  try {
    const [ctx] = await Promise.all([getContext(), loadStock()])
    state.ctx = ctx
    if (!ctx) return
    if (stock.error) throw new Error(stock.error)
    if (ctx.is_manager) state.setup = await get('admin.get_setup')
    let saved = ''
    try { saved = localStorage.getItem(KEY) || '' } catch (e) {}
    state.outlet = ctx.profiles.some((p) => p.name === saved) ? saved : ''
    if (ctx.is_viewer) pickStockPlace(ctx)
    state.error = null
  } catch (e) {
    state.error = e.message
  } finally {
    state.loading = false
  }
}

/** Managers: the stock screens follow the chosen outlet; with all outlets and no earlier choice,
 * start on the first outlet rather than a kitchen (kitchen staff keep landing on their kitchen). */
function pickStockPlace(ctx) {
  const p = ctx.profiles.find((x) => x.name === state.outlet)
  const loc = locationOf(p)
  if (loc) return setLocation(loc)
  let remembered = null
  try { remembered = localStorage.getItem('servepos-stock-location:' + ctx.user) } catch (e) {}
  if (!remembered && stock.ctx && stock.ctx.outlets.length) setLocation(stock.ctx.outlets[0])
}

export async function reloadSetup() {
  state.setup = await get('admin.get_setup')
}

const profileOf = (loc) => loc && ((state.ctx && state.ctx.profiles) || []).find((p) => p.warehouse && p.warehouse === loc.warehouse)
const locationOf = (profile) => profile && myLocations.value.find((l) => l.warehouse && l.warehouse === profile.warehouse)

/** One outlet for the whole app: '' = all outlets (sales screens). Picking an outlet also moves the
 * stock screens to that outlet's stock location, so sales and stock always talk about the same place. */
export function setOutlet(name) {
  state.outlet = name || ''
  try { localStorage.setItem(KEY, state.outlet) } catch (e) {}
  const p = ((state.ctx && state.ctx.profiles) || []).find((x) => x.name === state.outlet)
  const loc = locationOf(p)
  if (loc && (!stock.location || stock.location.name !== loc.name)) setLocation(loc)
}

/** Switching the stock location from the sidebar also filters the sales screens to that outlet. */
export function switchLocation(loc) {
  setLocation(loc)
  const p = profileOf(loc)
  if (p) {
    state.outlet = p.name
    try { localStorage.setItem(KEY, p.name) } catch (e) {}
  }
}

export const outletOptions = (all = 'All outlets') => [
  ...(all ? [{ label: all, value: '' }] : []),
  ...((state.ctx && state.ctx.profiles) || []).map((p) => ({ label: p.name, value: p.name })),
]
