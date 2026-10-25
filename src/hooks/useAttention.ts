import { useMemo } from "react";
import { useAllLoads, useBrokers, useProfiles, useTrucks } from "./useTms";
import { useTasks } from "./useTasks";
import { isOpen } from "@/lib/tasks";
import { useCurrentUser } from "./useCurrentUser";
import { useExpiryItems } from "@/components/expiry-alerts";
import { usePlanRows } from "@/components/maintenance-kit";
import { billingBuckets } from "@/lib/billing";
import { buildAttention, catsForRoles, type AttentionItem } from "@/lib/attention";

/** Everything that needs attention right now, plus the part this person's role cares about. */
export function useAttention(): { all: AttentionItem[]; mine: AttentionItem[] } {
  const { data: allLoads = [] } = useAllLoads();
  const { data: trucks = [] } = useTrucks();
  const { data: brokers = [] } = useBrokers();
  const { data: me } = useCurrentUser();
  const { data: profiles = [] } = useProfiles();
  const { data: tasks = [] } = useTasks();
  const plans = usePlanRows();
  const expiries = useExpiryItems();
  return useMemo(() => {
    const loads = allLoads.filter((l) => !l.deleted_at);
    const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? "Someone";
    const openTasks = tasks.filter(isOpen).map((t) => ({ ...t, assignee: nameOf(t.assigned_to) }));
    const all = buildAttention({ loads, trucks, plans, expiries, billing: billingBuckets(loads, brokers), tasks: openTasks });
    const cats = catsForRoles(me?.roles ?? []);
    const myTaskIds = new Set(tasks.filter((t) => isOpen(t) && t.assigned_to === me?.id).map((t) => t.id));
    // Tasks given to me always show in my bell; the "nobody acknowledged it" warnings are for the people watching.
    const watching = all.filter((a) => cats.includes(a.cat) && !(a.key.startsWith("task-") && myTaskIds.has(a.key.split(":")[1] ?? "")));
    const personal: AttentionItem[] = tasks
      .filter((t) => isOpen(t) && t.assigned_to === me?.id)
      .map((t) => ({
        key: `mytask:${t.id}`,
        cat: "loads" as const,
        tone: t.priority === "urgent" ? ("problem" as const) : ("transit" as const),
        tag: t.status === "new" ? "NEW TASK" : t.status === "received" ? "TASK RECEIVED" : "TASK IN PROGRESS",
        text: `${t.title} (from ${nameOf(t.created_by)})`,
        to: "/updates" as const,
        windowHours: 4,
      }));
    return { all, mine: [...personal, ...watching] };
  }, [allLoads, trucks, brokers, plans, expiries, me?.roles, me?.id, tasks, profiles]);
}
