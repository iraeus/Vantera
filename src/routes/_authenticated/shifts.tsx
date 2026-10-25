import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHandoffs, useHandoffReads, useShiftClock, tbl } from "@/hooks/useShifts";
import { addDays, DOW_LABELS, fmt12, fmtRange, mondayOf, occurrenceOn, onDutyUserIds, WEEK_ORDER, type Shift } from "@/lib/shifts";
import { EmptyRow, GhostButton, Modal, Panel, PanelHeader, PrimaryButton, TextInput } from "@/components/ui-kit";
import { FolderView, ShiftBanner, TimeEditModal } from "@/components/shifts-kit";
import { fmtTime, MiniSelect } from "@/components/entity-kit";

export const Route = createFileRoute("/_authenticated/shifts")({
  head: () => ({
    meta: [
      { title: "Shifts — Vantera TMS" },
      { name: "description", content: "Shift folders, schedule, teams and handoffs." },
    ],
  }),
  component: ShiftsPage,
});

function ShiftsPage() {
  const { data: me } = useCurrentUser();
  const [tab, setTab] = useState<"folders" | "schedule" | "settings">("folders");
  return (
    <div className="space-y-4">
      <ShiftBanner />
      <div className="flex gap-2">
        <GhostButton active={tab === "folders"} onClick={() => setTab("folders")}>Shift folders</GhostButton>
        <GhostButton active={tab === "schedule"} onClick={() => setTab("schedule")}>Weekly schedule</GhostButton>
        {me?.isSupervisor && <GhostButton active={tab === "settings"} onClick={() => setTab("settings")}>Settings</GhostButton>}
      </div>
      {tab === "folders" && <Folders />}
      {tab === "schedule" && <Schedule />}
      {tab === "settings" && me?.isSupervisor && <Settings />}
    </div>
  );
}

/* ---------- folders ---------- */
function Folders() {
  const c = useShiftClock();
  const { data: handoffs = [] } = useHandoffs();
  const { data: reads = [] } = useHandoffReads();
  const [open, setOpen] = useState<string | null>(null);
  const active = c.shifts.filter((s) => s.is_active);
  if (c.missingTables) return <EmptyRow text="Shifts are not set up in the database yet. Run the two SQL files from the update pack." />;
  if (active.length === 0) return <EmptyRow text="No shifts yet. Open Settings to add one." />;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((s) => {
          const now = c.current.find((o) => o.shiftId === s.id);
          const today = occurrenceOn(s.id, c.clock.date, c.times, c.overrides);
          const team = c.members.filter((m) => m.shift_id === s.id).length;
          const onDuty = onDutyUserIds(s.id, c.clock.date, c.members, c.covers).length;
          const last = handoffs.find((h) => h.shift_id === s.id);
          const lastReads = last ? reads.filter((r) => r.handoff_id === last.id).length : 0;
          return (
            <button key={s.id} onClick={() => setOpen(s.id)} className="rounded-xl bg-panel p-4 text-left ring-1 ring-line hover:ring-accent/40">
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-semibold tracking-tight">{s.name}</span>
                {now && <span className="rounded bg-accent/12 px-1.5 py-0.5 font-mono text-[10px] text-accent">ON NOW</span>}
              </div>
              <div className="mt-1 text-xs text-mut">{today ? `Today ${fmtRange(today.start, today.end)}${today.overridden ? " · changed" : ""}` : "Off today"}</div>
              <div className="mt-3 flex gap-4 text-xs text-mut">
                <span><span className="num text-fg">{team}</span> in team</span>
                <span><span className="num text-fg">{onDuty}</span> on duty today</span>
              </div>
              <div className="mt-2 border-t border-line pt-2 text-[11px] text-mut">
                {last ? `Last handoff ${fmtTime(last.created_at)} · read by ${lastReads}` : "No handoff written yet"}
              </div>
            </button>
          );
        })}
      </div>
      {open && (
        <Modal wide title={c.shifts.find((s) => s.id === open)?.name ?? "Shift"} onClose={() => setOpen(null)}>
          <FolderView shiftId={open} />
        </Modal>
      )}
    </>
  );
}

