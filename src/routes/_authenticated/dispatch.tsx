import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/StatusPill";
import {
  EmptyRow,
  GhostButton,
  Panel,
  PanelHeader,
  PrimaryButton,
  SelectInput,
} from "@/components/ui-kit";
import {
  logLoadEvent,
  useDrivers,
  useLoads,
  useProfiles,
  useTrailers,
  useTrucks,
  type Profile,
} from "@/hooks/useTms";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ACTIVE_STATUSES, label, safetyIssues } from "@/lib/tms";
import { scoreDriver, type DriverScore } from "@/lib/dispatch";
import { addDays } from "@/lib/shifts";
import { automaticDriverDispatchState } from "@/lib/driver-dispatch";
import { usePlanRows } from "@/components/maintenance-kit";
import { DispatchTasksPanel } from "@/components/tasks-kit";
import { DriverLocationsPanel } from "@/components/DriverLocationsPanel";
import { fmtTime } from "@/components/entity-kit";
import { usePermissions } from "@/hooks/usePermissions";
import { useUserPreference } from "@/hooks/useUserPreference";

export const Route = createFileRoute("/_authenticated/dispatch")({
  head: () => ({
    meta: [
      { title: "Dispatch board · Vantera TMS" },
      { name: "description", content: "Assign drivers, trucks and trailers to open loads." },
      { property: "og:title", content: "Dispatch board · Vantera TMS" },
      { property: "og:description", content: "Assign drivers, trucks and trailers to open loads." },
    ],
  }),
  component: Dispatch,
});

const DISPATCH_PANEL_ORDER = [
  "tasks",
  "alerts",
  "unassigned",
  "assigned",
  "drivers",
  "freeing",
  "trucks",
  "trailers",
] as const;
type DispatchPanel = (typeof DISPATCH_PANEL_ORDER)[number];

const DISPATCH_PANEL_LABELS: Record<DispatchPanel, string> = {
  tasks: "Dispatch tasks",
  alerts: "Priority alerts",
  unassigned: "Unassigned loads",
  assigned: "Assigned & rolling",
  drivers: "Dispatch drivers",
  freeing: "Freeing up soon",
  trucks: "Available trucks",
  trailers: "Available trailers",
};

