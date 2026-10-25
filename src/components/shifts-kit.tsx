import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLoads, useProfiles } from "@/hooks/useTms";
import {
  tbl,
  useHandoffReads,
  useHandoffs,
  useMyShiftId,
  useShiftClock,
  useUnreadHandoffs,
  type Handoff,
} from "@/hooks/useShifts";
import {
  DOW_NAMES,
  addDays,
  addMinutesToTime,
  dowOf,
  fmt12,
  fmtDuration,
  fmtRange,
  hhmm,
  mondayOf,
  occurrenceOn,
  onDutyUserIds,
  toMin,
  type Occurrence,
  type Shift,
  type ShiftOverride,
  type ShiftTime,
} from "@/lib/shifts";
import { ACTIVE_STATUSES } from "@/lib/tms";
import { EmptyRow, GhostButton, Modal, Panel, PrimaryButton, SelectInput, TextInput } from "./ui-kit";
import { fmtTime } from "./entity-kit";

function useNameOf() {
  const { data: profiles = [] } = useProfiles();
  return (id?: string | null) => {
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || "Unknown";
  };
}

export function TextArea({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-ink px-3 py-2 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Banner: which shift is on right now                                  */
/* ------------------------------------------------------------------ */
export function ShiftBanner() {
  const c = useShiftClock();
  const { data: me } = useCurrentUser();
  const nameOf = useNameOf();
  const [extending, setExtending] = useState<Occurrence | null>(null);
  const shiftName = (id: string) => c.shifts.find((s) => s.id === id)?.name ?? "Shift";

  if (c.missingTables) {
    return (
      <Panel className="px-4 py-3 text-xs text-mut">
        Shifts are not set up in the database yet. Run the two SQL files from the update pack in Supabase (SQL Editor), then refresh.
      </Panel>
    );
  }
  if (c.loading) return null;
  if (c.shifts.length === 0) {
    return (
      <Panel className="px-4 py-3 text-xs text-mut">
        No shifts yet. {me?.isSupervisor ? <Link to="/shifts" className="text-accent">Create your shifts</Link> : "Ask your supervisor to create them."}
      </Panel>
    );
  }
  return (
    <>
      <Panel className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-xs">
        {c.current.length === 0 ? (
          <span className="text-mut">No shift is scheduled right now.</span>
        ) : (
          c.current.map((o) => {
            const names = onDutyUserIds(o.shiftId, o.date, c.members, c.covers).map(nameOf);
            return (
              <div key={`${o.shiftId}${o.date}`} className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-accent/12 px-1.5 py-0.5 font-mono text-[10px] text-accent">ON NOW</span>
                <span className="font-medium text-fg">{shiftName(o.shiftId)}</span>
                <span className="text-mut">{fmtRange(o.start, o.end)}{o.overridden ? " · changed" : ""}</span>
                <span className="text-mut">· ends in {fmtDuration(o.endStamp - c.clock.stamp)}</span>
                {names.length > 0 && (
                  <span className="text-mut">· {names.slice(0, 3).join(", ")}{names.length > 3 ? ` +${names.length - 3}` : ""}</span>
                )}
                {me?.isSupervisor && <GhostButton onClick={() => setExtending(o)}>Extend</GhostButton>}
              </div>
            );
          })
        )}
        {c.next && (
          <div className="ml-auto text-mut">
            Next: <span className="text-fg">{shiftName(c.next.shiftId)}</span> in {fmtDuration(c.next.startStamp - c.clock.stamp)} ({fmt12(c.next.start)})
          </div>
        )}
        {!c.tzIsSet && (
          <div className="w-full text-[11px] text-transit">
            Company timezone is not set, so this computer's timezone ({c.tz}) is used.{" "}
            {me?.isSupervisor ? <Link to="/shifts" className="underline">Set it on the Shifts page</Link> : "Ask your supervisor to set it."}
          </div>
        )}
      </Panel>
      {extending && <ExtendModal occ={extending} name={shiftName(extending.shiftId)} onClose={() => setExtending(null)} />}
    </>
  );
}

function ExtendModal({ occ, name, onClose }: { occ: Occurrence; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [custom, setCustom] = useState(occ.end);
  const [busy, setBusy] = useState(false);
  async function save(newEnd: string) {
    setBusy(true);
    const { error } = await tbl("shift_overrides").upsert(
      { shift_id: occ.shiftId, on_date: occ.date, start_time: occ.start, end_time: newEnd, is_off: false, note: "Extended" },
      { onConflict: "shift_id,on_date" },
    );
    setBusy(false);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shift-overrides"] });
    toast.success(`${name} now ends at ${fmt12(newEnd)} today`);
    onClose();
  }
  return (
    <Modal title={`Extend ${name}`} onClose={onClose}>
      <p className="mb-3 text-xs text-mut">Currently ends at {fmt12(occ.end)}. This only changes today's shift, not the normal schedule.</p>
      <div className="flex flex-wrap gap-2">
        {[30, 60, 120].map((m) => (
          <GhostButton key={m} onClick={() => !busy && save(addMinutesToTime(occ.end, m))}>
            +{m >= 60 ? `${m / 60} hour${m > 60 ? "s" : ""}` : `${m} min`}
          </GhostButton>
        ))}
      </div>
      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <TextInput label="Or set the end time" type="time" value={custom} onChange={setCustom} />
        </div>
        <PrimaryButton disabled={busy || !custom} onClick={() => save(custom)}>Save</PrimaryButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Edit the times of one shift on one date (or pattern)                 */
/* ------------------------------------------------------------------ */
type Scope = "date" | "dow" | "weekdays" | "weekend" | "all";

export function TimeEditModal({
  shift,
  date,
  times,
  overrides,
  onClose,
}: {
  shift: Shift;
  date: string;
  times: ShiftTime[];
  overrides: ShiftOverride[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const occ = occurrenceOn(shift.id, date, times, overrides);
  const base = times.find((t) => t.shift_id === shift.id && t.dow === dowOf(date));
  const existingOverride = overrides.find((o) => o.shift_id === shift.id && o.on_date === date);
  const [off, setOff] = useState(occ === null);
  const [start, setStart] = useState(occ?.start ?? (base ? hhmm(base.start_time) : "08:00"));
  const [end, setEnd] = useState(occ?.end ?? (base ? hhmm(base.end_time) : "16:00"));
  const [scope, setScope] = useState<Scope>("date");
  const [busy, setBusy] = useState(false);
  const dow = dowOf(date);
  const dayName = DOW_NAMES[dow] ?? "";
  const prettyDate = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shift-times"] });
    qc.invalidateQueries({ queryKey: ["shift-overrides"] });
  };

  async function save() {
    if (!off && (!start || !end)) return void toast.error("Enter a start and end time");
    setBusy(true);
    let error: { message: string } | null = null;
    if (scope === "date") {
      ({ error } = await tbl("shift_overrides").upsert(
        { shift_id: shift.id, on_date: date, start_time: start || "08:00", end_time: end || "16:00", is_off: off },
        { onConflict: "shift_id,on_date" },
      ));
    } else {
      const dows = scope === "dow" ? [dow] : scope === "weekdays" ? [1, 2, 3, 4, 5] : scope === "weekend" ? [6, 0] : [0, 1, 2, 3, 4, 5, 6];
      ({ error } = await tbl("shift_times").upsert(
        dows.map((d) => ({ shift_id: shift.id, dow: d, start_time: start || "08:00", end_time: end || "16:00", is_off: off })),
        { onConflict: "shift_id,dow" },
      ));
      if (!error && existingOverride) {
        ({ error } = await tbl("shift_overrides").delete().eq("shift_id", shift.id).eq("on_date", date));
      }
    }
    setBusy(false);
    if (error) return void toast.error(error.message);
    refresh();
    toast.success("Shift times saved");
    onClose();
  }

  async function resetDate() {
    setBusy(true);
    const { error } = await tbl("shift_overrides").delete().eq("shift_id", shift.id).eq("on_date", date);
    setBusy(false);
    if (error) return void toast.error(error.message);
    refresh();
    toast.success("Back to the normal schedule for this date");
    onClose();
  }

  const scopes: { value: Scope; text: string }[] = [
    { value: "date", text: `Only on ${prettyDate}` },
    { value: "dow", text: `Every ${dayName} from now on` },
    { value: "weekdays", text: "Every weekday (Mon–Fri) from now on" },
    { value: "weekend", text: "Every weekend (Sat–Sun) from now on" },
    { value: "all", text: "Every day from now on" },
  ];

  return (
    <Modal title={`${shift.name} · ${prettyDate}`} onClose={onClose}>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-xs text-fg">
          <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />
          No shift (off)
        </label>
        {!off && (
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Starts" type="time" value={start} onChange={setStart} />
            <TextInput label="Ends" type="time" value={end} onChange={setEnd} />
            {start && end && toMin(end) <= toMin(start) && (
              <p className="col-span-2 text-[11px] text-mut">This shift ends the next day (it runs past midnight).</p>
            )}
          </div>
        )}
        <div>
          <div className="mb-1.5 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Apply to</div>
          <div className="space-y-1.5">
            {scopes.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-xs text-fg">
                <input type="radio" name="scope" checked={scope === s.value} onChange={() => setScope(s.value)} />
                {s.text}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          {existingOverride ? <GhostButton onClick={resetDate}>Reset this date to normal</GhostButton> : <span />}
          <PrimaryButton onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Handoffs                                                             */
/* ------------------------------------------------------------------ */
export function HandoffCard({ h, shiftName, showShift }: { h: Handoff; shiftName?: string | undefined; showShift?: boolean }) {
  const { data: me } = useCurrentUser();
  const { data: reads = [] } = useHandoffReads();
  const { data: loads = [] } = useLoads();
  const nameOf = useNameOf();
  const qc = useQueryClient();
  const mine = reads.some((r) => r.handoff_id === h.id && r.user_id === me?.id);
  const readers = reads.filter((r) => r.handoff_id === h.id);
  const flagged = loads.filter((l) => h.flagged_load_ids.includes(l.id));

  async function markRead() {
    if (!me) return;
    const { error } = await tbl("shift_handoff_reads").upsert(
      { handoff_id: h.id, user_id: me.id },
      { onConflict: "handoff_id,user_id", ignoreDuplicates: true },
    );
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["handoff-reads"] });
    toast.success("Marked as read");
  }

  return (
    <div className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-mut">
        {showShift && <span className="rounded bg-accent/12 px-1.5 py-0.5 text-accent">{shiftName ?? "Shift"}</span>}
        <span>{nameOf(h.author_id)}</span>
        <span>· {fmtTime(h.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs text-fg">{h.summary}</p>
      {h.open_items && (
        <div className="mt-2 rounded-md bg-ink p-2 ring-1 ring-line">
          <div className="font-mono text-[10px] tracking-[0.12em] text-transit uppercase">For the next shift</div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-fg">{h.open_items}</p>
        </div>
      )}
      {flagged.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {flagged.map((l) => (
            <span key={l.id} className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-fg ring-1 ring-line">
              {l.load_number}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-mut">
        <span>{readers.length === 0 ? "Not read yet" : `Read by ${readers.map((r) => nameOf(r.user_id)).join(", ")}`}</span>
        {me && !mine && h.author_id !== me.id && (
          <span className="ml-auto">
            <GhostButton onClick={markRead}>I've read this</GhostButton>
          </span>
        )}
      </div>
    </div>
  );
}

function HandoffComposer({ shiftId }: { shiftId: string }) {
  const c = useShiftClock();
  const { data: loads = [] } = useLoads();
  const qc = useQueryClient();
  const [summary, setSummary] = useState("");
  const [openItems, setOpenItems] = useState("");
  const [flagged, setFlagged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const active = loads.filter((l) => ACTIVE_STATUSES.includes(l.status) || l.is_problem);
  const running = c.current.find((o) => o.shiftId === shiftId);

  async function submit() {
    if (!summary.trim()) return void toast.error("Write a short summary of the shift");
    setBusy(true);
    const { error } = await tbl("shift_handoffs").insert({
      shift_id: shiftId,
      shift_date: running?.date ?? c.clock.date,
      summary: summary.trim(),
      open_items: openItems.trim() || null,
      flagged_load_ids: flagged,
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    setSummary("");
    setOpenItems("");
    setFlagged([]);
    qc.invalidateQueries({ queryKey: ["handoffs"] });
    toast.success("Handoff saved. The next shift will see it.");
  }

  return (
    <div className="space-y-3 rounded-lg bg-panel2 p-3 ring-1 ring-line">
      <div className="font-display text-sm font-semibold">Write the handoff for the next shift</div>
      <TextArea label="What happened this shift" value={summary} onChange={setSummary} placeholder="Short summary: deliveries done, delays, problems…" />
      <TextArea label="What the next shift must do or watch" value={openItems} onChange={setOpenItems} placeholder="Call-backs, loads to check, drivers waiting…" />
      {active.length > 0 && (
        <div>
          <div className="mb-1 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Loads that need attention ({flagged.length} picked)</div>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-ink p-2 ring-1 ring-line">
            {active.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-xs text-fg">
                <input
                  type="checkbox"
                  checked={flagged.includes(l.id)}
                  onChange={(e) => setFlagged((cur) => (e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id)))}
                />
                <span className="font-mono">{l.load_number}</span>
                <span className="truncate text-mut">{l.pickup_location ?? "—"} → {l.delivery_location ?? "—"}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <PrimaryButton onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save handoff"}</PrimaryButton>
      </div>
    </div>
  );
}

/** Unread handoffs from other shifts, shown at the top of the Update Board. */
export function HandoffAlert() {
  const unread = useUnreadHandoffs();
  const c = useShiftClock();
  if (unread.length === 0) return null;
  return (
    <Panel className="space-y-3 p-4 ring-transit/40">
      <div className="flex items-center gap-2">
        <span className="rounded bg-transit/15 px-1.5 py-0.5 font-mono text-[10px] text-transit">NEW HANDOFF</span>
        <span className="text-xs text-fg">{unread.length === 1 ? "A handoff is waiting for you" : `${unread.length} handoffs are waiting for you`}</span>
      </div>
      {unread.slice(0, 3).map((h) => (
        <HandoffCard key={h.id} h={h} showShift shiftName={c.shifts.find((s) => s.id === h.shift_id)?.name} />
      ))}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* A shift "folder": handoffs, team, times                              */
/* ------------------------------------------------------------------ */
export function FolderView({ shiftId }: { shiftId: string }) {
  const c = useShiftClock();
  const { data: me } = useCurrentUser();
  const myShift = useMyShiftId();
  const { data: handoffs = [] } = useHandoffs();
  const [tab, setTab] = useState<"handoffs" | "team" | "times">("handoffs");
  const shift = c.shifts.find((s) => s.id === shiftId);
  if (!shift) return <EmptyRow text="This shift no longer exists." />;
  const canWriteHandoff = !!me?.canWrite && (myShift === shiftId || !!me?.isSupervisor);
  const mine = handoffs.filter((h) => h.shift_id === shiftId).slice(0, 20);

  const tabs: { key: typeof tab; text: string }[] = [
    { key: "handoffs", text: "Handoffs" },
    { key: "team", text: "Team" },
    { key: "times", text: "Times" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {tabs.map((t) => (
          <GhostButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.text}</GhostButton>
        ))}
      </div>
      {tab === "handoffs" && (
        <div className="space-y-3">
          {canWriteHandoff && <HandoffComposer shiftId={shiftId} />}
          {mine.length === 0 && <EmptyRow text="No handoffs written by this shift yet." />}
          {mine.map((h) => <HandoffCard key={h.id} h={h} />)}
        </div>
      )}
      {tab === "team" && <TeamTab shift={shift} />}
      {tab === "times" && <TimesTab shift={shift} />}
    </div>
  );
}

function TeamTab({ shift }: { shift: Shift }) {
  const c = useShiftClock();
  const { data: me } = useCurrentUser();
  const { data: profiles = [] } = useProfiles();
  const nameOf = useNameOf();
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const [coverPick, setCoverPick] = useState("");
  const [coverDate, setCoverDate] = useState(c.clock.date);
  const members = c.members.filter((m) => m.shift_id === shift.id);
  const covers = c.covers.filter((x) => x.shift_id === shift.id && x.on_date >= c.clock.date);
  const folderOf = (uid: string) => c.shifts.find((s) => s.id === c.members.find((m) => m.user_id === uid)?.shift_id)?.name;
  const staff = profiles.filter((p) => p.is_active);
  const people = (extra: (id: string) => boolean) =>
    [{ value: "", text: "Pick a person…" }, ...staff.filter((p) => extra(p.id)).map((p) => ({ value: p.id, text: `${p.full_name || p.email || "Unknown"}${folderOf(p.id) ? ` (in ${folderOf(p.id)})` : ""}` }))];

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok: string, keys: string[]) {
    const { error } = await p;
    if (error) return void toast.error(error.message);
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast.success(ok);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Team ({members.length})</div>
        {members.length === 0 && <EmptyRow text="Nobody is in this shift yet." />}
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
              <span className="text-fg">{nameOf(m.user_id)}</span>
              {me?.isSupervisor && (
                <span className="ml-auto">
                  <GhostButton onClick={() => run(tbl("shift_members").delete().eq("user_id", m.user_id), "Removed from the shift", ["shift-members"])}>Remove</GhostButton>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      {me?.isSupervisor && (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <SelectInput label="Add or move a person into this shift" value={pick} onChange={setPick} options={people((id) => !members.some((m) => m.user_id === id))} />
            </div>
            <PrimaryButton
              disabled={!pick}
              onClick={async () => {
                await run(tbl("shift_members").upsert({ user_id: pick, shift_id: shift.id }, { onConflict: "user_id" }), "Added to the shift", ["shift-members"]);
                setPick("");
              }}
            >
              Add
            </PrimaryButton>
          </div>
          <div className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Cover for a day</div>
            <div className="grid grid-cols-[1fr_150px_auto] items-end gap-2">
              <SelectInput label="Person" value={coverPick} onChange={setCoverPick} options={people(() => true)} />
              <TextInput label="Date" type="date" value={coverDate} onChange={setCoverDate} />
              <PrimaryButton
                disabled={!coverPick || !coverDate}
                onClick={async () => {
                  await run(
                    tbl("shift_cover").upsert({ shift_id: shift.id, user_id: coverPick, on_date: coverDate }, { onConflict: "user_id,on_date" }),
                    "Cover added",
                    ["shift-covers"],
                  );
                  setCoverPick("");
                }}
              >
                Add
              </PrimaryButton>
            </div>
          </div>
        </>
      )}
      {covers.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Covering this shift</div>
          <div className="space-y-1.5">
            {covers.map((x) => (
              <div key={x.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
                <span className="text-fg">{nameOf(x.user_id)}</span>
                <span className="text-mut">on {x.on_date}</span>
                {me?.isSupervisor && (
                  <span className="ml-auto">
                    <GhostButton onClick={() => run(tbl("shift_cover").delete().eq("id", x.id), "Cover removed", ["shift-covers"])}>Remove</GhostButton>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimesTab({ shift }: { shift: Shift }) {
  const c = useShiftClock();
  const { data: me } = useCurrentUser();
  const [editing, setEditing] = useState<string | null>(null);
  const monday = mondayOf(c.clock.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-mut">This week's times for {shift.name}.{me?.isSupervisor ? " Click Edit to change them." : ""}</p>
      {days.map((date) => {
        const o = occurrenceOn(shift.id, date, c.times, c.overrides);
        return (
          <div key={date} className="flex items-center gap-3 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
            <span className="w-24 text-fg">{DOW_NAMES[dowOf(date)]}</span>
            <span className="font-mono text-[10px] text-mut">{date.slice(5)}</span>
            <span className={o ? "text-fg" : "text-mut"}>{o ? fmtRange(o.start, o.end) : "Off"}</span>
            {o?.overridden && <span className="rounded bg-transit/15 px-1.5 py-0.5 font-mono text-[10px] text-transit">CHANGED</span>}
            {me?.isSupervisor && (
              <span className="ml-auto"><GhostButton onClick={() => setEditing(date)}>Edit</GhostButton></span>
            )}
          </div>
        );
      })}
      {editing && <TimeEditModal shift={shift} date={editing} times={c.times} overrides={c.overrides} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function useShiftNames() {
  const c = useShiftClock();
  return useMemo(() => {
    const m = new Map<string, string>();
    c.shifts.forEach((s) => m.set(s.id, s.name));
    return (id?: string | null) => (id ? m.get(id) ?? "Shift" : "—");
  }, [c.shifts]);
}

export type { ReactNode };
