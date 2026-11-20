// Data access for the manager screens. Methods are named from servepos.api, e.g. 'admin.list_items'.
import { useCall, toast } from 'frappe-ui'
import { errText } from '../api'

const BASE = '/api/v2/method/servepos.api.'

/** A read that loads on mount and reloads when its params change. */
export function useRead(method, params, opts = {}) {
  return useCall({ url: BASE + method, params, refetch: true, ...opts })
}

/** One-off POST; throws with the server's message. */
export async function post(method, params = {}) {
  const body = {}
  for (const [k, v] of Object.entries(params)) body[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  const res = await fetch(BASE + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token || '' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(errText({ message: j.errors?.[0]?.message || j.exception || 'Something went wrong' }))
  return j.data
}

/** One-off GET. */
export async function get(method, params = {}) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, typeof v === 'object' ? JSON.stringify(v) : v)
  const res = await fetch(BASE + method + '?' + q, { headers: { Accept: 'application/json' } })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(errText({ message: j.errors?.[0]?.message || 'Could not load' }))
  return j.data
}

/** Run a write, toast the result or the error. Returns the result or undefined on error. */
export async function act(fn, ok) {
  try {
    const r = await fn()
    if (ok) toast.success(typeof ok === 'function' ? ok(r) : ok)
    return r ?? true
  } catch (e) {
    toast.error(errText(e))
  }
}

export async function getContext() {
  const res = await fetch(BASE + 'manager.get_context', { headers: { Accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/login?redirect-to=' + encodeURIComponent(window.location.pathname)
    return null
  }
  const body = await res.json()
  if (!res.ok) throw new Error(errText({ message: body.errors?.[0]?.message || 'Could not load' }))
  return body.data
}

export function money(v, cur = '') {
  const s = Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return cur ? `${cur} ${s}` : s
}

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

/** Date helpers on the site's "today" (never the browser's UTC date). */
export function shiftDate(iso, days) {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() + days)
  return x.toISOString().slice(0, 10)
}
