import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAllLoads, useLoads, useProfiles, useTrucks } from "@/hooks/useTms";
import { useHandoffs, useShiftClock } from "@/hooks/useShifts";
import { useAttention } from "@/hooks/useAttention";
import { ACTIVE_STATUSES, label } from "@/lib/tms";
import { addDays } from "@/lib/shifts";
import { Panel, PanelHeader, EmptyRow } from "@/components/ui-kit";
import { fmtTime } from "@/components/entity-kit";
import { HandoffCard, ShiftBanner } from "@/components/shifts-kit";
import { ExpiryAlerts, useExpiryItems } from "@/components/expiry-alerts";
import { DispatchTasksPanel } from "@/components/tasks-kit";
import { usePlanRows } from "@/components/maintenance-kit";

export const Route = createFileRoute("/_authenticated/command")({
  head: () => ({
    meta: [
      { title: "Command center — Vantera TMS" },
      {
        name: "description",
        content: "Everything that needs attention across updates, dispatch, safety and fleet.",
      },
    ],
  }),
  component: CommandCenter,
});

type To =
  | "/updates"
  | "/dispatch"
  | "/safety"
  | "/maintenance"
  | "/trucks"
  | "/trailers"
  | "/loads"
  | "/billing";
type Attention = { key: string; tone: "problem" | "transit"; tag: string; text: string; to: To };

function CommandCenter() {
  const { data: loads = [] } = useLoads();
  const { data: allLoads = [] } = useAllLoads();
  const { data: trucks = [] } = useTrucks();
  const { data: profiles = [] } = useProfiles();
  const { data: handoffs = [] } = useHandoffs();
  const c = useShiftClock();
  const plans = usePlanRows();
  const expiries = useExpiryItems();

  const { data: feed = [] } = useQuery({
    queryKey: ["command-feed"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [a, e] = await Promise.all([
        supabase
          .from("activity_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(15),
        supabase
          .from("load_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(15),
      ]);
      const rows = [
        ...(a.data ?? []).map((x) => ({
          id: `a${x.id}`,
          at: x.created_at,
          who: x.actor_id,
          text: x.description,
          kind: x.entity_type as string,
        })),
        ...(e.data ?? []).map((x) => ({
          id: `e${x.id}`,
          at: x.created_at,
          who: x.actor_id,
          text: x.description ?? x.event_type,
          kind: `load ${x.load_id}`,
        })),
      ];
      return rows.sort((p, q) => q.at.localeCompare(p.at)).slice(0, 15);
    },
  });

  const nowMs = Date.now();
  const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
  const active = loads.filter((l) => ACTIVE_STATUSES.includes(l.status));
  const unassigned = loads.filter(
    (l) =>
      !l.driver_id &&
      !["delivered", "paid", "cancelled", "rejected", "tonu", "pod_received", "billing"].includes(
        l.status,
      ),
  );
  const problems = loads.filter((l) => l.is_problem);
  const overdueUpdates = active.filter(
    (l) => !l.is_problem && l.next_update_at && new Date(l.next_update_at).getTime() < nowMs,
  );
  const pickupSoon = unassigned.filter((l) => l.pickup_date && l.pickup_date <= tomorrow);
  const shopTrucks = trucks.filter((t) => ["in_shop", "out_of_service"].includes(t.status));
  const planOverdue = plans.filter((p) => p.status.state === "overdue");
  const planSoon = plans.filter((p) => p.status.state === "due_soon");
  const expired = expiries.filter((i) => i.days < 0);
  const expSoon = expiries.filter((i) => i.days >= 0 && i.days <= 14);

  const { all: attention } = useAttention();

  const who = (id?: string | null) => profiles.find((p) => p.id === id)?.full_name ?? "System";
  const loadNo = (kind: string) =>
    kind.startsWith("load ")
      ? (allLoads.find((l) => l.id === kind.slice(5))?.load_number ?? "load")
      : kind;
  const shiftName = (id: string | null) => c.shifts.find((s) => s.id === id)?.name;

  const tiles: { text: string; value: number; to: To; tone?: string }[] = [
    { text: "Active loads", value: active.length, to: "/loads" },
    {
      text: "Problems",
      value: problems.length,
      to: "/updates",
      tone: problems.length ? "text-problem" : "",
    },
    {
      text: "Updates late",
      value: overdueUpdates.length,
      to: "/updates",
      tone: overdueUpdates.length ? "text-transit" : "",
    },
    {
      text: "No driver",
      value: unassigned.length,
      to: "/dispatch",
      tone: pickupSoon.length ? "text-problem" : "",
    },
    {
      text: "Expired / expiring",
      value: expired.length + expSoon.length,
      to: "/safety",
      tone: expired.length ? "text-problem" : "",
    },
    {
      text: "Service overdue",
      value: planOverdue.length,
      to: "/maintenance",
      tone: planOverdue.length ? "text-problem" : "",
    },
    {
      text: "Trucks in shop",
      value: shopTrucks.length,
      to: "/trucks",
      tone: shopTrucks.length ? "text-transit" : "",
    },
    {
      text: "Payments overdue",
      value: attention.filter((a) => a.tag === "PAYMENT OVERDUE").length,
      to: "/billing",
      tone: attention.some((a) => a.tag === "PAYMENT OVERDUE") ? "text-problem" : "",
    },
  ];

  return (
    <div className="space-y-4">
      <ShiftBanner />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.text}
            to={t.to}
            className="rounded-xl bg-panel p-4 ring-1 ring-line hover:ring-accent/40"
          >
            <div className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
              {t.text}
            </div>
            <div className={`num mt-1 font-display text-2xl font-semibold ${t.tone ?? ""}`}>
              {t.value}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel>
          <PanelHeader title="Needs attention" count={`${attention.length} items`} />
          {attention.length === 0 ? (
            <EmptyRow text="Nothing needs attention right now." />
          ) : (
            <div className="max-h-[520px] divide-y divide-line/60 overflow-y-auto">
              {attention.map((a) => (
                <Link
                  key={a.key}
                  to={a.to}
                  className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-panel2"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${a.tone === "problem" ? "bg-problem/12 text-problem" : "bg-transit/15 text-transit"}`}
                  >
                    {a.tag}
                  </span>
                  <span className="text-fg">{a.text}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Latest shift handoffs" count={`${handoffs.length} total`}>
            <Link to="/shifts" className="text-xs text-accent">
              All shifts
            </Link>
          </PanelHeader>
          <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
            {handoffs.length === 0 && <EmptyRow text="No handoffs written yet." />}
            {handoffs.slice(0, 5).map((h) => (
              <HandoffCard key={h.id} h={h} showShift shiftName={shiftName(h.shift_id)} />
            ))}
          </div>
        </Panel>
      </div>

      <DispatchTasksPanel openOnly />

      <ExpiryAlerts title="Expiring documents and dates (all)" />

      <Panel>
        <PanelHeader title="Recent activity" count="last 15" />
        {feed.length === 0 ? (
          <EmptyRow text="No activity yet." />
        ) : (
          <div className="divide-y divide-line/60">
            {feed.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-xs">
                <span className="font-mono text-[10px] text-mut">{fmtTime(f.at)}</span>
                <span className="font-medium text-fg">{who(f.who)}</span>
                <span className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-mut">
                  {loadNo(f.kind)}
                </span>
                <span className="text-mut">{f.text}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
