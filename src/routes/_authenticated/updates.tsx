import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLoads, useDrivers, useTrucks, logLoadEvent, type Load } from "@/hooks/useTms";
import { DriverLocationsPanel } from "@/components/DriverLocationsPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { ACTIVE_STATUSES, label } from "@/lib/tms";
import { StatusPill } from "@/components/StatusPill";
import {
  EmptyRow,
  GhostButton,
  Modal,
  Panel,
  PanelHeader,
  PrimaryButton,
  TextInput,
} from "@/components/ui-kit";
import { MiniSelect, SearchBox, exportCsv, fmtTime } from "@/components/entity-kit";
import { FolderView, HandoffAlert, ShiftBanner } from "@/components/shifts-kit";
import { MyTasksPanel } from "@/components/tasks-kit";
import { useMyShiftId, useShiftClock } from "@/hooks/useShifts";
import { useBusinessSettings } from "@/hooks/useSettings";
import { minutesLate, nextUpdateAt } from "@/lib/intervals";

export const Route = createFileRoute("/_authenticated/updates")({
  head: () => ({
    meta: [
      { title: "Update Board — Vantera TMS" },
      { name: "description", content: "Quick status and location updates for active loads." },
      { property: "og:title", content: "Update Board — Vantera TMS" },
      {
        property: "og:description",
        content: "Quick status and location updates for active loads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UpdatesPage,
});

const QUICK: { status: string; text: string }[] = [
  { status: "at_pickup", text: "Arrived Pickup" },
  { status: "loading", text: "Loaded" },
  { status: "picked_up", text: "Picked Up" },
  { status: "in_transit", text: "In Transit" },
  { status: "at_delivery", text: "Arrived Delivery" },
  { status: "delivered", text: "Delivered" },
];

function UpdatesPage() {
  const [tab, setTab] = useState<"board" | "shift">("board");
  return (
    <div className="space-y-4">
      <ShiftBanner />
      <HandoffAlert />
      <MyTasksPanel />
      <div className="flex gap-2">
        <GhostButton active={tab === "board"} onClick={() => setTab("board")}>
          Update board
        </GhostButton>
        <GhostButton active={tab === "shift"} onClick={() => setTab("shift")}>
          My shift folder
        </GhostButton>
      </div>
      {tab === "board" ? <UpdateBoard /> : <MyShiftFolder />}
    </div>
  );
}

/** The signed-in person's shift folder (handoffs, team, times). */
function MyShiftFolder() {
  const c = useShiftClock();
  const mine = useMyShiftId();
  const [pick, setPick] = useState("");
  const folder = pick || mine || c.current[0]?.shiftId || c.shifts[0]?.id || "";
  if (c.shifts.length === 0)
    return <Panel className="p-4 text-xs text-mut">No shifts are set up yet.</Panel>;
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <MiniSelect
          value={folder}
          onChange={setPick}
          options={c.shifts.filter((s) => s.is_active).map((s) => ({ value: s.id, text: s.name }))}
        />
        {!mine && (
          <span className="text-[11px] text-mut">
            You are not in a shift folder yet. Ask your supervisor to add you.
          </span>
        )}
      </div>
      {folder && <FolderView shiftId={folder} />}
    </Panel>
  );
}

function UpdateBoard() {
  const { data: loads = [], isLoading } = useLoads();
  const { data: drivers = [] } = useDrivers();
  const { data: trucks = [] } = useTrucks();
  const { can } = usePermissions();
  const canEdit = can("updates", "edit");
  const qc = useQueryClient();
  const clock = useShiftClock();
  const myShift = useMyShiftId();
  const { updateHours } = useBusinessSettings();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [problemOnly, setProblemOnly] = useState(false);
  const [editing, setEditing] = useState<Load | null>(null);

  const drv = (id?: string | null) => drivers.find((d) => d.id === id)?.full_name ?? "—";
  const trk = (id?: string | null) => trucks.find((t) => t.id === id)?.truck_number ?? "—";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return loads
      .filter((l) => ACTIVE_STATUSES.includes(l.status) || l.is_problem)
      .filter((l) => !status || l.status === status)
      .filter((l) => !problemOnly || l.is_problem)
      .filter(
        (l) =>
          !q ||
          [
            l.load_number,
            drv(l.driver_id),
            trk(l.truck_id),
            l.current_location,
            l.pickup_location,
            l.delivery_location,
          ].some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(q),
          ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, search, status, problemOnly, drivers, trucks]);

  async function patch(l: Load, values: Partial<Load>, event: string, desc: string) {
    const { error } = await supabase.from("loads").update(values).eq("id", l.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Remember which shift made this update and whether it was on time (feeds the shift performance report).
    const counts = event === "status_change" || event === "location_update";
    await logLoadEvent(
      l.id,
      event,
      desc,
      counts
        ? {
            late_minutes: minutesLate(l.next_update_at),
            shift_id: clock.current[0]?.shiftId ?? myShift,
          }
        : undefined,
    );
    qc.invalidateQueries({ queryKey: ["loads"] });
    qc.invalidateQueries({ queryKey: ["load-events", l.id] });
    toast.success(`${l.load_number}: ${desc}`);
  }

  // A new status automatically sets when the next check call is due (hours are editable in Settings).
  const quick = (l: Load, s: string) =>
    patch(
      l,
      {
        status: s,
        last_location_update: new Date().toISOString(),
        next_update_at: nextUpdateAt(s, updateHours),
      },
      "status_change",
      `Status set to ${label(s)}`,
    );

  const toggleProblem = (l: Load) => {
    if (l.is_problem) {
      void patch(
        l,
        { is_problem: false, problem_note: null },
        "problem_cleared",
        "Problem cleared",
      );
      return;
    }
    const note = prompt("Describe the problem");
    if (note === null) return;
    patch(
      l,
      { is_problem: true, problem_note: note || "Problem reported" },
      "problem",
      `Problem: ${note || "reported"}`,
    );
  };

  return (
    <>
      <DriverLocationsPanel
        title="Drivers · last known locations"
        drivers={drivers.filter((driver) => driver.status !== "inactive")}
        loads={loads}
        canEdit={canEdit}
      />
      <Panel>
        <PanelHeader title="Update Board" count={`${shown.length} active`}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Load, driver, truck, location…"
          />
          <MiniSelect
            value={status}
            onChange={setStatus}
            options={[
              { value: "", text: "All statuses" },
              ...ACTIVE_STATUSES.map((s) => ({ value: s, text: label(s) })),
            ]}
          />
          <GhostButton active={problemOnly} onClick={() => setProblemOnly((v) => !v)}>
            Problems only
          </GhostButton>
          {can("updates", "export") && (
            <GhostButton
              onClick={() =>
                exportCsv(
                  "updates.csv",
                  shown.map((l) => ({
                    Load: l.load_number,
                    Driver: drv(l.driver_id),
                    Truck: trk(l.truck_id),
                    Location: l.current_location,
                    Status: label(l.status),
                    Pickup: l.pickup_location,
                    Delivery: l.delivery_location,
                    ETA: l.eta,
                    "Last update": l.last_location_update,
                    "Next update": l.next_update_at,
                    Problem: l.problem_note,
                    Notes: l.notes,
                  })),
                )
              }
            >
              Export CSV
            </GhostButton>
          )}
        </PanelHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                {[
                  "Load",
                  "Driver",
                  "Truck",
                  "Location",
                  "Status",
                  "Pickup",
                  "Delivery",
                  "ETA",
                  "Last update",
                  "Next update",
                  "Problem",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const overdue = l.next_update_at && new Date(l.next_update_at) < new Date();
                return (
                  <tr
                    key={l.id}
                    className={`border-b border-line/50 align-top ${l.is_problem ? "bg-problem/5" : ""}`}
                  >
                    <td className="px-3 py-2.5 font-mono">{l.load_number}</td>
                    <td className="px-3 py-2.5">{drv(l.driver_id)}</td>
                    <td className="px-3 py-2.5 font-mono">{trk(l.truck_id)}</td>
                    <td className="px-3 py-2.5">{l.current_location ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={l.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      {l.pickup_location ?? "—"}
                      <div className="text-mut">{l.pickup_date ?? ""}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {l.delivery_location ?? "—"}
                      <div className="text-mut">{l.delivery_date ?? ""}</div>
                    </td>
                    <td className="px-3 py-2.5">{fmtTime(l.eta)}</td>
                    <td className="px-3 py-2.5">{fmtTime(l.last_location_update)}</td>
                    <td className={`px-3 py-2.5 ${overdue ? "text-problem" : ""}`}>
                      {fmtTime(l.next_update_at)}
                    </td>
                    <td className="px-3 py-2.5 text-problem">
                      {l.is_problem ? (l.problem_note ?? "Yes") : ""}
                    </td>
                    <td className="px-3 py-2.5">
                      {canEdit ? (
                        <div className="flex min-w-[150px] flex-col gap-1">
                          <select
                            value={l.status}
                            onChange={(e) => quick(l, e.target.value)}
                            className="h-7 w-full rounded-md bg-panel2 px-1.5 text-[11px] text-fg ring-1 ring-line"
                          >
                            {QUICK.map((q) => (
                              <option key={q.status} value={q.status}>
                                {q.text}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            <button
                              onClick={() => toggleProblem(l)}
                              className="h-6 flex-1 rounded-md bg-problem/12 px-2 text-[10px] text-problem ring-1 ring-line"
                            >
                              {l.is_problem ? "Clear problem" : "Problem"}
                            </button>
                            <button
                              onClick={() => setEditing(l)}
                              className="h-6 flex-1 rounded-md bg-accent/12 px-2 text-[10px] text-accent ring-1 ring-line"
                            >
                              Location
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-mut">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isLoading && <EmptyRow text="Loading…" />}
          {!isLoading && shown.length === 0 && <EmptyRow text="No active loads match." />}
        </div>
      </Panel>
      {editing && (
        <LocationModal
          load={editing}
          defaultNext={nextUpdateAt(editing.status, updateHours)}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            await patch(
              editing,
              v,
              "location_update",
              `Location: ${v.current_location ?? "—"}${v.notes ? ` · ${v.notes}` : ""}`,
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

const toLocal = (ts?: string | null) => (ts ? new Date(ts).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function LocationModal({
  load,
  defaultNext,
  onClose,
  onSave,
}: {
  load: Load;
  defaultNext: string | null;
  onClose: () => void;
  onSave: (v: Partial<Load>) => Promise<void>;
}) {
  const [loc, setLoc] = useState(load.current_location ?? "");
  const [eta, setEta] = useState(toLocal(load.eta));
  // Keep a future due time; otherwise suggest the next one from the load status.
  const [next, setNext] = useState(
    toLocal(
      load.next_update_at && new Date(load.next_update_at) > new Date()
        ? load.next_update_at
        : defaultNext,
    ),
  );
  const [notes, setNotes] = useState(load.notes ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Update ${load.load_number}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave({
            current_location: loc || null,
            eta: fromLocal(eta),
            next_update_at: fromLocal(next),
            notes: notes || null,
            last_location_update: new Date().toISOString(),
          });
          setBusy(false);
        }}
      >
        <TextInput label="Current location" value={loc} onChange={setLoc} required />
        <TextInput label="ETA" type="datetime-local" value={eta} onChange={setEta} />
        <TextInput label="Next update due" type="datetime-local" value={next} onChange={setNext} />
        <TextInput label="Notes" value={notes} onChange={setNotes} />
        <div className="flex justify-end">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save update"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
