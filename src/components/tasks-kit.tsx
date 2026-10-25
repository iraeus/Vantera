import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { useLoads, useProfiles } from "@/hooks/useTms";
import { useShiftClock } from "@/hooks/useShifts";
import { useMyTasks, useTaskActions, useTasks } from "@/hooks/useTasks";
import { onDutyUserIds } from "@/lib/shifts";
import { ACTIVE_STATUSES } from "@/lib/tms";
import { TASK_STATUS_TEXT, TASK_STEPS, isOpen, isOverdue, minutesBetween, sortOpen, type Task, type TaskStatus } from "@/lib/tasks";
import { EmptyRow, GhostButton, Modal, Panel, PanelHeader, PrimaryButton, SelectInput, TextInput } from "./ui-kit";
import { TextArea } from "./shifts-kit";
import { fmtTime } from "./entity-kit";

function useNames() {
  const { data: profiles = [] } = useProfiles();
  return (id?: string | null) => profiles.find((p) => p.id === id)?.full_name || profiles.find((p) => p.id === id)?.email || "Unknown";
}

const statusChip: Record<TaskStatus, string> = {
  new: "bg-transit/15 text-transit",
  received: "bg-accent/12 text-accent",
  on_it: "bg-accent/12 text-accent",
  done: "bg-delivered/12 text-delivered",
};

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${statusChip[status]}`}>{TASK_STATUS_TEXT[status]}</span>;
}

/** "Waiting -> Received 12:41 -> On it 12:45 -> Done 13:10" */
function Timeline({ t }: { t: Task }) {
  const bits: string[] = [`Sent ${fmtTime(t.created_at)}`];
  if (t.received_at) bits.push(`Received ${fmtTime(t.received_at)}${minutesBetween(t.created_at, t.received_at) !== null ? ` (${minutesBetween(t.created_at, t.received_at)} min)` : ""}`);
  if (t.started_at) bits.push(`On it ${fmtTime(t.started_at)}`);
  if (t.done_at) bits.push(`Done ${fmtTime(t.done_at)}`);
  return <div className="font-mono text-[10px] text-mut">{bits.join("  →  ")}</div>;
}

/** The three buttons: Received / On it / Done. */
function StatusButtons({ task, onPick }: { task: Task; onPick: (s: Exclude<TaskStatus, "new">) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {TASK_STEPS.map((s) => {
        const active = task.status === s.value;
        const tone = s.value === "done" ? "bg-delivered text-ink ring-delivered" : "bg-accent text-ink ring-accent";
        return (
          <button
            key={s.value}
            onClick={() => onPick(s.value)}
            className={`h-10 rounded-lg text-xs font-semibold ring-1 ${active ? tone : "bg-panel2 text-fg ring-line hover:ring-accent/40"}`}
          >
            {s.text}
          </button>
        );
      })}
    </div>
  );
}

function DoneModal({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Done: ${task.title}`} onClose={onClose}>
      <div className="space-y-3">
        <TextArea label="Note for dispatch (optional)" value={note} onChange={setNote} placeholder="What was done, anything dispatch should know…" />
        <div className="flex justify-end">
          <PrimaryButton
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDone(note);
              setBusy(false);
            }}
          >
            Mark as done
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function useLoadLabel() {
  const { data: loads = [] } = useLoads();
  return (id: string | null) => {
    const l = loads.find((x) => x.id === id);
    return l ? `${l.load_number}${l.pickup_location || l.delivery_location ? ` · ${l.pickup_location ?? "?"} → ${l.delivery_location ?? "?"}` : ""}` : null;
  };
}

