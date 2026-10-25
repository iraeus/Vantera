import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useBrokers,
  useDrivers,
  useFuel,
  useLoads,
  useMaintenance,
  useTrucks,
  type Load,
} from "@/hooks/useTms";
import { usePermissions } from "@/hooks/usePermissions";
import { label, loadRevenue, money } from "@/lib/tms";
import { EmptyRow, GhostButton, Panel, PanelHeader } from "@/components/ui-kit";
import { MiniSelect, exportCsv } from "@/components/entity-kit";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Vantera TMS" },
      {
        name: "description",
        content: "Revenue, profit and performance reports by broker, driver and truck.",
      },
      { property: "og:title", content: "Reports — Vantera TMS" },
      {
        property: "og:description",
        content: "Revenue, profit and performance reports by broker, driver and truck.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

type Grp = {
  key: string;
  loads: number;
  delivered: number;
  revenue: number;
  driverPay: number;
  miles: number;
};
const EXCLUDE = ["cancelled", "rejected", "tonu"];

function group(loads: Load[], keyOf: (l: Load) => string): Grp[] {
  const m = new Map<string, Grp>();
  for (const l of loads) {
    const k = keyOf(l);
    const g = m.get(k) ?? { key: k, loads: 0, delivered: 0, revenue: 0, driverPay: 0, miles: 0 };
    g.loads++;
    if (["delivered", "pod_received", "billing", "paid"].includes(l.status)) g.delivered++;
    g.revenue += loadRevenue(l);
    g.driverPay += Number(l.driver_pay ?? 0);
    g.miles += Number(l.miles ?? 0);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

function ReportsPage() {
  const { data: loads = [], isLoading } = useLoads();
  const { data: brokers = [] } = useBrokers();
  const { data: drivers = [] } = useDrivers();
  const { data: trucks = [] } = useTrucks();
  const { data: fuel = [] } = useFuel();
  const { data: maint = [] } = useMaintenance();
  const { can } = usePermissions();
  const canExport = can("reports", "export");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"broker" | "driver" | "truck" | "status">("broker");

  const inRange = (d?: string | null) => !!d && d >= from && d <= to;
  const dateOf = (l: Load) => l.pickup_date ?? l.created_at.slice(0, 10);

  const filtered = useMemo(
    () =>
      loads.filter(
        (l) => inRange(dateOf(l)) && (status ? l.status === status : !EXCLUDE.includes(l.status)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loads, from, to, status],
  );

  const fuelCost = fuel.filter((f) => inRange(f.fuel_date)).reduce((s, f) => s + Number(f.cost), 0);
  const maintCost = maint
    .filter((m) => inRange(m.service_date))
    .reduce((s, m) => s + Number(m.cost), 0);
  const revenue = filtered.reduce((s, l) => s + loadRevenue(l), 0);
  const driverPay = filtered.reduce((s, l) => s + Number(l.driver_pay ?? 0), 0);
  const miles = filtered.reduce((s, l) => s + Number(l.miles ?? 0), 0);
  const expenses = driverPay + fuelCost + maintCost;

  const rows = useMemo(() => {
    const name = {
      broker: (l: Load) =>
        brokers.find((b) => b.id === l.broker_id)?.name ?? l.customer_name ?? "No broker",
      driver: (l: Load) => drivers.find((d) => d.id === l.driver_id)?.full_name ?? "Unassigned",
      truck: (l: Load) => trucks.find((t) => t.id === l.truck_id)?.truck_number ?? "Unassigned",
      status: (l: Load) => label(l.status),
    }[view];
    return group(filtered, name);
  }, [filtered, view, brokers, drivers, trucks]);

  const kpis = [
    ["Loads", String(filtered.length)],
    ["Revenue", money(revenue)],
    ["Driver pay", money(driverPay)],
    ["Fuel", money(fuelCost)],
    ["Maintenance", money(maintCost)],
    ["Profit", money(revenue - expenses)],
    ["Miles", miles.toLocaleString()],
    ["Avg RPM", miles ? `$${(revenue / miles).toFixed(2)}` : "—"],
  ];

  const dateInput =
    "h-8 rounded-lg bg-ink px-2 text-xs text-fg ring-1 ring-line focus:outline-none";

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Reports">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={dateInput}
            aria-label="From"
          />
          <span className="text-mut">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={dateInput}
            aria-label="To"
          />
          <MiniSelect
            value={status}
            onChange={setStatus}
            options={[
              { value: "", text: "All (excl. cancelled)" },
              ...[...new Set(loads.map((l) => l.status))].map((s) => ({
                value: s,
                text: label(s),
              })),
            ]}
          />
          {canExport && (
            <GhostButton
              onClick={() =>
                exportCsv(
                  `loads_${from}_${to}.csv`,
                  filtered.map((l) => ({
                    Load: l.load_number,
                    Date: dateOf(l),
                    Status: label(l.status),
                    Broker:
                      brokers.find((b) => b.id === l.broker_id)?.name ?? l.customer_name ?? "",
                    Driver: drivers.find((d) => d.id === l.driver_id)?.full_name ?? "",
                    Truck: trucks.find((t) => t.id === l.truck_id)?.truck_number ?? "",
                    Pickup: l.pickup_location,
                    Delivery: l.delivery_location,
                    Miles: l.miles,
                    Revenue: loadRevenue(l),
                    "Driver pay": l.driver_pay,
                  })),
                )
              }
            >
              Export loads
            </GhostButton>
          )}
        </PanelHeader>
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4 xl:grid-cols-8">
          {kpis.map(([k, v]) => (
            <div key={k} className="bg-panel p-4">
              <div className="font-mono text-[10px] tracking-[0.12em] text-mut uppercase">{k}</div>
              <div className="num mt-1 font-display text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Breakdown" count={`${rows.length} rows`}>
          {(["broker", "driver", "truck", "status"] as const).map((v) => (
            <GhostButton key={v} active={view === v} onClick={() => setView(v)}>
              By {v}
            </GhostButton>
          ))}
          {canExport && (
            <GhostButton
              onClick={() =>
                exportCsv(
                  `report_by_${view}.csv`,
                  rows.map((r) => ({
                    [label(view)]: r.key,
                    Loads: r.loads,
                    Delivered: r.delivered,
                    Revenue: r.revenue.toFixed(2),
                    "Driver pay": r.driverPay.toFixed(2),
                    Miles: r.miles,
                    RPM: r.miles ? (r.revenue / r.miles).toFixed(2) : "",
                  })),
                )
              }
            >
              Export CSV
            </GhostButton>
          )}
        </PanelHeader>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
              {[
                label(view),
                "Loads",
                "Delivered",
                "Revenue",
                "Driver pay",
                "Margin",
                "Miles",
                "RPM",
              ].map((h) => (
                <th key={h} className="px-4 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="num border-b border-line/50">
                <td className="px-4 py-2.5">{r.key}</td>
                <td className="px-4 py-2.5">{r.loads}</td>
                <td className="px-4 py-2.5">{r.delivered}</td>
                <td className="px-4 py-2.5">{money(r.revenue)}</td>
                <td className="px-4 py-2.5">{money(r.driverPay)}</td>
                <td className="px-4 py-2.5">{money(r.revenue - r.driverPay)}</td>
                <td className="px-4 py-2.5">{r.miles.toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  {r.miles ? `$${(r.revenue / r.miles).toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <EmptyRow text="Loading…" />}
        {!isLoading && rows.length === 0 && <EmptyRow text="No loads in this date range." />}
      </Panel>
    </div>
  );
}
