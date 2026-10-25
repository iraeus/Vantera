/** Dispatch tasks for updaters (pure helpers). */
export type TaskStatus = "new" | "received" | "on_it" | "done";

export type Task = {
  id: string;
  title: string;
  details: string | null;
  load_id: string | null;
  assigned_to: string;
  created_by: string;
  priority: "normal" | "urgent";
  due_at: string | null;
  status: TaskStatus;
  received_at: string | null;
  started_at: string | null;
  done_at: string | null;
  done_note: string | null;
  created_at: string;
};

/** The three buttons the person doing the task sees. */
export const TASK_STEPS: { value: Exclude<TaskStatus, "new">; text: string }[] = [
  { value: "received", text: "Received" },
  { value: "on_it", text: "On it" },
  { value: "done", text: "Done" },
];

export const TASK_STATUS_TEXT: Record<TaskStatus, string> = {
  new: "Waiting",
  received: "Received",
  on_it: "On it",
  done: "Done",
};

export const isOpen = (t: Pick<Task, "status">) => t.status !== "done";

/** An open task past its due time. */
export const isOverdue = (t: Pick<Task, "status" | "due_at">, now: Date = new Date()) =>
  isOpen(t) && !!t.due_at && new Date(t.due_at).getTime() < now.getTime();

/** A task nobody has acknowledged for more than `minutes`. */
export const isUnreceived = (t: Pick<Task, "status" | "created_at">, now: Date = new Date(), minutes = 15) =>
  t.status === "new" && now.getTime() - new Date(t.created_at).getTime() > minutes * 60000;

/** Urgent first, then oldest first. */
export function sortOpen<T extends Pick<Task, "priority" | "created_at">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => (a.priority === b.priority ? a.created_at.localeCompare(b.created_at) : a.priority === "urgent" ? -1 : 1));
}

/** The next status when the person taps the main button. */
export function nextStatus(s: TaskStatus): Exclude<TaskStatus, "new"> {
  return s === "new" ? "received" : s === "received" ? "on_it" : "done";
}

/** Seconds from creation to a step, for the "how fast did we react" line. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const m = (new Date(to).getTime() - new Date(from).getTime()) / 60000;
  return m >= 0 ? Math.round(m) : null;
}
