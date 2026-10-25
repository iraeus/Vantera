import { createFileRoute, Link } from "@tanstack/react-router";
import { StatusPill } from "@/components/StatusPill";
import { useDrivers, useLoads, useTrailers, useTrucks } from "@/hooks/useTms";
import { OperationsInsights } from "@/components/OperationsInsights";
import { ACTIVE_STATUSES, TRANSIT_STATUSES, loadRevenue, money } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Operations dashboard · Vantera TMS" },
      { name: "description", content: "Live load, fleet and revenue overview for dispatch." },
      { property: "og:title", content: "Operations dashboard · Vantera TMS" },
      {
        property: "og:description",
        content: "Live load, fleet and revenue overview for dispatch.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: loads = [], isLoading } = useLoads();
  const { data: trucks = [] } = useTrucks();
  const { data: drivers = [] } = useDrivers();
  const { data: trailers = [] } = useTrailers();

  const active = loads.filter((l) => ACTIVE_STATUSES.includes(l.status));
  const inTransit = loads.filter((l) => TRANSIT_STATUSES.includes(l.status));
  const today = new Date().toISOString().slice(0, 10);
  const deliveredToday = loads.filter(
    (l) => l.status === "delivered" && (l.delivery_date ?? "").slice(0, 10) === today,
  );
  const revenue = loads
    .filter((l) => !["cancelled", "rejected", "tonu"].includes(l.status))
    .reduce((sum, l) => sum + loadRevenue(l), 0);
  const driverPay = loads.reduce((sum, l) => sum + Number(l.driver_pay ?? 0), 0);
  const companyCut = loads.reduce((sum, l) => sum + Number(l.cut ?? 0), 0);

  const trucksAvailable = trucks.filter((t) => t.status === "available").length;
  const trucksInShop = trucks.filter((t) => t.status === "in_shop").length;
  const driversAvailable = drivers.filter((d) => d.status === "available").length;
  const trailersAvailable = trailers.filter((t) => t.status === "available").length;

  // loads created per weekday, last 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return {
      key,
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      count: loads.filter((l) => (l.created_at ?? "").slice(0, 10) === key).length,
    };
  });
  const maxCount = Math.max(1, ...days.map((d) => d.count));

  const alerts = buildAlerts(loads, trucks, drivers);

  return (
    <>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="Active loads"
          value={String(active.length)}
          sub={`${loads.length} total`}
          dot="accent"
        />
        <Kpi
          title="In transit"
          value={String(inTransit.length)}
          sub={`${loads.filter((l) => l.status === "dispatched").length} dispatched`}
          dot="transit"
        />
        <Kpi
          title="Delivered today"
          value={String(deliveredToday.length)}
          sub={`${loads.filter((l) => l.status === "delivered").length} all time`}
          dot="delivered"
        />
        <Kpi
          title="Fleet available"
          value={`${trucksAvailable} / ${trucks.length}`}
          sub={`${trucksInShop} in shop · ${trailersAvailable} trailers`}
          dot="mut"
        />
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi title="Revenue" value={money(revenue)} sub="all booked loads" dot="accent" />
        <Kpi title="Driver pay" value={money(driverPay)} sub="committed" dot="mut" />
        <Kpi
          title="Company CUT"
          value={money(companyCut)}
          sub="company profit on loads"
          dot="delivered"
        />
        <Kpi
          title="Drivers available"
          value={`${driversAvailable} / ${drivers.length}`}
          sub={`${drivers.filter((d) => d.status === "on_load").length} on load`}
          dot="transit"
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-panel p-4 ring-1 ring-line lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-fg">Loads created · last 7 days</span>
            <span className="font-mono text-[11px] text-mut">{loads.length} total</span>
          </div>
          <div className="flex h-28 items-end gap-1.5">
            {days.map((d) => (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t bg-accent/70"
                  style={{ height: `${Math.max(4, (d.count / maxCount) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="num mt-2 flex justify-between font-mono text-[10px] text-mut">
            {days.map((d) => (
              <span key={d.key}>{d.label}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-xl bg-panel p-4 ring-1 ring-line">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-fg">Alert feed</span>
            <span className="rounded bg-problem/15 px-1.5 py-0.5 font-mono text-[10px] text-problem">
              {alerts.length}
            </span>
          </div>
          <div className="flex-1 space-y-2.5 text-xs">
            {alerts.length === 0 && <p className="text-mut">No open alerts.</p>}
            {alerts.slice(0, 6).map((a, i) => (
              <div
                key={i}
                className={`rounded-lg px-2.5 py-2 ring-1 ring-line ${a.severe ? "pulse-alert" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${a.severe ? "bg-problem" : "bg-transit"}`}
                  />
                  <span className="font-medium text-fg">{a.title}</span>
                </div>
                <div className="mt-1 pl-3.5 font-mono text-[10px] text-mut">{a.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col rounded-xl bg-panel ring-1 ring-line">
        <div className="flex h-12 items-center gap-3 border-b border-line px-4">
          <span className="font-display text-sm font-semibold tracking-tight">
            Today&apos;s operations
          </span>
          <span className="num font-mono text-[11px] text-mut">{active.length} active</span>
          <Link to="/loads" className="ml-auto font-mono text-[11px] text-accent">
            Open load board
          </Link>
        </div>
        <div className="divide-y divide-line">
          {isLoading && <div className="px-4 py-6 text-xs text-mut">Loading…</div>}
          {!isLoading && active.length === 0 && (
            <div className="px-4 py-6 text-xs text-mut">
              No active loads yet. Create one from the load board.
            </div>
          )}
          {active.length > 0 && (
            <div className="grid h-8 grid-cols-[70px_140px_110px_1fr_110px_90px] items-center gap-2 px-4 font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
              <span>Unit</span>
              <span>Driver</span>
              <span>Load</span>
              <span>Route</span>
              <span>Location</span>
              <span>Status</span>
            </div>
          )}
          {active.slice(0, 8).map((l) => {
            const drv = drivers.find((d) => d.id === l.driver_id);
            const trk = trucks.find((t) => t.id === l.truck_id);
            return (
              <div
                key={l.id}
                className="grid h-11 grid-cols-[70px_140px_110px_1fr_110px_90px] items-center gap-2 px-4"
              >
                <span className="font-mono text-xs text-fg">
                  {trk?.truck_number ?? drv?.unit_number ?? "—"}
                </span>
                <span className="truncate text-fg">{drv?.full_name ?? "Unassigned"}</span>
                <span className="font-mono text-xs text-fg">{l.load_number}</span>
                <span className="truncate text-fg">
                  {l.pickup_location ?? "—"} → {l.delivery_location ?? "—"}
                </span>
                <span className="num truncate font-mono text-xs text-mut">
                  {l.current_location ?? "no update"}
                </span>
                <StatusPill status={l.status} />
              </div>
            );
          })}
        </div>
      </section>
      <OperationsInsights loads={loads} drivers={drivers} trucks={trucks} trailers={trailers} />
    </>
  );
}

function Kpi({
  title,
  value,
  sub,
  dot,
}: {
  title: string;
  value: string;
  sub: string;
  dot: "accent" | "transit" | "delivered" | "mut";
}) {
  const dotClass = {
    accent: "bg-accent",
    transit: "bg-transit",
    delivered: "bg-delivered",
    mut: "bg-mut",
  }[dot];
  return (
    <div className="rounded-xl bg-panel p-4 ring-1 ring-line">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.12em] text-mut uppercase">{title}</span>
        <span className={`size-2 rounded-full ${dotClass}`} />
      </div>
      <div className="num mt-2 font-display text-3xl leading-none font-semibold tracking-tight">
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-mut">{sub}</div>
    </div>
  );
}

function buildAlerts(
  loads: {
    load_number: string;
    status: string;
    is_problem: boolean;
    driver_id: string | null;
    problem_note: string | null;
  }[],
  trucks: {
    truck_number: string;
    status: string;
    insurance_expiration: string | null;
    registration_expiration: string | null;
  }[],
  drivers: {
    full_name: string;
    cdl_expiration: string | null;
    medical_card_expiration: string | null;
  }[],
) {
  const alerts: { title: string; detail: string; severe: boolean }[] = [];
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);

  loads
    .filter((l) => l.is_problem)
    .forEach((l) =>
      alerts.push({
        title: `${l.load_number} flagged as a problem`,
        detail: l.problem_note ?? "Needs dispatcher attention",
        severe: true,
      }),
    );
  loads
    .filter((l) => !l.driver_id && ["new", "available", "booked"].includes(l.status))
    .forEach((l) =>
      alerts.push({
        title: `${l.load_number} is unassigned`,
        detail: "No driver yet",
        severe: false,
      }),
    );
  trucks
    .filter((t) => t.status === "in_shop")
    .forEach((t) =>
      alerts.push({
        title: `Truck ${t.truck_number} in shop`,
        detail: "Out of service",
        severe: false,
      }),
    );
  trucks.forEach((t) => {
    if (t.insurance_expiration && new Date(t.insurance_expiration) < soon)
      alerts.push({
        title: `Truck ${t.truck_number} insurance expiring`,
        detail: t.insurance_expiration,
        severe: true,
      });
    if (t.registration_expiration && new Date(t.registration_expiration) < soon)
      alerts.push({
        title: `Truck ${t.truck_number} registration expiring`,
        detail: t.registration_expiration,
        severe: false,
      });
  });
  drivers.forEach((d) => {
    if (d.cdl_expiration && new Date(d.cdl_expiration) < soon)
      alerts.push({ title: `${d.full_name} CDL expiring`, detail: d.cdl_expiration, severe: true });
    if (d.medical_card_expiration && new Date(d.medical_card_expiration) < soon)
      alerts.push({
        title: `${d.full_name} medical card expiring`,
        detail: d.medical_card_expiration,
        severe: false,
      });
  });
  return alerts;
}