/* ------------------------------------------------------------------ */
/* For the person doing the tasks (Update Board)                        */
/* ------------------------------------------------------------------ */
export function MyTasksPanel() {
  const { tasks, isError } = useMyTasks();
  const act = useTaskActions();
  const names = useNames();
  const loadLabel = useLoadLabel();
  const [doing, setDoing] = useState<Task | null>(null);
  const open = sortOpen(tasks.filter(isOpen));
  const doneToday = tasks.filter((t) => t.status === "done" && t.done_at && Date.now() - new Date(t.done_at).getTime() < 24 * 3600_000);

  async function pick(t: Task, s: Exclude<TaskStatus, "new">) {
    if (s === "done") return void setDoing(t);
    if (await act.setStatus(t, s)) toast.success(s === "received" ? "Marked as received" : "Marked as in progress");
  }

  if (isError) return null;
  return (
    <Panel>
      <PanelHeader title="My tasks" count={open.length ? `${open.length} open` : "nothing open"} />
      {open.length === 0 && <EmptyRow text="No tasks from dispatch right now." />}
      <div className="space-y-3 p-3">
        {open.map((t) => {
          const lbl = loadLabel(t.load_id);
          return (
            <div key={t.id} className={`space-y-2 rounded-xl bg-panel2 p-3 ring-1 ${t.priority === "urgent" ? "ring-problem/50" : "ring-line"}`}>
              <div className="flex flex-wrap items-center gap-2">
                {t.priority === "urgent" && <span className="rounded bg-problem/12 px-1.5 py-0.5 font-mono text-[10px] text-problem">URGENT</span>}
                <TaskStatusChip status={t.status} />
                <span className="text-sm font-medium text-fg">{t.title}</span>
                <span className="ml-auto font-mono text-[10px] text-mut">from {names(t.created_by)} · {fmtTime(t.created_at)}</span>
              </div>
              {t.details && <p className="whitespace-pre-wrap text-xs text-fg">{t.details}</p>}
              <div className="flex flex-wrap gap-x-4 text-[11px] text-mut">
                {lbl && <span>Load {lbl}</span>}
                {t.due_at && <span className={isOverdue(t) ? "text-problem" : ""}>Due {fmtTime(t.due_at)}{isOverdue(t) ? " (overdue)" : ""}</span>}
              </div>
              <StatusButtons task={t} onPick={(s) => pick(t, s)} />
              <Timeline t={t} />
            </div>
          );
        })}
        {doneToday.length > 0 && (
          <details className="text-xs text-mut">
            <summary className="cursor-pointer">Done in the last 24 hours ({doneToday.length})</summary>
            <div className="mt-2 space-y-1.5">
              {doneToday.map((t) => (
                <div key={t.id} className="rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line">
                  <div className="text-fg">{t.title}</div>
                  <Timeline t={t} />
                  {t.done_note && <div className="mt-1 text-[11px]">Note: {t.done_note}</div>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
      {doing && (
        <DoneModal
          task={doing}
          onClose={() => setDoing(null)}
          onDone={async (note) => {
            if (await act.setStatus(doing, "done", note)) toast.success("Task done. Dispatch can see it.");
            setDoing(null);
          }}
        />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* For dispatch: create tasks and watch their progress                  */
/* ------------------------------------------------------------------ */
const QUICK_TITLES = ["Check call on load", "Call the broker", "Upload the POD", "Update the ETA", "Chase driver for documents"];

function NewTaskModal({ onClose }: { onClose: () => void }) {
  const act = useTaskActions();
  const { data: profiles = [] } = useProfiles();
  const { data: loads = [] } = useLoads();
  const c = useShiftClock();
  const { data: roleRows = [] } = useQuery({
    queryKey: ["all-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [who, setWho] = useState("");
  const [loadId, setLoadId] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const onDuty = useMemo(() => {
    const ids = new Set<string>();
    for (const o of c.current) onDutyUserIds(o.shiftId, o.date, c.members, c.covers).forEach((u) => ids.add(u));
    return ids;
  }, [c.current, c.members, c.covers]);
  const isUpdater = (id: string) => roleRows.some((r) => r.user_id === id && r.role === "updater");

  const people = useMemo(() => {
    const rank = (id: string) => (onDuty.has(id) && isUpdater(id) ? 0 : isUpdater(id) ? 1 : onDuty.has(id) ? 2 : 3);
    return profiles
      .filter((p) => p.is_active)
      .sort((a, b) => rank(a.id) - rank(b.id) || (a.full_name ?? "").localeCompare(b.full_name ?? ""))
      .map((p) => ({
        value: p.id,
        text: `${p.full_name || p.email || "Unknown"}${isUpdater(p.id) ? " (updater)" : ""}${onDuty.has(p.id) ? " · on duty now" : ""}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, onDuty, roleRows]);

  const activeLoads = loads.filter((l) => ACTIVE_STATUSES.includes(l.status) || l.is_problem);

  async function submit() {
    if (!title.trim()) return void toast.error("Write what the task is");
    if (!who) return void toast.error("Choose who should do it");
    setBusy(true);
    const ok = await act.create({
      title: title.trim(),
      details: details.trim() || null,
      load_id: loadId || null,
      assigned_to: who,
      priority,
      due_at: due ? new Date(due).toISOString() : null,
    });
    setBusy(false);
    if (ok) {
      toast.success("Task sent");
      onClose();
    }
  }

  return (
    <Modal wide title="New task" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <TextInput label="What needs to be done" value={title} onChange={setTitle} placeholder="e.g. Check call on load 1234" />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {QUICK_TITLES.map((q) => (
              <button key={q} onClick={() => setTitle(q)} className="rounded-md bg-panel2 px-2 py-1 text-[11px] text-mut ring-1 ring-line hover:text-fg">{q}</button>
            ))}
          </div>
        </div>
        <TextArea label="Details (optional)" value={details} onChange={setDetails} placeholder="Phone numbers, what to say, what to ask…" />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput label="Give it to" value={who} onChange={setWho} options={[{ value: "", text: "Choose a person…" }, ...people]} />
          <SelectInput
            label="Load (optional)"
            value={loadId}
            onChange={setLoadId}
            options={[{ value: "", text: "No load" }, ...activeLoads.map((l) => ({ value: l.id, text: `${l.load_number} · ${l.pickup_location ?? "?"} → ${l.delivery_location ?? "?"}` }))]}
          />
          <SelectInput
            label="Priority"
            value={priority}
            onChange={(v) => setPriority(v as "normal" | "urgent")}
            options={[{ value: "normal", text: "Normal" }, { value: "urgent", text: "Urgent" }]}
          />
          <TextInput label="Due by (optional)" type="datetime-local" value={due} onChange={setDue} />
        </div>
        <div className="flex justify-end">
          <PrimaryButton onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send task"}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

export function DispatchTasksPanel({ openOnly = false }: { openOnly?: boolean }) {
  const { data: tasks = [], isError, isLoading } = useTasks();
  const { data: me } = useCurrentUser();
  const { can } = usePermissions();
  const act = useTaskActions();
  const names = useNames();
  const loadLabel = useLoadLabel();
  const [tab, setTab] = useState<"open" | "done" | "all">("open");
  const [creating, setCreating] = useState(false);

  const shown = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const list =
      openOnly || tab === "open" ? sortOpen(tasks.filter(isOpen)) : tab === "done" ? tasks.filter((t) => t.status === "done" && new Date(t.created_at).getTime() > weekAgo) : tasks.slice(0, 100);
    return list;
  }, [tasks, tab, openOnly]);
  const openCount = tasks.filter(isOpen).length;

  if (isError) {
    return (
      <Panel>
        <PanelHeader title="Tasks for updaters" />
        <EmptyRow text="Tasks are not set up yet. Run the fourth SQL file (4-dispatch-tasks.sql) in Supabase." />
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Tasks for updaters" count={`${openCount} open`}>
        {!openOnly && (
          <>
            <GhostButton active={tab === "open"} onClick={() => setTab("open")}>Open</GhostButton>
            <GhostButton active={tab === "done"} onClick={() => setTab("done")}>Done (7 days)</GhostButton>
            <GhostButton active={tab === "all"} onClick={() => setTab("all")}>All</GhostButton>
          </>
        )}
        {can("tasks", "create") && <PrimaryButton onClick={() => setCreating(true)}>+ New task</PrimaryButton>}
      </PanelHeader>
      {isLoading && <EmptyRow text="Loading…" />}
      {!isLoading && shown.length === 0 && <EmptyRow text={tab === "open" || openOnly ? "No open tasks. Press “New task” to give one to an updater." : "Nothing here."} />}
      <div className="divide-y divide-line/60">
        {shown.map((t) => {
          const lbl = loadLabel(t.load_id);
          const canManage = !!me && (t.created_by === me.id || me.isSupervisor);
          return (
            <div key={t.id} className="space-y-1 px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {t.priority === "urgent" && <span className="rounded bg-problem/12 px-1.5 py-0.5 font-mono text-[10px] text-problem">URGENT</span>}
                <TaskStatusChip status={t.status} />
                <span className="font-medium text-fg">{t.title}</span>
                <span className="text-mut">→ {names(t.assigned_to)}</span>
                {lbl && <span className="font-mono text-[10px] text-mut">{lbl}</span>}
                {t.due_at && <span className={`font-mono text-[10px] ${isOverdue(t) ? "text-problem" : "text-mut"}`}>due {fmtTime(t.due_at)}</span>}
                {canManage && (
                  <span className="ml-auto flex gap-1.5">
                    {isOpen(t) && <GhostButton onClick={() => act.setStatus(t, "done")}>Close</GhostButton>}
                    <GhostButton onClick={() => confirm("Delete this task?") && act.remove(t.id)}>Delete</GhostButton>
                  </span>
                )}
              </div>
              {t.details && <p className="whitespace-pre-wrap text-mut">{t.details}</p>}
              <Timeline t={t} />
              {t.done_note && <p className="text-[11px] text-mut">Note: {t.done_note}</p>}
            </div>
          );
        })}
      </div>
      {creating && <NewTaskModal onClose={() => setCreating(false)} />}
    </Panel>
  );
}
