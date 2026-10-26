import { useEffect, useMemo, useState } from "react";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Copy, Store, X, ArrowRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { errorText } from "@/pages/WaiterAppLogin";

export const MENU_ADMIN = "servepos.api.menu_admin";

type Profile = { name: string; branch?: string };

export function useOutletProfiles() {
  const { data } = useFrappeGetDocList<Profile>("POS Profile", {
    fields: ["name", "branch"],
    filters: [["disabled", "=", 0]],
    limit: 200,
    orderBy: { field: "name", order: "asc" },
  });
  return data || [];
}

const primaryBtn =
  "rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-40";
const secondaryBtn =
  "rounded-md border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40";
const dangerBtn =
  "rounded-md bg-red-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-700 disabled:opacity-40";

function Shell({
  title,
  subtitle,
  icon,
  onClose,
  busy,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[84vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white">{icon}</div>
            <div>
              <h2 className="text-[14px] font-semibold text-gray-900">{title}</h2>
              {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
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
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/** In-app yes/no dialog (instead of window.confirm). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Shell
      title={title}
      icon={<Store className="h-4 w-4" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className={secondaryBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={danger ? dangerBtn : primaryBtn} onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px] text-gray-700">{message}</div>
    </Shell>
  );
}

function ProfilePicker({
  profiles,
  selected,
  onChange,
}: {
  profiles: Profile[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const all = profiles.length > 0 && selected.size === profiles.length;
  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Outlets (POS Profiles)</span>
        <button
          className="text-[11px] font-medium text-gray-600 hover:text-gray-900"
          onClick={() => onChange(all ? new Set() : new Set(profiles.map((p) => p.name)))}
        >
          {all ? "Clear" : "Select all"}
        </button>
      </div>
      <div className="max-h-[260px] divide-y divide-gray-100 overflow-y-auto">
        {profiles.map((p) => (
          <label key={p.name} className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selected.has(p.name)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(p.name)) next.delete(p.name);
                else next.add(p.name);
                onChange(next);
              }}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
            />
            <span className="text-[13px] font-medium text-gray-800">{p.name}</span>
            {p.branch && p.branch !== p.name && <span className="text-[11px] text-gray-400">{p.branch}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Add the selected items to outlets, or remove them from outlets, in one server call. */
export function OutletDialog({
  mode,
  items,
  onClose,
  onDone,
}: {
  mode: "add" | "remove";
  items: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const profiles = useOutletProfiles();
  const { call } = useFrappePostCall(`${MENU_ADMIN}.set_item_outlets`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pos, setPos] = useState(true);
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const adding = mode === "add";

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res: any = await call({
        items: JSON.stringify(items),
        pos_profiles: JSON.stringify(Array.from(selected)),
        // add: ticked = switch on, unticked = leave as is. remove: ticked = take away.
        show_on_pos: pos ? 1 : null,
        show_on_website: web ? 1 : null,
        mode,
      });
      const r = res?.message || {};
      const parts = [`${plural(r.updated || 0, "item")} updated`];
      if (r.unchanged) parts.push(`${r.unchanged} already set`);
      if (r.converted_legacy) parts.push(`${r.converted_legacy} moved from the old outlet list`);
      if (r.skipped_disabled) parts.push(`${r.skipped_disabled} disabled skipped`);
      toast({
        title: adding ? "Added to outlets" : "Removed from outlets",
        description: parts.join(", ") + ". Tills pick it up on their next sync.",
      });
      onDone();
      onClose();
    } catch (e: any) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title={adding ? "Add to outlet" : "Remove from outlet"}
      subtitle={`${plural(items.length, "item")} selected`}
      icon={<Store className="h-4 w-4" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className={secondaryBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={adding ? primaryBtn : dangerBtn}
            onClick={apply}
            disabled={busy || selected.size === 0 || (!pos && !web) || items.length === 0}
          >
            {busy ? "Applying..." : `Apply to ${plural(items.length, "item")}`}
          </button>
        </>
      }
    >
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>}
      <ProfilePicker profiles={profiles} selected={selected} onChange={setSelected} />
      <div className="space-y-2 rounded-md border border-gray-200 px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={pos} onChange={() => setPos(!pos)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
          <span className="text-[13px] text-gray-800">Show on POS</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={web} onChange={() => setWeb(!web)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-[13px] text-gray-800">Show on website</span>
        </label>
      </div>
      <p className="text-[11px] text-gray-500">
        {adding
          ? "Ticked channels are switched on for the chosen outlets. Outlets the items already have are kept."
          : "Ticked channels are taken away on the chosen outlets. Other outlets are not touched."}
      </p>
    </Shell>
  );
}

type CopyPreview = {
  source_items: number;
  target_items_before: number;
  already_on_both: number;
  to_add: number;
  to_remove: number;
  target_items_after: number;
  modifier_groups_to_change: number;
  copy_order: boolean;
  items_added?: number;
  items_removed?: number;
  modifier_groups_changed?: number;
};

/** Copy the menu (items, order, modifier groups) of one outlet to another. */
export function CopyMenuDialog({
  defaultTarget,
  onClose,
  onDone,
}: {
  defaultTarget?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const profiles = useOutletProfiles();
  const { call } = useFrappePostCall(`${MENU_ADMIN}.copy_outlet_menu`);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState(defaultTarget || "");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [copyOrder, setCopyOrder] = useState(true);
  const [copyMods, setCopyMods] = useState(true);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // options changed -> old preview is stale
  useEffect(() => setPreview(null), [source, target, mode, copyOrder, copyMods]);

  const params = useMemo(
    () => ({
      source_profile: source,
      target_profile: target,
      mode,
      copy_order: copyOrder ? 1 : 0,
      copy_modifier_groups: copyMods ? 1 : 0,
    }),
    [source, target, mode, copyOrder, copyMods],
  );
  const ready = source && target && source !== target;

  async function run(isPreview: boolean) {
    setBusy(true);
    setError("");
    try {
      const res: any = await call({ ...params, preview: isPreview ? 1 : 0 });
      const r: CopyPreview = res?.message;
      if (isPreview) {
        setPreview(r);
      } else {
        const parts = [`${plural(r.items_added || 0, "item")} added`];
        if (mode === "replace") parts.push(`${r.items_removed || 0} removed`);
        if (r.modifier_groups_changed) parts.push(`${plural(r.modifier_groups_changed, "modifier group")} updated`);
        if (r.copy_order) parts.push("order copied");
        toast({
          title: `Menu copied to ${target}`,
          description: parts.join(", ") + ". Tills pick it up on their next sync.",
        });
        onDone();
        onClose();
      }
    } catch (e: any) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const selectCls =
    "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-gray-400 focus:outline-none";
  const opt = (p: Profile) => (
    <option key={p.name} value={p.name}>
      {p.name}
      {p.branch && p.branch !== p.name ? ` (${p.branch})` : ""}
    </option>
  );

  return (
    <Shell
      title="Copy menu from another outlet"
      subtitle="Show the same items on another POS Profile"
      icon={<Copy className="h-4 w-4" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className={secondaryBtn} onClick={onClose} disabled={busy}>Cancel</button>
          {!preview ? (
            <button className={primaryBtn} onClick={() => run(true)} disabled={busy || !ready}>
              {busy ? "Checking..." : "Preview"}
            </button>
          ) : (
            <button
              className={mode === "replace" && preview.to_remove > 0 ? dangerBtn : primaryBtn}
              onClick={() => run(false)}
              disabled={busy || !ready}
            >
              {busy ? "Copying..." : "Confirm copy"}
            </button>
          )}
        </>
      }
    >
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>}
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Copy from</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
            <option value="">Select outlet...</option>
            {profiles.map(opt)}
          </select>
        </div>
        <ArrowRight className="mb-2.5 h-4 w-4 text-gray-400" />
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">To</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={selectCls}>
            <option value="">Select outlet...</option>
            {profiles.filter((p) => p.name !== source).map(opt)}
          </select>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-gray-200 px-3 py-2.5">
        <label className="flex cursor-pointer items-start gap-2">
          <input type="radio" checked={mode === "add"} onChange={() => setMode("add")} className="mt-0.5 h-4 w-4" />
          <span className="text-[13px] text-gray-800">
            Add only
            <span className="block text-[11px] text-gray-500">Add the source items; keep everything the target already has.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-0.5 h-4 w-4" />
          <span className="text-[13px] text-gray-800">
            Replace
            <span className="block text-[11px] text-gray-500">The target ends up with exactly the source items; others are taken off it.</span>
          </span>
        </label>
      </div>

      <div className="space-y-2 rounded-md border border-gray-200 px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={copyOrder} onChange={() => setCopyOrder(!copyOrder)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
          <span className="text-[13px] text-gray-800">Copy category and item order</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={copyMods} onChange={() => setCopyMods(!copyMods)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
          <span className="text-[13px] text-gray-800">Copy modifier group visibility</span>
        </label>
      </div>

      {preview && (
        <div className="rounded-md bg-gray-50 px-3 py-3 text-[12px] text-gray-700">
          <div className="grid grid-cols-2 gap-y-1">
            <span>Items on {source}</span><b className="text-right">{preview.source_items}</b>
            <span>Items on {target} now</span><b className="text-right">{preview.target_items_before}</b>
            <span>Items to add</span><b className="text-right text-emerald-700">+{preview.to_add}</b>
            {mode === "replace" && (<><span>Items to take off</span><b className="text-right text-red-600">-{preview.to_remove}</b></>)}
            <span>Items on {target} after</span><b className="text-right">{preview.target_items_after}</b>
            {copyMods && (<><span>Modifier groups to update</span><b className="text-right">{preview.modifier_groups_to_change}</b></>)}
            {copyOrder && (<><span>Menu order</span><b className="text-right">{preview.copy_order ? "copied" : "source has none"}</b></>)}
          </div>
          {mode === "replace" && preview.to_remove > 0 && (
            <p className="mt-2 text-[11px] text-red-600">
              {plural(preview.to_remove, "item")} will no longer show on {target}.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
