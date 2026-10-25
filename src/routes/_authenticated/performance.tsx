import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAllLoads, useBrokers, useDrivers, useFuel, useMaintenance, useTrucks } from "@/hooks/useTms";
import { useLocalDate, useShifts, useUpdateEvents } from "@/hooks/useShifts";
import { usePlanRows } from "@/components/maintenance-kit";
import { useExpiryItems } from "@/components/expiry-alerts";
import { brokerScorecards, driverScorecards, laneAnalysis, profitByTruck, selectLoads, shiftPerformance, dateOf, type ALoad } from "@/lib/analytics";
import { revenueOf } from "@/lib/billing";
import { buildWeekly, weeklyText } from "@/lib/weekly";
import { lastFullWeek, PRESETS, rangeFor, type Preset } from "@/lib/ranges";
import { money, safetyIssues } from "@/lib/tms";
import { EmptyRow, GhostButton, Panel, PanelHeader } from "@/components/ui-kit";
import { exportCsv, MiniSelect } from "@/components/entity-kit";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance — Vantera TMS" },
      { name: "description", content: "Profit, broker and driver scorecards, lanes, shift performance and the weekly summary." },
    ],
  }),
  component: PerformancePage,
});

type Tab = "profit" | "brokers" | "drivers" | "lanes" | "shifts" | "weekly";
const TABS: { key: Tab; text: string }[] = [
  { key: "profit", text: "Profit" },
  { key: "brokers", text: "Brokers" },
  { key: "drivers", text: "Drivers" },
  { key: "lanes", text: "Lanes" },
  { key: "shifts", text: "Shifts" },
  { key: "weekly", text: "Weekly summary" },
];

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const rpm = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);
const tone = (n: number) => (n < 0 ? "text-problem" : "");

function PerformancePage() {
  const { today, localDate } = useLocalDate();
  const [tab, setTab] = useState<Tab>("profit");
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const range = preset === "custom" && custom.from && custom.to ? custom : rangeFor(preset === "custom" ? "30d" : preset, today);

  return (
    <div className="space-y-4">
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        {TABS.map((t) => (
          <GhostButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.text}</GhostButton>
        ))}
        {tab !== "weekly" && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <MiniSelect value={preset} onChange={(v) => setPreset(v as Preset)} options={PRESETS.map((p) => ({ value: p.value, text: p.text }))} />
            {preset === "custom" && (
              <>
                <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-8 rounded-lg bg-ink px-2 text-xs text-fg ring-1 ring-line" />
                <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-8 rounded-lg bg-ink px-2 text-xs text-fg ring-1 ring-line" />
              </>
            )}
            <span className="font-mono text-[10px] text-mut">{range.from} to {range.to}</span>
          </div>
        )}
      </Panel>
      {tab === "profit" && <Profit from={range.from} to={range.to} />}
      {tab === "brokers" && <Brokers from={range.from} to={range.to} />}
      {tab === "drivers" && <Drivers from={range.from} to={range.to} localDate={localDate} />}
      {tab === "lanes" && <Lanes from={range.from} to={range.to} />}
      {tab === "shifts" && <Shifts from={range.from} to={range.to} localDate={localDate} />}
      {tab === "weekly" && <Weekly today={today} localDate={localDate} />}
    </div>
  );
}

