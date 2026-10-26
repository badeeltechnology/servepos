import { useEffect, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Power,
  RefreshCw,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

/**
 * Waiter app logins
 * -----------------
 * Managers create and manage the username + password each waiter uses in the
 * Waiter App, without creating ERPNext Users by hand (no email needed).
 * Backend: servepos.api.mobile.admin
 */

const API = "servepos.api.mobile.admin";

export interface LoginSummary {
  user: string;
  username: string;
  user_enabled: number;
  last_login?: string | null;
  devices: number;
}

interface Device {
  name: string;
  device_name?: string;
  platform?: string;
  app_version?: string;
  last_seen?: string;
  created_on?: string;
}

interface LoginStatus {
  has_login: boolean;
  user?: string;
  username?: string;
  email?: string | null;
  user_enabled?: number;
  has_role?: boolean;
  last_login?: string | null;
  devices: Device[];
}

export function useAppLoginOverview() {
  const { data, mutate } = useFrappeGetCall<{ message: Record<string, LoginSummary> }>(
    `${API}.app_login_overview`,
    undefined,
    undefined,
    { revalidateOnFocus: false },
  );
  return { logins: data?.message || {}, refresh: mutate };
}

export function errorText(e: any, fallback = "Something went wrong"): string {
  try {
    if (e?._server_messages) {
      const msgs = JSON.parse(e._server_messages).map((m: string) => {
        try {
          return JSON.parse(m).message;
        } catch {
          return m;
        }
      });
      const text = msgs.filter(Boolean).join(" ").replace(/<[^>]+>/g, "");
      if (text) return text;
    }
  } catch {
    /* fall through */
  }
  if (e?.exception) return String(e.exception).replace(/^[\w.]+(Error|Exception):\s*/, "");
  return e?.message || fallback;
}

export function slugifyUsername(name: string): string {
  const base = (name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
  return base.length >= 3 ? base : base ? `${base}.waiter` : "waiter";
}

const PW_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
export function generatePassword(len = 8): string {
  const out: string[] = [];
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out.push(PW_CHARS[buf[i] % PW_CHARS.length]);
  // keep at least one digit so it reads as a password, not a word
  if (!out.some((c) => /\d/.test(c))) out[len - 1] = "23456789"[buf[0] % 8];
  return out.join("");
}

function serverUrl(siteUrl?: string): string {
  const origin = window.location.origin;
  const local = /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  return local && siteUrl ? siteUrl : origin;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function fmt(dt?: string | null): string {
  if (!dt) return "never";
  const d = new Date(dt.replace(" ", "T"));
  if (isNaN(d.getTime())) return dt;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ---- Row cell ----------------------------------------------------------------

export function AppLoginCell({
  waiter,
  login,
  onOpen,
}: {
  waiter: any;
  login?: LoginSummary;
  onOpen: () => void;
}) {
  if (!login) {
    return (
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700"
        title={`Create an app login for ${waiter.waiter_name}`}
      >
        <UserPlus className="h-3 w-3" /> Create login
      </button>
    );
  }
  const enabled = !!login.user_enabled;
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-gray-100"
      title="Manage app login"
    >
      <span className="font-mono text-[12px] text-gray-700">{login.username}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          enabled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"
        }`}
      >
        {enabled ? "Active" : "Disabled"}
      </span>
      <span
        className="inline-flex items-center gap-0.5 text-[11px] text-gray-400"
        title={`${login.devices} phone(s) signed in`}
      >
        <Smartphone className="h-3 w-3" />
        {login.devices}
      </span>
    </button>
  );
}

// ---- Dialog ----------------------------------------------------------------------

type Mode = "manage" | "create" | "reset" | "created";
type Confirm = null | "revoke" | "disable" | "remove";

export function AppLoginDialog({
  waiter,
  onClose,
  onChanged,
}: {
  waiter: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, mutate, isLoading } = useFrappeGetCall<{ message: LoginStatus }>(
    `${API}.app_login_status`,
    { waiter: waiter.name },
    `app_login_status_${waiter.name}`,
    { revalidateOnFocus: false },
  );
  const status = data?.message;

  const { call: createLogin } = useFrappePostCall(`${API}.create_app_login`);
  const { call: resetPassword } = useFrappePostCall(`${API}.reset_app_password`);
  const { call: setEnabled } = useFrappePostCall(`${API}.set_app_login_enabled`);
  const { call: revokeDevices } = useFrappePostCall(`${API}.revoke_app_devices`);
  const { call: removeLogin } = useFrappePostCall(`${API}.remove_app_login`);

  const [mode, setMode] = useState<Mode | null>(null);
  const [username, setUsername] = useState(slugifyUsername(waiter.waiter_name));
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(true);
  const [signOut, setSignOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [credentials, setCredentials] = useState<{ url: string; username: string; password: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  // initial mode once status is known
  useEffect(() => {
    if (status && mode === null) {
      setMode(status.has_login ? "manage" : "create");
      if (!status.has_login) setPassword(generatePassword());
    }
  }, [status, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function run(fn: () => Promise<any>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fn();
      if (success) setNotice(success);
      await mutate();
      onChanged();
      return res;
    } catch (e: any) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  function pwProblem(): string {
    if (password.length < 6) return "At least 6 characters";
    if (password.trim() !== password) return "No spaces at the start or end";
    const u = mode === "create" ? username : status?.username || "";
    if (u && password.toLowerCase() === u.toLowerCase()) return "Must differ from the username";
    return "";
  }
  const usernameProblem = /^[a-z0-9._-]{3,30}$/.test(username)
    ? ""
    : "3 to 30 characters: a-z, 0-9, dot, dash, underscore";

  async function handleCreate() {
    if (usernameProblem || pwProblem()) return;
    const res: any = await run(() =>
      createLogin({ waiter: waiter.name, username, password }),
    );
    const msg = res?.message;
    if (msg) {
      setCredentials({ url: serverUrl(msg.site_url), username: msg.username, password });
      setMode("created");
    }
  }

  async function handleReset() {
    if (pwProblem()) return;
    const res: any = await run(() =>
      resetPassword({ waiter: waiter.name, password, sign_out_devices: signOut ? 1 : 0 }),
    );
    if (res) {
      setCredentials({ url: serverUrl(), username: status?.username || "", password });
      setMode("created");
    }
  }

  async function handleCopy() {
    if (!credentials) return;
    const text = `Waiter App login for ${waiter.waiter_name}\nServer URL: ${credentials.url}\nUsername: ${credentials.username}\nPassword: ${credentials.password}`;
    const ok = await copyText(text);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
    else setError("Could not copy. Select the text and copy it by hand.");
  }

  const inputCls =
    "w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] focus:border-gray-400 focus:outline-none";
  const labelCls = "mb-1 block text-[12px] font-medium text-gray-500";
  const primaryBtn =
    "rounded-md bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800 disabled:opacity-50";
  const ghostBtn =
    "rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50";

  const passwordField = (
    <div>
      <label className={labelCls}>{mode === "reset" ? "New password" : "Password"}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} pr-9 font-mono`}
            autoComplete="new-password"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600"
            title={showPw ? "Hide" : "Show"}
          >
            {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setPassword(generatePassword());
            setShowPw(true);
          }}
          className="flex items-center gap-1 rounded-md border border-gray-200 px-3 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3 w-3" /> Generate
        </button>
      </div>
      <p className={`mt-1 text-[11px] ${password && pwProblem() ? "text-red-500" : "text-gray-400"}`}>
        {(password && pwProblem()) || "At least 6 characters. Simple starter passwords are allowed."}
      </p>
    </div>
  );

  const confirmText: Record<Exclude<Confirm, null>, { title: string; body: string; action: string }> = {
    revoke: {
      title: "Sign out all phones?",
      body: `Every phone signed in as ${status?.username} is logged out. The waiter can sign in again with the same password.`,
      action: "Sign out all",
    },
    disable: {
      title: "Disable this login?",
      body: `${waiter.waiter_name} cannot sign in to the Waiter App until you enable it again. Phones signed in now are logged out.`,
      action: "Disable",
    },
    remove: {
      title: "Remove this login?",
      body: `The login is unlinked from ${waiter.waiter_name}, disabled and its phones are logged out. The user record is kept for the audit trail and the username becomes free again.`,
      action: "Remove login",
    },
  };

  async function doConfirm() {
    if (confirm === "revoke") {
      await run(() => revokeDevices({ waiter: waiter.name }), "All phones were signed out.");
    } else if (confirm === "disable") {
      await run(() => setEnabled({ waiter: waiter.name, enabled: 0 }), "Login disabled.");
    } else if (confirm === "remove") {
      const res = await run(() => removeLogin({ waiter: waiter.name }));
      if (res) {
        setMode("create");
        setUsername(slugifyUsername(waiter.waiter_name));
        setPassword(generatePassword());
        setNotice("Login removed. You can create a new one.");
      }
    }
  }

  const enabled = !!status?.user_enabled;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && mode !== "created") onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white">
              <Smartphone className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-gray-900">Waiter App login</h2>
              <p className="text-[11px] text-gray-500">{waiter.waiter_name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="flex items-center justify-center rounded-md border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>
          )}
          {notice && !error && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{notice}</div>
          )}

          {(isLoading || mode === null) && (
            <p className="py-6 text-center text-[13px] text-gray-400">Loading...</p>
          )}

          {/* ---- create ---- */}
          {mode === "create" && (
            <>
              <p className="text-[12px] text-gray-500">
                Create the username and password {waiter.waiter_name} will use in the Waiter App. No email is
                needed.
              </p>
              <div>
                <label className={labelCls}>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, "."))}
                  className={`${inputCls} font-mono`}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={30}
                />
                <p className={`mt-1 text-[11px] ${usernameProblem ? "text-red-500" : "text-gray-400"}`}>
                  {usernameProblem || "Must be unique. The waiter types this on the phone."}
                </p>
              </div>
              {passwordField}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} className={ghostBtn} disabled={busy}>
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className={primaryBtn}
                  disabled={busy || !!usernameProblem || !!pwProblem()}
                >
                  {busy ? "Creating..." : "Create login"}
                </button>
              </div>
            </>
          )}

          {/* ---- reset ---- */}
          {mode === "reset" && (
            <>
              <p className="text-[12px] text-gray-500">
                Set a new password for <span className="font-mono">{status?.username}</span>.
              </p>
              {passwordField}
              <label className="flex items-center gap-2 text-[12px] text-gray-600">
                <input type="checkbox" checked={signOut} onChange={(e) => setSignOut(e.target.checked)} />
                Sign out all phones now
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setMode("manage")} className={ghostBtn} disabled={busy}>
                  Back
                </button>
                <button onClick={handleReset} className={primaryBtn} disabled={busy || !!pwProblem()}>
                  {busy ? "Saving..." : "Set password"}
                </button>
              </div>
            </>
          )}

          {/* ---- credentials card ---- */}
          {mode === "created" && credentials && (
            <>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="mb-3 text-[12px] font-semibold text-emerald-800">Give the waiter:</p>
                <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
                  <dt className="text-gray-500">Server URL</dt>
                  <dd className="break-all font-mono text-gray-900">{credentials.url}</dd>
                  <dt className="text-gray-500">Username</dt>
                  <dd className="font-mono text-gray-900">{credentials.username}</dd>
                  <dt className="text-gray-500">Password</dt>
                  <dd className="font-mono text-gray-900">{credentials.password}</dd>
                </dl>
                <button
                  onClick={handleCopy}
                  className="mt-4 flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[11px] text-amber-700">
                The password is shown only now. If it is lost, use Reset password.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setCredentials(null);
                    setPassword("");
                    setMode("manage");
                  }}
                  className={primaryBtn}
                >
                  Done
                </button>
              </div>
            </>
          )}

          {/* ---- manage ---- */}
          {mode === "manage" && status?.has_login && (
            <>
              <div className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
                <span className="text-gray-500">Username</span>
                <span className="font-mono text-gray-900">{status.username}</span>
                <span className="text-gray-500">Status</span>
                <span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      enabled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"
                    }`}
                  >
                    {enabled ? "Active" : "Disabled"}
                  </span>
                  {waiter.is_active === 0 && (
                    <span className="ml-2 text-[11px] text-amber-700">Waiter is inactive: login is refused</span>
                  )}
                  {status.has_role === false && (
                    <span className="ml-2 text-[11px] text-amber-700">Missing ServePOS Waiter role</span>
                  )}
                </span>
                <span className="text-gray-500">Last login</span>
                <span className="text-gray-700">{fmt(status.last_login)}</span>
              </div>

              <div>
                <p className="mb-1.5 text-[12px] font-medium text-gray-500">
                  Phones signed in ({status.devices.length})
                </p>
                {status.devices.length === 0 ? (
                  <p className="rounded-md bg-gray-50 px-3 py-2 text-[12px] text-gray-400">No phones signed in</p>
                ) : (
                  <ul className="divide-y rounded-md border border-gray-200">
                    {status.devices.map((d) => (
                      <li key={d.name} className="flex items-center justify-between px-3 py-2 text-[12px]">
                        <span className="flex items-center gap-2 text-gray-700">
                          <Smartphone className="h-3.5 w-3.5 text-gray-400" />
                          {d.device_name || "Phone"}
                          {d.platform && <span className="text-gray-400">({d.platform})</span>}
                        </span>
                        <span className="text-gray-400">seen {fmt(d.last_seen)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {confirm ? (
                <div className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                  <p className="text-[13px] font-semibold text-gray-900">{confirmText[confirm].title}</p>
                  <p className="mt-1 text-[12px] text-gray-600">{confirmText[confirm].body}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button onClick={() => setConfirm(null)} className={ghostBtn} disabled={busy}>
                      Cancel
                    </button>
                    <button
                      onClick={doConfirm}
                      disabled={busy}
                      className="rounded-md bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {busy ? "Working..." : confirmText[confirm].action}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                  <button
                    onClick={() => {
                      setPassword(generatePassword());
                      setShowPw(true);
                      setSignOut(true);
                      setError("");
                      setNotice("");
                      setMode("reset");
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Reset password
                  </button>
                  <button
                    onClick={() => setConfirm("revoke")}
                    disabled={busy || status.devices.length === 0}
                    className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out all phones
                  </button>
                  {enabled ? (
                    <button
                      onClick={() => setConfirm("disable")}
                      className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Power className="h-3.5 w-3.5" /> Disable
                    </button>
                  ) : (
                    <button
                      onClick={() => run(() => setEnabled({ waiter: waiter.name, enabled: 1 }), "Login enabled.")}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-md border border-emerald-200 px-3 py-1.5 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      <Power className="h-3.5 w-3.5" /> Enable
                    </button>
                  )}
                  <button
                    onClick={() => setConfirm("remove")}
                    className="ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove login
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
