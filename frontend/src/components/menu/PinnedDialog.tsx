import { useEffect, useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Pin, ChevronUp, ChevronDown, GripVertical, X, Search, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { errorText } from "@/pages/WaiterAppLogin";
import { MENU_ADMIN, Shell, primaryBtn, secondaryBtn } from "@/components/menu/OutletDialogs";

export const MAX_PINNED = 24;

export type PinnedRow = {
  item_code: string;
  item_name: string;
  item_group: string;
  rate: number;
  on_outlet?: boolean;
};

/** Ordered pinned favourites of one outlet (the till's Popular tab): reorder, remove, add. */
export function PinnedDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: string;
  onClose: () => void;
  onSaved: (rows: PinnedRow[]) => void;
}) {
  const { data, isLoading } = useFrappeGetCall<{ message: PinnedRow[] }>(
    `${MENU_ADMIN}.get_pinned`,
    { pos_profile: profile },
    `pinned-dialog-${profile}`,
    { revalidateOnFocus: false },
  );
  const [rows, setRows] = useState<PinnedRow[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const { call: setPinned } = useFrappePostCall(`${MENU_ADMIN}.set_pinned`);

  useEffect(() => {
    if (data?.message && rows === null) setRows(data.message);
  }, [data, rows]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: found } = useFrappeGetCall<{ message: any[] }>(
    "servepos.api.registry.get_items",
    { pos_profile: profile, search: debounced },
    debounced.length >= 2 ? `pinned-search-${profile}-${debounced}` : null,
    { revalidateOnFocus: false },
  );

  const list = rows || [];
  const pinnedSet = new Set(list.map((r) => r.item_code));
  const results = (found?.message || []).filter((i) => !pinnedSet.has(i.name)).slice(0, 12);
  const full = list.length >= MAX_PINNED;

  function update(next: PinnedRow[]) {
    setRows(next);
    setDirty(true);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    update(next);
  }
  function add(i: any) {
    if (full) {
      toast({ title: `At most ${MAX_PINNED} pinned items`, variant: "destructive" });
      return;
    }
    update([...list, { item_code: i.name, item_name: i.item_name, item_group: i.item_group, rate: i.standard_rate, on_outlet: true }]);
  }

  async function save() {
    setBusy(true);
    try {
      const res: any = await setPinned({ pos_profile: profile, items: JSON.stringify(list.map((r) => r.item_code)) });
      const saved = (res?.message as PinnedRow[]) || [];
      toast({ title: "Pinned favourites saved", description: `${saved.length} pinned on ${profile}` });
      onSaved(saved);
      onClose();
    } catch (e: any) {
      toast({ title: "Could not save pinned items", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Pinned favourites"
      subtitle={`${profile}: shown first on the till's Popular tab, in this order`}
      icon={<Pin className="h-4 w-4" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <span className="mr-auto self-center text-[11px] text-gray-400">{list.length} / {MAX_PINNED}</span>
          <button className={secondaryBtn} onClick={onClose} disabled={busy}>{dirty ? "Discard" : "Close"}</button>
          <button className={primaryBtn} onClick={save} disabled={busy || !dirty}>{busy ? "Saving..." : "Save"}</button>
        </>
      }
    >
      <div className="overflow-hidden rounded-md border border-gray-200">
        {isLoading && rows === null ? (
          <p className="px-3 py-6 text-center text-[12px] text-gray-400">Loading...</p>
        ) : list.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-gray-400">
            Nothing pinned yet. Search below, or select items in the list and use Pin to Popular.
          </p>
        ) : (
          <ul className="max-h-[320px] divide-y divide-gray-100 overflow-y-auto">
            {list.map((r, idx) => (
              <li
                key={r.item_code}
                draggable
                onDragStart={() => { dragFrom.current = idx; }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                onDragLeave={() => setDragOver((v) => (v === idx ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom.current !== null) move(dragFrom.current, idx);
                  dragFrom.current = null;
                  setDragOver(null);
                }}
                onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
                className={`flex items-center gap-2 px-2 py-2 ${dragOver === idx ? "bg-amber-50" : "bg-white"}`}
              >
                <GripVertical className="h-4 w-4 flex-shrink-0 cursor-grab text-gray-300" />
                <span className="w-5 text-right text-[11px] tabular-nums text-gray-400">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-gray-900">{r.item_name}</p>
                  <p className="truncate text-[11px] text-gray-400">
                    {r.item_group} · {Number(r.rate || 0).toFixed(2)}
                    {r.on_outlet === false && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-px font-medium text-amber-700">Not on this outlet, hidden on till</span>}
                  </p>
                </div>
                <button onClick={() => move(idx, idx - 1)} disabled={idx === 0} title="Move up"
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button onClick={() => move(idx, idx + 1)} disabled={idx === list.length - 1} title="Move down"
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30">
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button onClick={() => update(list.filter((x) => x.item_code !== r.item_code))} title="Unpin"
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Add items</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={full ? `Limit of ${MAX_PINNED} reached` : "Search items on this outlet"}
            disabled={full}
            className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-[13px] focus:border-gray-400 focus:outline-none disabled:bg-gray-50"
          />
        </div>
        {debounced.length >= 2 && !full && (
          <ul className="mt-1.5 max-h-[200px] divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
            {results.length === 0 ? (
              <li className="px-3 py-3 text-center text-[12px] text-gray-400">No matching items on this outlet</li>
            ) : (
              results.map((i) => (
                <li key={i.name}>
                  <button onClick={() => add(i)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                    <Plus className="h-3.5 w-3.5 text-gray-400" />
                    <span className="flex-1 truncate text-[13px] text-gray-800">{i.item_name}</span>
                    <span className="text-[11px] text-gray-400">{i.item_group}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Shell>
  );
}
