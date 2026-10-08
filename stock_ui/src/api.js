// Data access for the Stock Orders screens. Reads and writes go through frappe-ui's useCall
// against the v2 method API; formatting helpers live here too.
import { useCall } from 'frappe-ui'

const BASE = '/api/v2/method/servepos.stock_orders.api.'

/** A read that loads on mount and reloads when its params change. */
export function useRead(method, params, opts = {}) {
  return useCall({ url: BASE + method, params, refetch: true, ...opts })
}

/** A write: nothing is sent until `await w.submit(params)`, which throws on a server error. */
export function useWrite(method, opts = {}) {
  return useCall({ url: BASE + method, method: 'POST', immediate: false, ...opts })
}

/** The server's own message without the "ValidationError: " prefix. */
export function errText(e) {
  const m = (e && e.message) || String(e || 'Something went wrong')
  return m.replace(/^[A-Za-z]*(Error|Exception):\s*/, '').replace(/<[^>]+>/g, '')
}

/** Bootstrap call made before any page mounts (router guard). */
export async function getContext() {
  const res = await fetch(BASE + 'get_context', { headers: { Accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/login?redirect-to=' + encodeURIComponent(window.location.pathname)
    return null
  }
  const body = await res.json()
  if (!res.ok) throw new Error(errText({ message: body.errors?.[0]?.message || 'Could not load' }))
  return body.data
}

export function fmt(n, d = 3) {
  if (n === null || n === undefined || n === '') return ''
  const v = Math.round(Number(n) * 10 ** d) / 10 ** d
  return v.toLocaleString('en', { maximumFractionDigits: d })
}

export function fmtDate(s) {
  if (!s) return ''
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function fmtTime(s) {
  if (!s) return ''
  const d = new Date(String(s).replace(' ', 'T'))
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const who = (u) => (u ? String(u).split('@')[0] : '')
export const blank = (v) => v === '' || v === null || v === undefined

// search box filter: every word must appear in one of the values (case-insensitive)
export function matches(q, ...values) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = values.map((v) => String(v ?? '')).join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}