function useBase() {
  const { data: loads = [] } = useAllLoads();
  return loads as unknown as ALoad[];
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
            {head.map((h, i) => <th key={i} className={`px-3 py-2 font-normal ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const Td = ({ children, className = "", first }: { children: React.ReactNode; className?: string; first?: boolean }) => (
  <td className={`px-3 py-2.5 ${first ? "text-left text-fg" : "text-right"} num ${className}`}>{children}</td>
);

/* ---------- profit ---------- */
function Profit({ from, to }: { from: string; to: string }) {
  const loads = useBase();
  const { data: trucks = [] } = useTrucks();
  const { data: fuel = [] } = useFuel();
  const { data: maint = [] } = useMaintenance();
  const { data: brokers = [] } = useBrokers();
  const [show, setShow] = useState<"trucks" | "loads">("trucks");
  const [worstFirst, setWorstFirst] = useState(true);

  const truckRows = useMemo(() => profitByTruck(loads, trucks, fuel, maint, from, to), [loads, trucks, fuel, maint, from, to]);
  const loadRows = useMemo(() => {
    const rows = selectLoads(loads, from, to).map((l) => {
      const revenue = revenueOf(l);
      const pay = Number(l.driver_pay ?? 0);
      const miles = Number(l.miles ?? 0);
      return { l, revenue, pay, margin: revenue - pay, rpm: miles > 0 ? revenue / miles : null, dead: Number(l.deadhead_miles ?? 0), miles };
    });
    return rows.sort((a, b) => (worstFirst ? a.margin - b.margin : b.margin - a.margin));
  }, [loads, from, to, worstFirst]);

  const tot = truckRows.reduce((s, r) => ({ rev: s.rev + r.revenue, profit: s.profit + r.profit }), { rev: 0, profit: 0 });
  return (
    <Panel>
      <PanelHeader title={show === "trucks" ? "Profit by truck" : "Margin by load"} count={show === "trucks" ? `${truckRows.length} trucks · profit ${money(tot.profit)}` : `${loadRows.length} loads`}>
        <GhostButton active={show === "trucks"} onClick={() => setShow("trucks")}>By truck</GhostButton>
        <GhostButton active={show === "loads"} onClick={() => setShow("loads")}>By load</GhostButton>
        {show === "loads" && <GhostButton onClick={() => setWorstFirst((v) => !v)}>{worstFirst ? "Lowest margin first" : "Highest margin first"}</GhostButton>}
        <GhostButton
          onClick={() =>
            show === "trucks"
              ? exportCsv("profit-by-truck.csv", truckRows.map((r) => ({ Truck: r.label, Loads: r.loads, Revenue: r.revenue, DriverPay: r.driverPay, Fuel: r.fuel, Maintenance: r.maintenance, Profit: r.profit, Miles: r.miles, RevenuePerMile: r.rpm?.toFixed(2) ?? "", DeadheadPct: r.deadheadPct?.toFixed(1) ?? "" })))
              : exportCsv("margin-by-load.csv", loadRows.map((r) => ({ Load: r.l.load_number, Date: dateOf(r.l), Revenue: r.revenue, DriverPay: r.pay, Margin: r.margin, Miles: r.miles, Deadhead: r.dead, RevenuePerMile: r.rpm?.toFixed(2) ?? "" })))
          }
        >
          Export CSV
        </GhostButton>
      </PanelHeader>
      {show === "trucks" ? (
        truckRows.length === 0 ? <EmptyRow text="No truck activity in this period." /> : (
          <Table head={["Truck", "Loads", "Revenue", "Driver pay", "Fuel", "Maint.", "Profit", "Miles", "Rev/mile", "Deadhead"]}>
            {truckRows.map((r) => (
              <tr key={r.id} className="border-b border-line/50">
                <Td first>{r.label}</Td><Td>{r.loads}</Td><Td>{money(r.revenue)}</Td><Td>{money(r.driverPay)}</Td><Td>{money(r.fuel)}</Td><Td>{money(r.maintenance)}</Td>
                <Td className={tone(r.profit)}>{money(r.profit)}</Td><Td>{Math.round(r.miles).toLocaleString()}</Td><Td>{rpm(r.rpm)}</Td><Td>{pct(r.deadheadPct)}</Td>
              </tr>
            ))}
          </Table>
        )
      ) : loadRows.length === 0 ? <EmptyRow text="No loads in this period." /> : (
        <Table head={["Load", "Broker", "Date", "Revenue", "Driver pay", "Margin", "Miles", "Rev/mile", "Deadhead mi"]}>
          {loadRows.slice(0, 200).map((r) => (
            <tr key={r.l.id} className="border-b border-line/50">
              <Td first>{r.l.load_number}</Td>
              <Td>{brokers.find((b) => b.id === r.l.broker_id)?.name ?? r.l.customer_name ?? "—"}</Td>
              <Td>{dateOf(r.l)}</Td><Td>{money(r.revenue)}</Td><Td>{money(r.pay)}</Td>
              <Td className={tone(r.margin)}>{money(r.margin)}</Td><Td>{Math.round(r.miles)}</Td><Td>{rpm(r.rpm)}</Td><Td>{Math.round(r.dead)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-mut">
        Profit by truck = revenue − driver pay − fuel − maintenance logged for that truck in the period. Margin by load = revenue − driver pay.
      </p>
    </Panel>
  );
}

/* ---------- brokers ---------- */
function Brokers({ from, to }: { from: string; to: string }) {
  const loads = useBase();
  const { data: brokers = [] } = useBrokers();
  const rows = useMemo(() => brokerScorecards(loads, brokers, from, to), [loads, brokers, from, to]);
  return (
    <Panel>
      <PanelHeader title="Broker scorecard" count={`${rows.length} brokers`}>
        <GhostButton onClick={() => exportCsv("broker-scorecard.csv", rows.map((r) => ({ Broker: r.name, Loads: r.loads, Revenue: r.revenue, RevenuePerMile: r.rpm?.toFixed(2) ?? "", ProblemPct: r.problemPct.toFixed(1), AvgDaysToPay: r.avgDaysToPay?.toFixed(1) ?? "", Unpaid: r.unpaid, Overdue: r.overdue })))}>Export CSV</GhostButton>
      </PanelHeader>
      {rows.length === 0 ? <EmptyRow text="No broker loads in this period." /> : (
        <Table head={["Broker", "Loads", "Revenue", "Rev/mile", "Problem loads", "Avg days to pay", "Unpaid", "Overdue"]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/50">
              <Td first>{r.name}</Td><Td>{r.loads}</Td><Td>{money(r.revenue)}</Td><Td>{rpm(r.rpm)}</Td>
              <Td className={r.problemPct >= 20 ? "text-problem" : ""}>{r.problemLoads} ({pct(r.problemPct)})</Td>
              <Td className={r.avgDaysToPay !== null && r.avgDaysToPay > 45 ? "text-problem" : ""}>{r.avgDaysToPay === null ? "—" : `${r.avgDaysToPay.toFixed(0)} d (${r.paidCount})`}</Td>
              <Td>{money(r.unpaid)}</Td><Td className={r.overdue > 0 ? "text-problem" : ""}>{money(r.overdue)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-mut">Days to pay = payment date − invoice date, for loads marked paid. Unpaid and overdue cover all time, not just this period.</p>
    </Panel>
  );
}

/* ---------- drivers ---------- */
function Drivers({ from, to, localDate }: { from: string; to: string; localDate: (iso: string) => string }) {
  const loads = useBase();
  const { data: drivers = [] } = useDrivers();
  const rows = useMemo(
    () =>
      driverScorecards(loads, drivers, from, to, localDate, (id) => {
        const d = drivers.find((x) => x.id === id);
        return d ? safetyIssues(d) : [];
      }),
    [loads, drivers, from, to, localDate],
  );
  return (
    <Panel>
      <PanelHeader title="Driver scorecard" count={`${rows.length} drivers`}>
        <GhostButton onClick={() => exportCsv("driver-scorecard.csv", rows.map((r) => ({ Driver: r.name, Loads: r.loads, Delivered: r.delivered, Miles: r.miles, Revenue: r.revenue, Margin: r.margin, RevenuePerMile: r.rpm?.toFixed(2) ?? "", OnTimePct: r.onTimePct?.toFixed(1) ?? "", ProblemLoads: r.problemLoads, Documents: r.issues.join("; ") || "OK" })))}>Export CSV</GhostButton>
      </PanelHeader>
      {rows.length === 0 ? <EmptyRow text="No driver activity in this period." /> : (
        <Table head={["Driver", "Loads", "Miles", "Revenue", "Margin", "Rev/mile", "On time", "Problem loads", "Documents"]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/50">
              <Td first>{r.name}</Td><Td>{r.loads}</Td><Td>{Math.round(r.miles).toLocaleString()}</Td><Td>{money(r.revenue)}</Td><Td className={tone(r.margin)}>{money(r.margin)}</Td><Td>{rpm(r.rpm)}</Td>
              <Td className={r.onTimePct !== null && r.onTimePct < 85 ? "text-problem" : ""}>{pct(r.onTimePct)}{r.onTimeMeasured ? ` (${r.onTimeMeasured})` : ""}</Td>
              <Td className={r.problemLoads ? "text-transit" : ""}>{r.problemLoads}</Td>
              <Td className={r.issues.length ? "text-problem" : ""}>{r.issues.length ? r.issues.join(", ") : "OK"}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-mut">On time = delivered on or before the delivery date (by calendar day). Only loads with a recorded delivery time are counted.</p>
    </Panel>
  );
}

/* ---------- lanes ---------- */
function Lanes({ from, to }: { from: string; to: string }) {
  const loads = useBase();
  const rows = useMemo(() => laneAnalysis(loads, from, to), [loads, from, to]);
  return (
    <Panel>
      <PanelHeader title="Lanes (pickup city → delivery city)" count={`${rows.length} lanes`}>
        <GhostButton onClick={() => exportCsv("lanes.csv", rows.map((r) => ({ Lane: r.lane, Loads: r.loads, Revenue: r.revenue, AvgRevenue: r.avgRevenue.toFixed(0), AvgRevenuePerMile: r.avgRpm?.toFixed(2) ?? "", Margin: r.margin, AvgMargin: r.avgMargin.toFixed(0) })))}>Export CSV</GhostButton>
      </PanelHeader>
      {rows.length === 0 ? <EmptyRow text="No lanes in this period." /> : (
        <Table head={["Lane", "Loads", "Revenue", "Avg revenue", "Avg rev/mile", "Margin", "Avg margin"]}>
          {rows.map((r) => (
            <tr key={r.lane} className="border-b border-line/50">
              <Td first>{r.lane}</Td><Td>{r.loads}</Td><Td>{money(r.revenue)}</Td><Td>{money(r.avgRevenue)}</Td><Td>{rpm(r.avgRpm)}</Td>
              <Td className={tone(r.margin)}>{money(r.margin)}</Td><Td className={tone(r.avgMargin)}>{money(r.avgMargin)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

/* ---------- shifts ---------- */
function Shifts({ from, to, localDate }: { from: string; to: string; localDate: (iso: string) => string }) {
  const { data: shifts = [] } = useShifts();
  const { data: events = [], isError } = useUpdateEvents();
  const rows = useMemo(() => shiftPerformance(events, shifts, from, to, localDate), [events, shifts, from, to, localDate]);
  const total = rows.reduce((s, r) => ({ u: s.u + r.updates, o: s.o + r.onTime }), { u: 0, o: 0 });
  return (
    <Panel>
      <PanelHeader title="Update performance by shift" count={total.u ? `${Math.round((total.o / total.u) * 100)}% on time overall` : "no data yet"} />
      {isError && <EmptyRow text="Run the third SQL file (3-performance-features.sql) to start recording this." />}
      {!isError && rows.every((r) => r.updates === 0) ? (
        <EmptyRow text="No timed updates yet. Updates made on the Update Board from now on are recorded with the shift and whether they were on time." />
      ) : (
        <Table head={["Shift", "Updates", "On time", "Late", "% on time", "Avg minutes late"]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/50">
              <Td first>{r.name}</Td><Td>{r.updates}</Td><Td>{r.onTime}</Td><Td className={r.late ? "text-transit" : ""}>{r.late}</Td>
              <Td className={r.pctOnTime !== null && r.pctOnTime < 80 ? "text-problem" : ""}>{pct(r.pctOnTime)}</Td>
              <Td>{r.avgLateMin === null ? "—" : Math.round(r.avgLateMin)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-mut">
        An update counts as on time if it was made no more than 15 minutes after its "next update due" time. The shift is the one scheduled when the update was saved.
      </p>
    </Panel>
  );
}

/* ---------- weekly summary ---------- */
function Weekly({ today, localDate }: { today: string; localDate: (iso: string) => string }) {
  const loads = useBase();
  const { data: brokers = [] } = useBrokers();
  const { data: trucks = [] } = useTrucks();
  const { data: fuel = [] } = useFuel();
  const { data: maint = [] } = useMaintenance();
  const { data: events = [] } = useUpdateEvents();
  const { data: shifts = [] } = useShifts();
  const plans = usePlanRows();
  const expiries = useExpiryItems();
  const [which, setWhich] = useState<"last" | "week">("last");
  const range = which === "last" ? lastFullWeek(today) : rangeFor("7d", today);

  const text = useMemo(() => {
    const s = buildWeekly({
      loads, brokers, trucks, fuel, maint, events, shifts,
      expiryDays: expiries.map((e) => e.days),
      serviceOverdue: plans.filter((p) => p.status.state === "overdue").length,
      from: range.from, to: range.to, localDate,
    });
    return { s, text: weeklyText(s) };
  }, [loads, brokers, trucks, fuel, maint, events, shifts, expiries, plans, range.from, range.to, localDate]);

  const s = text.s;
  const cards: [string, string][] = [
    ["Delivered loads", String(s.deliveredLoads)],
    ["Revenue", money(s.revenue)],
    ["Profit", money(s.profit)],
    ["Revenue / mile", rpm(s.rpm)],
    ["On-time deliveries", pct(s.onTimePct)],
    ["Updates on time", pct(s.updatesOnTimePct)],
  ];
  return (
    <Panel className="space-y-4 p-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <MiniSelect value={which} onChange={(v) => setWhich(v as "last" | "week")} options={[{ value: "last", text: "Last full week (Mon–Sun)" }, { value: "week", text: "Last 7 days" }]} />
        <GhostButton onClick={() => navigator.clipboard.writeText(text.text).then(() => toast.success("Summary copied"))}>Copy text</GhostButton>
        <GhostButton onClick={() => window.print()}>Print</GhostButton>
        <span className="ml-auto font-mono text-[10px] text-mut">{range.from} to {range.to}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-panel2 p-3 ring-1 ring-line">
            <div className="font-mono text-[10px] tracking-[0.12em] text-mut uppercase">{k}</div>
            <div className="num mt-1 font-display text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <pre className="whitespace-pre-wrap rounded-lg bg-ink p-3 text-xs text-fg ring-1 ring-line">{text.text}</pre>
      <p className="no-print text-[11px] text-mut">This same summary can be sent to Telegram or email every Monday. See Settings → Alerts.</p>
    </Panel>
  );
}

