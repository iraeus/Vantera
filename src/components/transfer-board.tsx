import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDrivers, useProfiles, useTrucks } from "@/hooks/useTms";
import { useLocalDate } from "@/hooks/useShifts";
import { useTransferActions, useTransferData, useTransferHistory } from "@/hooks/useTransfer";
import { activeSteps, applyFilters, chosen, isFinished, isOverdue, normName, optionsOf, parseNames, splitNew, summarize, type Filters, type Summary, type TRow, type Tone } from "@/lib/transfer";
import { EmptyRow, GhostButton, Modal, Panel, PanelHeader, PrimaryButton, TextInput } from "./ui-kit";
import { MiniSelect, SearchBox, exportCsv, fmtTime } from "./entity-kit";
import { OptionSelect, StickerInfo, StickerOrderModal, UseTemplateModal } from "./transfer-kit";
import { FileActions } from "./transfer-library";

const barCls: Record<Tone, string> = { neutral: "bg-line", info: "bg-accent", warn: "bg-transit", good: "bg-delivered", bad: "bg-problem" };

/* ---------------- top summary ---------------- */
function SummaryBar({ s, filters, setFilters }: { s: Summary; filters: Filters; setFilters: (f: Filters) => void }) {
  const pct = s.total ? Math.round((s.finished / s.total) * 100) : 0;
  const cards: { text: string; value: string; sub?: string; tone?: string; status?: Filters["status"] }[] = [
    { text: "Drivers on the board", value: String(s.total), status: "all" },
    { text: "Fully finished", value: String(s.finished), sub: `${pct}%`, tone: "text-delivered", status: "finished" },
    { text: "Not finished", value: String(s.open), tone: s.open ? "text-transit" : "", status: "open" },
    { text: "Past due date", value: String(s.overdue), tone: s.overdue ? "text-problem" : "", status: "overdue" },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.text}
            onClick={() => setFilters({ ...filters, status: filters.status === c.status ? "all" : (c.status ?? "all") })}
            className={`rounded-xl bg-panel p-4 text-left ring-1 hover:ring-accent/40 ${filters.status === c.status && c.status !== "all" ? "ring-accent/60" : "ring-line"}`}
          >
            <div className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{c.text}</div>
            <div className={`num mt-1 font-display text-2xl font-semibold ${c.tone ?? ""}`}>
              {c.value} {c.sub && <span className="text-sm font-normal text-mut">{c.sub}</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {s.steps.map(({ step, total, done, byOption }) => (
          <div key={step.id} className="rounded-xl bg-panel p-3 ring-1 ring-line">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-fg">{step.label}</span>
              <span className="num text-xs text-mut">{done}/{total} done</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-panel2">
              {total > 0 && byOption.filter((b) => b.count > 0).map((b) => <div key={b.option.id} className={barCls[b.option.tone]} style={{ width: `${(b.count / total) * 100}%` }} title={`${b.option.label}: ${b.count}`} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {byOption.map((b) => {
                const on = filters.steps[step.id] === b.option.id;
                return (
                  <button
                    key={b.option.id}
                    onClick={() => setFilters({ ...filters, steps: { ...filters.steps, [step.id]: on ? "" : b.option.id } })}
                    className={`rounded-md px-1.5 py-0.5 text-[10px] ring-1 ${on ? "bg-accent/12 text-accent ring-accent/50" : "bg-panel2 text-mut ring-line hover:text-fg"}`}
                  >
                    {b.option.label} · {b.count}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- add drivers ---------------- */
const inputCls = "h-10 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none";

function AddDriversModal({ onClose }: { onClose: () => void }) {
  const { rows } = useTransferData();
  const { data: drivers = [] } = useDrivers();
  const { data: trucks = [] } = useTrucks();
  const act = useTransferActions();
  const [mode, setMode] = useState<"one" | "many">("one");
  const [name, setName] = useState("");
  const [truck, setTruck] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [more, setMore] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const truckOf = (id: string) => trucks.find((t) => t.assigned_driver_id === id)?.truck_number ?? null;
  const bulkNames = parseNames(bulkText);
  const onBoard = new Set(rows.map((r) => r.driver_id).filter(Boolean));
  const free = drivers.filter((d) => d.status !== "inactive" && !onBoard.has(d.id) && d.full_name.toLowerCase().includes(q.trim().toLowerCase()));

  /** If the typed name is the same as someone in the Drivers list, link them (so their phone and truck are known). */
  const match = (n: string) => drivers.find((d) => normName(d.full_name) === normName(n));

  async function addTyped() {
    const names = mode === "one" ? (name.trim() ? [name.trim().replace(/\s+/g, " ")] : []) : bulkNames;
    if (names.length === 0) return void toast.error("Type a driver name first");
    const known = [...rows, ...added.map((n) => ({ driver_name: n }))];
    const { fresh, already } = splitNew(names, known);
    if (already.length) toast.message(`Already on the board: ${already.join(", ")}`);
    if (fresh.length === 0) return;
    const payload = fresh.map((n) => {
      const d = match(n);
      const single = mode === "one";
      return {
        driver_id: d?.id ?? null,
        driver_name: d?.full_name ?? n,
        truck_label: (single && truck.trim()) || (d ? truckOf(d.id) : null),
        ...(single && phone.trim() ? { driver_phone: phone.trim() } : {}),
        ...(single && email.trim() ? { driver_email: email.trim() } : {}),
      };
    });
    setBusy(true);
    const ok = await act.addRows(payload);
    setBusy(false);
    if (!ok) return;
    setAdded((a) => [...a, ...payload.map((p) => p.driver_name)]);
    setName("");
    setTruck("");
    setPhone("");
    setEmail("");
    setBulkText("");
    toast.success(payload.length === 1 ? `${payload[0]?.driver_name} added` : `${payload.length} drivers added`);
  }

  return (
    <Modal wide title="Add drivers" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <GhostButton active={mode === "one"} onClick={() => setMode("one")}>One driver</GhostButton>
          <GhostButton active={mode === "many"} onClick={() => setMode("many")}>Many at once</GhostButton>
        </div>

        {mode === "one" ? (
          <div className="space-y-3">
            <p className="text-xs text-mut">Type the driver's name and press Enter. Nothing else is needed. The driver does not have to be in the Drivers list.</p>
            <div className="flex gap-2">
              <input autoFocus className={inputCls} placeholder="Driver name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addTyped()} />
              <PrimaryButton onClick={addTyped} disabled={busy}>Add</PrimaryButton>
            </div>
            <button onClick={() => setMore((v) => !v)} className="text-xs text-accent underline">{more ? "Hide details" : "Add truck, phone or email (optional)"}</button>
            {more && (
              <div className="grid gap-3 sm:grid-cols-3">
                <input className={inputCls} placeholder="Truck" value={truck} onChange={(e) => setTruck(e.target.value)} />
                <input className={inputCls} placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input className={inputCls} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-mut">Paste a list of names, one per line. Repeated names and drivers already on the board are skipped.</p>
            <textarea
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"John Smith\nMike Ross\nAnna Kim"}
              className="w-full rounded-lg bg-ink px-3 py-2 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-mut">{bulkNames.length} name{bulkNames.length === 1 ? "" : "s"} found</span>
              <PrimaryButton onClick={addTyped} disabled={busy || bulkNames.length === 0}>Add {bulkNames.length || ""} drivers</PrimaryButton>
            </div>
          </div>
        )}

        {added.length > 0 && (
          <div className="rounded-lg bg-delivered/10 p-3 text-xs text-delivered ring-1 ring-delivered/30">
            Added: {added.join(", ")}
          </div>
        )}

        <details className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <summary className="cursor-pointer text-xs text-fg">Or pick from the Drivers list ({free.length} available)</summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={q} onChange={setQ} placeholder="Search drivers…" />
              <GhostButton onClick={() => setPicked(free.map((d) => d.id))}>Select all ({free.length})</GhostButton>
              <GhostButton onClick={() => setPicked([])}>Clear</GhostButton>
            </div>
            {free.length === 0 && <EmptyRow text="No drivers in the Drivers list to add. Type names above instead." />}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-ink p-2 ring-1 ring-line">
              {free.map((d) => (
                <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-fg hover:bg-panel2">
                  <input type="checkbox" checked={picked.includes(d.id)} onChange={(e) => setPicked((c) => (e.target.checked ? [...c, d.id] : c.filter((x) => x !== d.id)))} />
                  <span>{d.full_name}</span>
                  {truckOf(d.id) && <span className="font-mono text-[10px] text-mut">Truck {truckOf(d.id)}</span>}
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <PrimaryButton
                disabled={picked.length === 0}
                onClick={async () => {
                  const list = drivers.filter((d) => picked.includes(d.id)).map((d) => ({ driver_id: d.id, driver_name: d.full_name, truck_label: truckOf(d.id) }));
                  if (await act.addRows(list)) {
                    setAdded((a) => [...a, ...list.map((l) => l.driver_name)]);
                    setPicked([]);
                    toast.success(`${list.length} driver${list.length === 1 ? "" : "s"} added`);
                  }
                }}
              >
                Add {picked.length || ""} selected
              </PrimaryButton>
            </div>
          </div>
        </details>

        <div className="flex justify-end"><GhostButton onClick={onClose}>Done</GhostButton></div>
      </div>
    </Modal>
  );
}

/** Name, truck, phone and email of the driver. Each saves when you click away. */
function ContactEditor({ row, canEdit }: { row: TRow; canEdit: boolean }) {
  const act = useTransferActions();
  const field = (label: string, value: string, save: (v: string) => void, type = "text") => (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{label}</span>
      <input
        key={`${row.id}-${label}-${value}`}
        type={type}
        defaultValue={value}
        disabled={!canEdit}
        onBlur={(e) => e.target.value.trim() !== value && save(e.target.value.trim())}
        className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line focus:ring-accent/40 focus:outline-none disabled:opacity-60"
      />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("Driver name", row.driver_name, (v) => v && act.updateRow(row.id, { driver_name: v }))}
        {field("Truck", row.truck_label ?? "", (v) => act.updateRow(row.id, { truck_label: v || null }))}
        {field("Phone", row.driver_phone ?? "", (v) => act.updateRow(row.id, { driver_phone: v || null }), "tel")}
        {field("Email", row.driver_email ?? "", (v) => act.updateRow(row.id, { driver_email: v || null }), "email")}
      </div>
      {canEdit && !row.driver_id && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-mut">
          <span>This driver exists only on this board.</span>
          <GhostButton
            onClick={async () => {
              if (await act.createInDrivers(row)) toast.success("Added to the Drivers list (basic record)");
            }}
          >
            Also add to the Drivers list
          </GhostButton>
        </div>
      )}
    </div>
  );
}

/** Notes box in the driver's drawer. Saves when you click away from it. */
function NotesEditor({ row, canEdit }: { row: TRow; canEdit: boolean }) {
  const act = useTransferActions();
  const [text, setText] = useState(row.notes ?? "");
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Notes</span>
      <textarea
        rows={3}
        value={text}
        disabled={!canEdit}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (row.notes ?? "") && act.updateRow(row.id, { notes: text.trim() || null })}
        placeholder="Anything the team should know about this driver…"
        className="mt-1 w-full rounded-lg bg-ink px-3 py-2 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
      />
    </label>
  );
}

/* ---------------- one driver in detail ---------------- */
function RowDrawer({ rowId, onClose, onSticker, onTemplate }: { rowId: string; onClose: () => void; onSticker: () => void; onTemplate: (templateId: string) => void }) {
  const d = useTransferData();
  const { data: me } = useCurrentUser();
  const { data: profiles = [] } = useProfiles();
  const { data: history = [] } = useTransferHistory(rowId);
  const act = useTransferActions();
  const row = d.rows.find((r) => r.id === rowId);
  const { today } = useLocalDate();
  if (!row) return null;
  const canEdit = !!me?.canWrite;
  const fin = isFinished(row.id, d.steps, d.options, d.idx);
  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? "Someone";
  const texts = d.templates.filter((t) => t.kind === "text");
  const files = d.templates.filter((t) => t.kind === "file");

  return (
    <Modal wide title={row.driver_name} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {fin ? <span className="rounded bg-delivered/12 px-2 py-1 font-mono text-[10px] text-delivered">ALL STEPS DONE</span> : <span className="rounded bg-transit/15 px-2 py-1 font-mono text-[10px] text-transit">IN PROGRESS</span>}
          {row.truck_label && <span className="text-mut">Truck {row.truck_label}</span>}
          {row.is_archived && <span className="rounded bg-panel2 px-2 py-1 font-mono text-[10px] text-mut">ARCHIVED</span>}
          {isOverdue(row, fin, today) && <span className="rounded bg-problem/12 px-2 py-1 font-mono text-[10px] text-problem">PAST DUE DATE</span>}
        </div>

        <ContactEditor row={row} canEdit={canEdit} />

        <div className="grid gap-3 sm:grid-cols-2">
          {activeSteps(d.steps).map((s) => (
            <div key={s.id}>
              <div className="mb-1 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{s.label}</div>
              <OptionSelect big options={optionsOf(d.options, s.id)} value={chosen(row.id, s.id, d.options, d.idx)?.id} disabled={!canEdit} onChange={async (id) => { const ok = await act.setOption(row.id, s.id, id); if (ok && d.options.find((o) => o.id === id)?.asks_details) onSticker(); }} />
            </div>
          ))}
        </div>

        {d.options.some((o) => o.asks_details) && (
          <div>
            <div className="mb-1 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Sticker order: print shop</div>
            <StickerInfo row={row} canEdit={canEdit} onEdit={onSticker} />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <TextInput label="Due date" type="date" value={row.due_date ?? ""} onChange={(v) => canEdit && act.updateRow(row.id, { due_date: v || null })} />
          <NotesEditor row={row} canEdit={canEdit} />
        </div>

        {(texts.length > 0 || files.length > 0) && (
          <div className="space-y-2">
            <div className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Templates and files</div>
            {texts.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
                <span className="text-fg">{t.title}</span>
                {t.category && <span className="font-mono text-[10px] text-mut">{t.category}</span>}
                <span className="ml-auto"><PrimaryButton onClick={() => onTemplate(t.id)}>Use for {row.driver_name.split(" ")[0]}</PrimaryButton></span>
              </div>
            ))}
            {files.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
                <span className="text-fg">{t.title}</span>
                {t.category && <span className="font-mono text-[10px] text-mut">{t.category}</span>}
                <span className="ml-auto flex gap-1.5"><FileActions t={t} /></span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">History</div>
          {history.length === 0 && <p className="text-xs text-mut">No changes yet.</p>}
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap gap-x-3 text-xs">
                <span className="font-mono text-[10px] text-mut">{fmtTime(h.created_at)}</span>
                <span className="text-fg">{h.text}</span>
                <span className="text-mut">· {nameOf(h.changed_by)}</span>
              </div>
            ))}
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
            <GhostButton onClick={async () => { if (await act.updateRow(row.id, { is_archived: !row.is_archived })) onClose(); }}>{row.is_archived ? "Restore to the board" : "Archive"}</GhostButton>
            {me?.isSupervisor && <GhostButton onClick={async () => { if (confirm(`Remove ${row.driver_name} from the board for good?`) && (await act.deleteRow(row.id))) onClose(); }}>Delete</GhostButton>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- the board ---------------- */
export function TransferBoard() {
  const d = useTransferData();
  const { data: me } = useCurrentUser();
  const act = useTransferActions();
  const { today } = useLocalDate();
  const [filters, setFilters] = useState<Filters>({ q: "", status: "all", steps: {} });
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [sticker, setSticker] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tpl, setTpl] = useState<{ rowId?: string; templateId?: string } | null>(null);
  const canEdit = !!me?.canWrite;
  const steps = activeSteps(d.steps);

  const live = useMemo(() => d.rows.filter((r) => !r.is_archived), [d.rows]);
  const summary = useMemo(() => summarize(live, d.steps, d.options, d.idx, today), [live, d.steps, d.options, d.idx, today]);
  const pool = showArchived ? d.rows : live;
  const shown = useMemo(() => applyFilters(pool, filters, d.steps, d.options, d.idx, today), [pool, filters, d.steps, d.options, d.idx, today]);
  const filtersOn = filters.q || filters.status !== "all" || Object.values(filters.steps).some(Boolean);

  async function choose(r: TRow, stepId: string, optionId: string) {
    const ok = await act.setOption(r.id, stepId, optionId);
    if (ok && d.options.find((o) => o.id === optionId)?.asks_details) setSticker(r.id);
  }

  if (d.missingTables) {
    return <EmptyRow text="The Transferring tables are not in the database yet. Run the fifth SQL file (5-transferring.sql) in Supabase, then refresh." />;
  }

  const exportRows = () =>
    exportCsv(
      "transferring.csv",
      shown.map((r) => {
        const o: Record<string, string | number> = { Driver: r.driver_name, Truck: r.truck_label ?? "" };
        for (const s of steps) o[s.label] = chosen(r.id, s.id, d.options, d.idx)?.label ?? "";
        o["Finished"] = isFinished(r.id, d.steps, d.options, d.idx) ? "Yes" : "No";
        o["Due date"] = r.due_date ?? "";
        o["Notes"] = r.notes ?? "";
        o["Print shop"] = r.sticker_shop_name ?? "";
        o["Print shop email"] = r.sticker_email ?? "";
        o["Print shop phone"] = r.sticker_phone ?? "";
        o["Print shop location"] = r.sticker_location ?? "";
        return o;
      }),
    );

  return (
    <div className="space-y-4">
      <SummaryBar s={summary} filters={filters} setFilters={setFilters} />

      <Panel>
        <PanelHeader title="Transfer board" count={`${shown.length} of ${pool.length}`}>
          {canEdit && <PrimaryButton onClick={() => setAdding(true)}>+ Add driver</PrimaryButton>}
          <GhostButton onClick={() => setTpl({})}>Message templates</GhostButton>
          <GhostButton onClick={exportRows}>Export CSV</GhostButton>
          <GhostButton onClick={() => window.print()}>Print</GhostButton>
        </PanelHeader>

        <div className="no-print flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Search driver, truck, notes…" />
          <MiniSelect
            value={filters.status}
            onChange={(v) => setFilters({ ...filters, status: v as Filters["status"] })}
            options={[{ value: "all", text: "All drivers" }, { value: "open", text: "Not finished" }, { value: "finished", text: "Fully finished" }, { value: "overdue", text: "Past due date" }]}
          />
          {steps.map((s) => (
            <MiniSelect
              key={s.id}
              value={filters.steps[s.id] ?? ""}
              onChange={(v) => setFilters({ ...filters, steps: { ...filters.steps, [s.id]: v } })}
              options={[{ value: "", text: `${s.label}: any` }, ...optionsOf(d.options, s.id).map((o) => ({ value: o.id, text: `${s.label}: ${o.label}` }))]}
            />
          ))}
          <label className="flex items-center gap-1.5 text-xs text-mut">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          {filtersOn && <GhostButton onClick={() => setFilters({ q: "", status: "all", steps: {} })}>Clear filters</GhostButton>}
        </div>

        {d.loading && <EmptyRow text="Loading…" />}
        {!d.loading && pool.length === 0 && <EmptyRow text={canEdit ? "No drivers on the board yet. Press “Add driver”." : "No drivers on the board yet."} />}
        {!d.loading && pool.length > 0 && shown.length === 0 && <EmptyRow text="No drivers match these filters." />}

        {shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-xs">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                  <th className="sticky left-0 z-10 bg-panel px-3 py-2 font-normal">Driver</th>
                  {steps.map((s) => <th key={s.id} className="px-2 py-2 font-normal">{s.label}</th>)}
                  <th className="px-2 py-2 font-normal">Due</th>
                  <th className="px-2 py-2 font-normal">Notes</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const fin = isFinished(r.id, d.steps, d.options, d.idx);
                  const over = isOverdue(r, fin, today);
                  const hasShop = !!(r.sticker_shop_name || r.sticker_phone || r.sticker_email || r.sticker_location);
                  return (
                    <tr key={r.id} className={`border-b border-line/50 ${fin ? "bg-delivered/10" : ""} ${r.is_archived ? "opacity-60" : ""}`}>
                      <td className={`sticky left-0 z-10 bg-panel px-3 py-2 align-top ${fin ? "border-l-2 border-delivered" : ""}`}>
                        <button onClick={() => setOpen(r.id)} className="text-left font-medium text-fg hover:text-accent">{r.driver_name}</button>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-mut">
                          {r.truck_label && <span>Truck {r.truck_label}</span>}
                          {fin && <span className="text-delivered">✓ finished</span>}
                          {r.is_archived && <span>archived</span>}
                        </div>
                      </td>
                      {steps.map((s) => {
                        const opts = optionsOf(d.options, s.id);
                        const cur = chosen(r.id, s.id, d.options, d.idx);
                        const isSticker = opts.some((o) => o.asks_details);
                        return (
                          <td key={s.id} className="px-2 py-1.5 align-top">
                            <OptionSelect options={opts} value={cur?.id} disabled={!canEdit} onChange={(id) => choose(r, s.id, id)} />
                            {isSticker && hasShop && (
                              <button onClick={() => setSticker(r.id)} className="mt-1 block max-w-[190px] truncate text-left text-[10px] text-mut hover:text-fg" title="Print shop details">
                                🖨 {[r.sticker_shop_name, r.sticker_phone].filter(Boolean).join(" · ") || "print shop"}
                              </button>
                            )}
                            {isSticker && !hasShop && cur?.asks_details && canEdit && (
                              <button onClick={() => setSticker(r.id)} className="mt-1 block text-[10px] text-accent underline">+ add print shop details</button>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 align-top">
                        <input
                          type="date"
                          value={r.due_date ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => act.updateRow(r.id, { due_date: e.target.value || null })}
                          className={`h-8 rounded-lg bg-ink px-2 text-xs ring-1 ${over ? "text-problem ring-problem/50" : "text-fg ring-line"}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <input
                          key={`${r.id}-${r.notes ?? ""}`}
                          defaultValue={r.notes ?? ""}
                          disabled={!canEdit}
                          placeholder="Add a note…"
                          onBlur={(e) => e.target.value !== (r.notes ?? "") && act.updateRow(r.id, { notes: e.target.value.trim() || null })}
                          className="h-8 w-48 rounded-lg bg-ink px-2 text-xs text-fg ring-1 ring-line placeholder:text-mut focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right align-top"><GhostButton onClick={() => setOpen(r.id)}>Open</GhostButton></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="no-print border-t border-line px-4 py-2 text-[11px] text-mut">
          Green rows have every step finished. Everyone can change the dropdowns, and changes from other people appear within 15 seconds.
        </p>
      </Panel>

      {adding && <AddDriversModal onClose={() => setAdding(false)} />}
      {open && <RowDrawer rowId={open} onClose={() => setOpen(null)} onSticker={() => setSticker(open)} onTemplate={(templateId) => setTpl({ rowId: open, templateId })} />}
      {sticker && d.rows.find((r) => r.id === sticker) && (
        <StickerOrderModal row={d.rows.find((r) => r.id === sticker) as TRow} shops={d.shops} onClose={() => setSticker(null)} />
      )}
      {tpl && (
        <UseTemplateModal
          templates={d.templates}
          rows={d.rows.filter((r) => !r.is_archived)}
          {...(tpl.rowId ? { initialRowId: tpl.rowId } : {})}
          {...(tpl.templateId ? { initialTemplateId: tpl.templateId } : {})}
          onClose={() => setTpl(null)}
        />
      )}
    </div>
  );
}