/* ---------- weekly grid ---------- */
function Schedule() {
  const c = useShiftClock();
  const { data: me } = useCurrentUser();
  const [weekStart, setWeekStart] = useState(() => mondayOf(c.clock.date));
  const [edit, setEdit] = useState<{ shift: Shift; date: string } | null>(null);
  const days = WEEK_ORDER.map((_, i) => addDays(weekStart, i));
  const active = c.shifts.filter((s) => s.is_active);
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (c.missingTables) return <EmptyRow text="Shifts are not set up in the database yet. Run the two SQL files from the update pack." />;
  return (
    <Panel>
      <PanelHeader title="Weekly schedule" count={`${label(days[0] ?? weekStart)} – ${label(days[6] ?? weekStart)}`}>
        <GhostButton onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous</GhostButton>
        <GhostButton onClick={() => setWeekStart(mondayOf(c.clock.date))}>This week</GhostButton>
        <GhostButton onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</GhostButton>
      </PanelHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
              <th className="px-3 py-2 font-normal">Shift</th>
              {days.map((d) => (
                <th key={d} className={`px-3 py-2 font-normal ${d === c.clock.date ? "text-accent" : ""}`}>
                  {DOW_LABELS[new Date(`${d}T12:00:00Z`).getUTCDay()]} <span className="text-mut">{label(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((s) => (
              <tr key={s.id} className="border-b border-line/50">
                <td className="px-3 py-3 font-medium text-fg">{s.name}</td>
                {days.map((d) => {
                  const o = occurrenceOn(s.id, d, c.times, c.overrides);
                  const live = c.current.some((x) => x.shiftId === s.id && x.date === d);
                  const inner = (
                    <>
                      <div className={o ? "text-fg" : "text-mut"}>{o ? `${fmt12(o.start)}–${fmt12(o.end)}` : "Off"}</div>
                      {o?.overridden && <div className="mt-0.5 font-mono text-[9px] text-transit">CHANGED</div>}
                    </>
                  );
                  return (
                    <td key={d} className="px-1.5 py-1.5">
                      {me?.isSupervisor ? (
                        <button onClick={() => setEdit({ shift: s, date: d })} className={`w-full rounded-lg bg-panel2 px-2 py-2 text-left ring-1 hover:ring-accent/40 ${live ? "ring-accent/60" : "ring-line"}`}>{inner}</button>
                      ) : (
                        <div className={`rounded-lg bg-panel2 px-2 py-2 ring-1 ${live ? "ring-accent/60" : "ring-line"}`}>{inner}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-mut">
        {me?.isSupervisor ? "Click any box to change that shift's times. Times past midnight are shown as ending the next day." : "Only a supervisor can change shift times."}
      </p>
      {edit && <TimeEditModal shift={edit.shift} date={edit.date} times={c.times} overrides={c.overrides} onClose={() => setEdit(null)} />}
    </Panel>
  );
}

/* ---------- settings ---------- */
const FALLBACK_TZ = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];

function Settings() {
  const c = useShiftClock();
  const qc = useQueryClient();
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported("timeZone") : FALLBACK_TZ;
  const [tz, setTz] = useState(c.tzIsSet ? c.tz : "");
  const [newName, setNewName] = useState("");

  async function saveTz() {
    if (!tz) return void toast.error("Pick a timezone");
    const { error } = await tbl("app_settings").upsert({ key: "company_timezone", value: tz, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["company-tz"] });
    toast.success("Timezone saved");
  }
  async function addShift() {
    const name = newName.trim();
    if (!name) return;
    const { data, error } = await tbl("shifts").insert({ name, sort_order: c.shifts.length + 1 }).select().single();
    if (error) return void toast.error(error.message);
    // New shift starts Mon–Fri 8 AM–4 PM; edit the times in the weekly schedule.
    const rows = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ shift_id: data.id, dow: d, start_time: "08:00", end_time: "16:00", is_off: d === 0 || d === 6 }));
    const { error: e2 } = await tbl("shift_times").insert(rows);
    if (e2) toast.error(e2.message);
    setNewName("");
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["shift-times"] });
    toast.success("Shift added. Set its times in the weekly schedule.");
  }
  async function patch(id: string, values: Record<string, unknown>) {
    const { error } = await tbl("shifts").update(values).eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shifts"] });
  }
  async function remove(s: Shift) {
    if (!confirm(`Delete "${s.name}"? Its team list and times are removed. Old handoffs are kept.`)) return;
    const { error } = await tbl("shifts").delete().eq("id", s.id);
    if (error) return void toast.error(error.message);
    ["shifts", "shift-times", "shift-members", "shift-overrides", "handoffs"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast.success("Shift deleted");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3 p-4">
        <div className="font-display text-sm font-semibold">Company timezone</div>
        <p className="text-xs text-mut">Shift times are read in this timezone, no matter where each person is sitting.</p>
        <MiniSelect value={tz} onChange={setTz} options={[{ value: "", text: "Choose a timezone…" }, ...zones.map((z) => ({ value: z, text: z }))]} />
        <div><PrimaryButton onClick={saveTz}>Save timezone</PrimaryButton></div>
      </Panel>
      <Panel className="space-y-3 p-4">
        <div className="font-display text-sm font-semibold">Shifts</div>
        <div className="space-y-2">
          {c.shifts.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line">
              <input
                defaultValue={s.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && patch(s.id, { name: e.target.value.trim() })}
                className="h-8 flex-1 rounded-md bg-ink px-2 text-xs text-fg ring-1 ring-line focus:outline-none"
              />
              <GhostButton active={s.is_active} onClick={() => patch(s.id, { is_active: !s.is_active })}>{s.is_active ? "Active" : "Hidden"}</GhostButton>
              <GhostButton onClick={() => remove(s)}>Delete</GhostButton>
            </div>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1"><TextInput label="Add a shift" value={newName} onChange={setNewName} placeholder="e.g. Shift 4" /></div>
          <PrimaryButton onClick={addShift} disabled={!newName.trim()}>Add</PrimaryButton>
        </div>
      </Panel>
    </div>
  );
}
