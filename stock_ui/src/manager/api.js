// Data access for the manager screens (servepos.api.manager), in the same style as ../api.js.
import { useCall } from 'frappe-ui'
import { errText } from '../api'

const BASE = '/api/v2/method/servepos.api.manager.'

export function useRead(method, params, opts = {}) {
  return useCall({ url: BASE + method, params, refetch: true, ...opts })
}

export async function getContext() {
  const res = await fetch(BASE + 'get_context', { headers: { Accept: 'application/json' } })
  if (res.status === 401) {
    window.location.href = '/login?redirect-to=' + encodeURIComponent(window.location.pathname)
    return null
  }
  const body = await res.json()
  if (!res.ok) throw new Error(errText({ message: body.errors?.[0]?.message || 'Could not load' }))
  return body.data
}

/** Money with the company currency, two decimals. */
export function money(v, cur = '') {
  const s = Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return cur ? `${cur} ${s}` : s
}

/** "5 min ago", "3 h ago", "2 days ago" from a server datetime (site time). */
export function ago(s, nowStr) {
  if (!s) return ''
  const t = new Date(String(s).replace(' ', 'T')).getTime()
  const now = nowStr ? new Date(String(nowStr).replace(' ', 'T')).getTime() : Date.now()
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
