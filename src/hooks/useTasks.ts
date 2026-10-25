import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { tbl } from "./useShifts";
import { useCurrentUser } from "./useCurrentUser";
import { useProfiles } from "./useTms";
import { isOpen, type Task, type TaskStatus } from "@/lib/tasks";

/** All dispatch tasks (newest first). Refreshes every 20 seconds so new tasks show up without reloading. */
export const useTasks = () =>
  useQuery({
    queryKey: ["dispatch-tasks"],
    refetchInterval: 20_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await tbl("dispatch_tasks").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Task[];
    },
  });

/** Tasks assigned to the signed-in person. */
export function useMyTasks() {
  const { data: me } = useCurrentUser();
  const q = useTasks();
  const mine = useMemo(() => (q.data ?? []).filter((t) => t.assigned_to === me?.id), [q.data, me?.id]);
  return { ...q, tasks: mine };
}

export function useTaskActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["dispatch-tasks"] });
  return {
    async setStatus(task: Pick<Task, "id">, status: TaskStatus, doneNote?: string) {
      const values: Record<string, unknown> = { status };
      if (status === "done" && doneNote !== undefined) values["done_note"] = doneNote.trim() || null;
      const { error } = await tbl("dispatch_tasks").update(values).eq("id", task.id);
      if (error) {
        toast.error(error.message);
        return false;
      }
      await refresh();
      return true;
    },
    async create(input: { title: string; details: string | null; load_id: string | null; assigned_to: string; priority: "normal" | "urgent"; due_at: string | null }) {
      const { error } = await tbl("dispatch_tasks").insert(input);
      if (error) {
        toast.error(error.message);
        return false;
      }
      await refresh();
      return true;
    },
    async remove(id: string) {
      const { error } = await tbl("dispatch_tasks").delete().eq("id", id);
      if (error) return void toast.error(error.message);
      await refresh();
    },
  };
}

/** Pops up a message when a new task for this person arrives (checked every 20 seconds). Renders nothing. */
export function TaskToaster() {
  const { tasks, isSuccess } = useMyTasks();
  const { data: profiles = [] } = useProfiles();
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!isSuccess) return;
    const open = tasks.filter(isOpen);
    if (seen.current === null) {
      seen.current = new Set(open.map((t) => t.id)); // tasks already waiting when the app opened are shown by the bell
      return;
    }
    for (const t of open) {
      if (seen.current.has(t.id)) continue;
      seen.current.add(t.id);
      const from = profiles.find((p) => p.id === t.created_by)?.full_name ?? "Dispatch";
      toast(`${t.priority === "urgent" ? "URGENT task" : "New task"} from ${from}`, {
        description: t.title,
        duration: 15000,
        action: { label: "Open", onClick: () => void navigate({ to: "/updates" }) },
      });
    }
  }, [tasks, isSuccess, profiles, navigate]);
  return null;
}