function Dispatch() {
  const { data: loads = [], isLoading } = useLoads();
  const { data: drivers = [] } = useDrivers();
  const { data: profiles = [] } = useProfiles();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { data: me } = useCurrentUser();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [firstPanel, setFirstPanel] = useUserPreference<DispatchPanel>(
    "dispatch-first-panel",
    "tasks",
  );

  const panelOrder = [firstPanel, ...DISPATCH_PANEL_ORDER.filter((panel) => panel !== firstPanel)];

  const unassigned = loads.filter(
    (l) =>
      !l.driver_id && !["delivered", "paid", "cancelled", "rejected", "tonu"].includes(l.status),
  );
  const assigned = loads.filter((l) => l.driver_id && ACTIVE_STATUSES.includes(l.status));

  const busyDriverIds = new Set(assigned.map((l) => l.driver_id));
  const busyTruckIds = new Set(assigned.map((l) => l.truck_id));
  const busyTrailerIds = new Set(assigned.map((l) => l.trailer_id));
  const dispatcherName = (id: string | null) => {
    const profile = profiles.find((person) => person.id === id);
    return profile?.full_name ?? profile?.email ?? "Unassigned";
  };

  // Units that must not be dispatched (in the shop, out of service, sold…).
  const planRows = usePlanRows();
  const UNUSABLE = ["in_shop", "out_of_service", "sold", "inactive"];
  const unusableTrucks = new Set(
    trucks.filter((t) => UNUSABLE.includes(t.status)).map((t) => t.id),
  );
  const unusableTrailers = new Set(
    trailers.filter((t) => UNUSABLE.includes(t.status)).map((t) => t.id),
  );
  const serviceOverdue = (type: "truck" | "trailer", id: string) =>
    planRows.some(
      (p) => p.plan.asset_type === type && p.plan.asset_id === id && p.status.state === "overdue",
    );

  const scoreFor =
    (pickup: string | null) =>
    (driverId: string): DriverScore => {
      const d = drivers.find((x) => x.id === driverId);
      if (!d) return { score: 0, good: [], warn: [] };
      const t = trucks.find((x) => x.assigned_driver_id === driverId);
      return scoreDriver({
        issues: safetyIssues(d),
        driverAvailable: d.status === "available",
        truck: t
          ? {
              unavailable: unusableTrucks.has(t.id),
              serviceOverdue: serviceOverdue("truck", t.id),
              location: t.current_location,
            }
          : null,
        pickup,
      });
    };
  const defaultsFor = (driverId: string) => ({
    truckId:
      trucks.find(
        (t) =>
          t.assigned_driver_id === driverId && !busyTruckIds.has(t.id) && !unusableTrucks.has(t.id),
      )?.id ?? "",
    trailerId:
      trailers.find(
        (t) =>
          t.assigned_driver_id === driverId &&
          !busyTrailerIds.has(t.id) &&
          !unusableTrailers.has(t.id),
      )?.id ?? "",
  });

  // At-risk strip: things dispatch should look at first.
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);
  const risks = useMemo(() => {
    const out: { key: string; tone: "problem" | "transit"; tag: string; text: string }[] = [];
    for (const l of unassigned) {
      if (l.pickup_date && l.pickup_date <= tomorrow) {
        const tag =
          l.pickup_date < today
            ? "PICKUP PASSED"
            : l.pickup_date === today
              ? "PICKUP TODAY"
              : "PICKUP TOMORROW";
        out.push({
          key: `n${l.id}`,
          tone: "problem",
          tag,
          text: `${l.load_number} · ${l.pickup_location ?? "—"} · no driver yet`,
        });
      }
    }
    for (const l of assigned) {
      if (l.is_problem)
        out.push({
          key: `p${l.id}`,
          tone: "problem",
          tag: "PROBLEM",
          text: `${l.load_number} · ${l.problem_note ?? "problem reported"}`,
        });
      else if (l.next_update_at && new Date(l.next_update_at).getTime() < Date.now())
        out.push({
          key: `u${l.id}`,
          tone: "transit",
          tag: "UPDATE LATE",
          text: `${l.load_number} · due ${fmtTime(l.next_update_at)}`,
        });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads]);

  // Drivers about to finish a load (delivery within ~12 hours, or already late).
  const freeingSoon = assigned
    .filter((l) => ["picked_up", "in_transit", "at_delivery", "unloading"].includes(l.status))
    .map((l) => {
      const when =
        l.delivery_eta ?? l.eta ?? (l.delivery_date ? `${l.delivery_date}T12:00:00` : null);
      return { l, when, ms: when ? new Date(when).getTime() : null };
    })
    .filter(
      (x): x is { l: typeof x.l; when: string; ms: number } =>
        x.ms !== null && x.ms - Date.now() <= 12 * 3600_000,
    )
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 8);

  function copyLoad(l: (typeof loads)[number]) {
    const d = drivers.find((x) => x.id === l.driver_id);
    const text = [
      `Load ${l.load_number}`,
      `${l.pickup_location ?? "—"}${l.pickup_date ? ` (${l.pickup_date})` : ""} → ${l.delivery_location ?? "—"}${l.delivery_date ? ` (${l.delivery_date})` : ""}`,
      d ? `Driver: ${d.full_name}${d.phone ? ` ${d.phone}` : ""}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard.writeText(text).then(() => toast.success("Load details copied"));
  }

  async function assign(
    loadId: string,
    driverId: string,
    truckId: string,
    trailerId: string,
    dispatcherId: string,
  ) {
    if (!driverId) {
      toast.error("Pick a driver first");
      return;
    }
    if (truckId && busyTruckIds.has(truckId)) {
      toast.error("That truck is already on an active load");
      return;
    }
    if (trailerId && busyTrailerIds.has(trailerId)) {
      toast.error("That trailer is already on an active load");
      return;
    }
    const currentLoad = loads.find((load) => load.id === loadId);
    if (!currentLoad) {
      toast.error("This load is no longer available. Refresh the board and retry.");
      return;
    }
    const nextLoadStatus = ["new", "available"].includes(currentLoad.status)
      ? "booked"
      : currentLoad.status;
    const drv = drivers.find((d) => d.id === driverId);
    const issues = drv ? safetyIssues(drv) : [];
    const warns = [
      ...(issues.length ? [`${drv?.full_name}: ${issues.join(", ")}`] : []),
      ...(truckId && serviceOverdue("truck", truckId)
        ? [`Truck ${trucks.find((t) => t.id === truckId)?.truck_number}: service is overdue`]
        : []),
      ...(trailerId && serviceOverdue("trailer", trailerId)
        ? [
            `Trailer ${trailers.find((t) => t.id === trailerId)?.trailer_number}: service is overdue`,
          ]
        : []),
    ];
    const { error } = await supabase
      .from("loads")
      .update({
        driver_id: driverId,
        truck_id: truckId || null,
        trailer_id: trailerId || null,
        dispatcher_id: dispatcherId || null,
        status: nextLoadStatus,
      })
      .eq("id", loadId);
    if (error) {
      toast.error(error.message);
      return;
    }
    const updatedLoads = loads.map((load) =>
      load.id === loadId
        ? {
            ...currentLoad,
            driver_id: driverId,
            status: nextLoadStatus,
          }
        : load,
    );
    await supabase
      .from("drivers")
      .update(automaticDriverDispatchState(updatedLoads, driverId))
      .eq("id", driverId);
    if (truckId) await supabase.from("trucks").update({ status: "assigned" }).eq("id", truckId);
    if (trailerId)
      await supabase.from("trailers").update({ status: "assigned" }).eq("id", trailerId);
    await logLoadEvent(loadId, "assigned", "Driver, truck, trailer and dispatch assigned");
    queryClient.invalidateQueries();
    setOpenId(null);
    if (warns.length) toast.warning(`Load assigned with warnings: ${warns.join("; ")}`);
    else toast.success("Load assigned");
  }

  function renderPanel(panel: DispatchPanel) {
    switch (panel) {
      case "tasks":
        return <DispatchTasksPanel />;
      case "alerts":
        return (
          <Panel>
            <PanelHeader title="Look at these first" count={`${risks.length}`} />
            <div className="divide-y divide-line/60">
              {risks.length === 0 && <EmptyRow text="No urgent dispatch alerts." />}
              {risks.slice(0, 8).map((risk) => (
                <div key={risk.key} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${risk.tone === "problem" ? "bg-problem/12 text-problem" : "bg-transit/15 text-transit"}`}
                  >
                    {risk.tag}
                  </span>
                  <span className="text-fg">{risk.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        );
      case "unassigned":
        return (
          <Panel>
            <PanelHeader title="Unassigned loads" count={`${unassigned.length} waiting`} />
            <div className="divide-y divide-line">
              {isLoading && <EmptyRow text="Loading…" />}
              {!isLoading && unassigned.length === 0 && (
                <EmptyRow text="Every load has a driver." />
              )}
              {unassigned.map((load) => (
                <div key={load.id} className="px-4 py-3">
                  <div className="grid grid-cols-[110px_1fr_110px_100px] items-center gap-2">
                    <span className="font-mono text-xs text-fg">{load.load_number}</span>
                    <span className="truncate text-fg">
                      {load.pickup_location ?? "—"} → {load.delivery_location ?? "—"}
                      {load.dispatcher_id && (
                        <span className="ml-2 text-[10px] text-mut">
                          · Dispatch: {dispatcherName(load.dispatcher_id)}
                        </span>
                      )}
                    </span>
                    <StatusPill status={load.status} />
                    {me?.canWrite && (
                      <GhostButton onClick={() => setOpenId(openId === load.id ? null : load.id)}>
                        {openId === load.id ? "Close" : "Assign"}
                      </GhostButton>
                    )}
                  </div>
                  {openId === load.id && (
                    <AssignForm
                      drivers={drivers.filter((driver) => driver.status !== "inactive")}
                      trucks={trucks.filter(
                        (truck) => !busyTruckIds.has(truck.id) && !unusableTrucks.has(truck.id),
                      )}
                      trailers={trailers.filter(
                        (trailer) =>
                          !busyTrailerIds.has(trailer.id) && !unusableTrailers.has(trailer.id),
                      )}
                      dispatchers={profiles.filter((person) => person.is_active)}
                      currentDispatcherId={load.dispatcher_id}
                      scoreOf={scoreFor(load.pickup_location)}
                      defaults={defaultsFor}
                      onSubmit={(driverId, truckId, trailerId, dispatcherId) =>
                        assign(load.id, driverId, truckId, trailerId, dispatcherId)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </Panel>
        );
      case "assigned":
        return (
          <Panel>
            <PanelHeader title="Assigned & rolling" count={`${assigned.length} loads`} />
            <div className="divide-y divide-line">
              {assigned.length === 0 && <EmptyRow text="Nothing rolling right now." />}
              {assigned.map((load) => (
                <div
                  key={load.id}
                  className="grid min-h-11 grid-cols-[110px_1fr_140px_120px_110px_110px] items-center gap-2 px-4 py-1"
                >
                  <span className="font-mono text-xs text-fg">{load.load_number}</span>
                  <span className="truncate text-fg">
                    {load.pickup_location ?? "—"} → {load.delivery_location ?? "—"}
                  </span>
                  <span className="truncate text-mut">
                    {drivers.find((driver) => driver.id === load.driver_id)?.full_name ?? "—"}
                  </span>
                  <span className="truncate text-mut">{dispatcherName(load.dispatcher_id)}</span>
                  <StatusPill status={load.status} />
                  <span className="flex gap-1">
                    {drivers.find((driver) => driver.id === load.driver_id)?.phone && (
                      <a
                        href={`tel:${drivers.find((driver) => driver.id === load.driver_id)?.phone}`}
                        className="rounded-md bg-panel2 px-2 py-1 text-[10px] text-mut ring-1 ring-line hover:text-fg"
                      >
                        Call
                      </a>
                    )}
                    <button
                      onClick={() => copyLoad(load)}
                      className="rounded-md bg-panel2 px-2 py-1 text-[10px] text-mut ring-1 ring-line hover:text-fg"
                    >
                      Copy
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        );
      case "drivers":
        return (
          <DriverLocationsPanel
            title="Dispatch driver board"
            drivers={drivers.filter(
              (driver) => driver.status !== "inactive" || busyDriverIds.has(driver.id),
            )}
            loads={loads}
            canEdit={can("dispatch", "edit") || can("updates", "edit")}
            canEditDispatch={can("dispatch", "edit")}
          />
        );
      case "freeing":
        return (
          <ResourceList
            title="Freeing up soon"
            items={freeingSoon.map(({ l, when }) => ({
              id: l.id,
              main: drivers.find((driver) => driver.id === l.driver_id)?.full_name ?? "—",
              sub: `${l.delivery_location ?? "—"} · ${fmtTime(when)}`,
            }))}
          />
        );
      case "trucks":
        return (
          <ResourceList
            title="Available trucks"
            items={trucks
              .filter((truck) => !busyTruckIds.has(truck.id) && truck.status === "available")
              .map((truck) => ({
                id: truck.id,
                main: `Truck ${truck.truck_number}`,
                sub: truck.make ?? "—",
              }))}
          />
        );
      case "trailers":
        return (
          <ResourceList
            title="Available trailers"
            items={trailers
              .filter(
                (trailer) => !busyTrailerIds.has(trailer.id) && trailer.status === "available",
              )
              .map((trailer) => ({
                id: trailer.id,
                main: `Trailer ${trailer.trailer_number}`,
                sub: trailer.trailer_type ?? "—",
              }))}
          />
        );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block w-64 max-w-full">
          <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
            Show first
          </span>
          <select
            value={firstPanel}
            onChange={(event) => setFirstPanel(event.target.value as DispatchPanel)}
            className="mt-1 h-9 w-full rounded-lg bg-panel px-3 text-sm text-fg ring-1 ring-line focus:ring-accent/40 focus:outline-none"
            aria-label="Choose the first Dispatch Board section"
          >
            {DISPATCH_PANEL_ORDER.map((panel) => (
              <option key={panel} value={panel}>
                {DISPATCH_PANEL_LABELS[panel]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {firstPanel !== "tasks" && (
            <GhostButton onClick={() => setFirstPanel("tasks")}>Reset order</GhostButton>
          )}
          <Link
            to="/gross"
            className="rounded-lg bg-transit/12 px-3 py-2 text-xs font-medium text-transit ring-1 ring-transit/25 hover:bg-transit/20"
          >
            Company profit · CUT gross →
          </Link>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {panelOrder.map((panel) => (
          <section
            key={panel}
            className={`min-w-0 ${panel === firstPanel || panel === "tasks" || panel === "alerts" || panel === "unassigned" || panel === "assigned" ? "xl:col-span-2" : ""}`}
          >
            {renderPanel(panel)}
          </section>
        ))}
      </div>
    </div>
  );
}

function AssignForm({
  drivers,
  trucks,
  trailers,
  dispatchers,
  currentDispatcherId,
  scoreOf,
  defaults,
  onSubmit,
}: {
  drivers: { id: string; full_name: string }[];
  trucks: { id: string; truck_number: string }[];
  trailers: { id: string; trailer_number: string }[];
  dispatchers: Profile[];
  currentDispatcherId: string | null;
  scoreOf: (driverId: string) => DriverScore;
  defaults: (driverId: string) => { truckId: string; trailerId: string };
  onSubmit: (driverId: string, truckId: string, trailerId: string, dispatcherId: string) => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [trailerId, setTrailerId] = useState("");
  const [dispatcherId, setDispatcherId] = useState(currentDispatcherId ?? "");
  const ranked = useMemo(
    () => drivers.map((d) => ({ d, s: scoreOf(d.id) })).sort((a, b) => b.s.score - a.s.score),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers],
  );
  const picked = driverId ? scoreOf(driverId) : null;

  function pickDriver(id: string) {
    setDriverId(id);
    if (!id) return;
    const def = defaults(id);
    if (def.truckId) setTruckId(def.truckId);
    if (def.trailerId) setTrailerId(def.trailerId);
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
      <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-5">
        <SelectInput
          label="Driver (best match first)"
          value={driverId}
          onChange={pickDriver}
          options={[
            { value: "", text: "—" },
            ...ranked.map(({ d, s }, i) => ({
              value: d.id,
              text: `${i === 0 && s.score > 0 ? "★ " : s.warn.length ? "⚠ " : ""}${d.full_name}`,
            })),
          ]}
        />
        <SelectInput
          label="Truck"
          value={truckId}
          onChange={setTruckId}
          options={[
            { value: "", text: "—" },
            ...trucks.map((t) => ({ value: t.id, text: t.truck_number })),
          ]}
        />
        <SelectInput
          label="Trailer"
          value={trailerId}
          onChange={setTrailerId}
          options={[
            { value: "", text: "—" },
            ...trailers.map((t) => ({ value: t.id, text: t.trailer_number })),
          ]}
        />
        <SelectInput
          label="Dispatch staff"
          value={dispatcherId}
          onChange={setDispatcherId}
          options={[
            { value: "", text: "Unassigned" },
            ...dispatchers.map((person) => ({
              value: person.id,
              text: person.full_name ?? person.email ?? "Staff member",
            })),
          ]}
        />
        <PrimaryButton onClick={() => onSubmit(driverId, truckId, trailerId, dispatcherId)}>
          Assign dispatch
        </PrimaryButton>
      </div>
      {picked && (picked.good.length > 0 || picked.warn.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {picked.good.map((g) => (
            <span
              key={g}
              className="rounded bg-delivered/12 px-1.5 py-0.5 text-[10px] text-delivered"
            >
              {g}
            </span>
          ))}
          {picked.warn.map((w) => (
            <span key={w} className="rounded bg-problem/12 px-1.5 py-0.5 text-[10px] text-problem">
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceList({
  title,
  items,
}: {
  title: string;
  items: { id: string; main: string; sub: string }[];
}) {
  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-fg">{title}</span>
        <span className="num font-mono text-[11px] text-mut">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-xs text-mut">None available.</p>}
        {items.map((i) => (
          <div
            key={i.id}
            className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line"
          >
            <span className="truncate text-xs text-fg">{i.main}</span>
            <span className="ml-auto font-mono text-[10px] text-mut">{i.sub}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
