import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  EmptyRow,
  GhostButton,
  Panel,
  PanelHeader,
  PrimaryButton,
  SelectInput,
} from "@/components/ui-kit";
import { useAllLoads, useDrivers, useProfiles } from "@/hooks/useTms";
import { useUserPreference } from "@/hooks/useUserPreference";
import { label, money } from "@/lib/tms";
import type { Load } from "@/hooks/useTms";

export const Route = createFileRoute("/_authenticated/gross")({
  head: () => ({
    meta: [
      { title: "Gross board · Vantera TMS" },
      {
        name: "description",
        content: "Driver gross and company CUT by Amazon Relay week or a selected date range.",
      },
    ],
  }),
  component: GrossBoard,
});

type Period = "day" | "week" | "month" | "year";
type View = "people" | "company";

function localKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

function grossDate(load: Load) {
  const value =
    load.delivered_at ??
    load.delivery_departed_at ??
    load.delivery_date ??
    load.pickup_departed_at ??
    load.pickup_date ??
    load.created_at;
  const date = value.length === 10 ? dateFromKey(value) : new Date(value);
  return localKey(date);
}

function tonuDate(load: Load) {
  const date = new Date(load.updated_at);
  return Number.isNaN(date.getTime()) ? grossDate(load) : localKey(date);
}

function periodRange(period: Period, anchor: string) {
  const date = dateFromKey(anchor);
  const start = new Date(date);
  const end = new Date(date);
  if (period === "week") {
    start.setDate(start.getDate() - start.getDay());
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (period === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (period === "year") {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  }
  return { start: localKey(start), end: localKey(end), startDate: start, endDate: end };
}

function shiftAnchor(anchor: string, period: Period, amount: number) {
  const date = dateFromKey(anchor);
  if (period === "day") date.setDate(date.getDate() + amount);
  else if (period === "week") date.setDate(date.getDate() + 7 * amount);
  else if (period === "month") date.setMonth(date.getMonth() + amount);
  else date.setFullYear(date.getFullYear() + amount);
  return localKey(date);
}

function displayDate(key: string, year = true) {
  return dateFromKey(key).toLocaleDateString(
    undefined,
    year ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" },
  );
}

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = value.length === 10 ? dateFromKey(value) : new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: value.length === 10 ? undefined : "numeric",
    minute: value.length === 10 ? undefined : "2-digit",
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function GrossBoard() {
  const { data: allLoads = [], isLoading } = useAllLoads();
  const { data: drivers = [] } = useDrivers();
  const { data: profiles = [] } = useProfiles();
  const dispatchStaff = useMemo(() => profiles.filter((profile) => profile.is_active), [profiles]);
  const [prefs, setPrefs] = useUserPreference("gross-board", {
    view: "people" as View,
    period: "week" as Period,
    anchor: localKey(new Date()),
    personId: "all",
    sort: "high" as "high" | "low",
  });
  const { view, period, anchor, personId, sort } = prefs;
  const setView = (value: View) => setPrefs((current) => ({ ...current, view: value }));
  const setPeriod = (value: Period) => setPrefs((current) => ({ ...current, period: value }));
  const setAnchor = (value: string) => setPrefs((current) => ({ ...current, anchor: value }));
  const setPersonId = (value: string) => setPrefs((current) => ({ ...current, personId: value }));
  const setSort = (value: "high" | "low") => setPrefs((current) => ({ ...current, sort: value }));
  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const liveLoads = allLoads.filter(
    (load) => !load.deleted_at && !["cancelled", "rejected", "tonu"].includes(load.status),
  );
  const periodLoads = useMemo(
    () =>
      liveLoads.filter((load) => {
        const day = grossDate(load);
        return day >= range.start && day <= range.end;
      }),
    [liveLoads, range.start, range.end],
  );
  const filteredPeriodLoads = periodLoads.filter(
    (load) => personId === "all" || load.dispatcher_id === personId,
  );
  const driverName = (id: string | null) =>
    drivers.find((driver) => driver.id === id)?.full_name ?? "Unassigned driver";
  const dispatcherName = (id: string | null) => {
    const person = profiles.find((profile) => profile.id === id);
    return person?.full_name ?? person?.email ?? "—";
  };
  const companyProfit = filteredPeriodLoads.reduce((sum, load) => sum + Number(load.cut ?? 0), 0);
  const tonuLoads = allLoads.filter((load) => {
    if (load.deleted_at || Number(load.tonu_amount ?? 0) <= 0 || load.status !== "cancelled")
      return false;
    const day = tonuDate(load);
    return (
      day >= range.start &&
      day <= range.end &&
      (personId === "all" || load.dispatcher_id === personId)
    );
  });
  const tonuTotal = tonuLoads.reduce((sum, load) => sum + Number(load.tonu_amount ?? 0), 0);
  const unpaidLoads = filteredPeriodLoads.filter((load) => load.status === "billing");
  const unpaidAmount = unpaidLoads.reduce(
    (sum, load) =>
      sum +
      Number(load.rate ?? 0) +
      Number(load.fuel_surcharge ?? 0) +
      Number(load.detention ?? 0) +
      Number(load.layover ?? 0) +
      Number(load.other_charges ?? 0),
    0,
  );
  const driverPayTotal = filteredPeriodLoads.reduce(
    (sum, load) => sum + Number(load.driver_pay ?? 0),
    0,
  );

  const people = useMemo(() => {
    const byDispatcher = new Map<
      string,
      { id: string; name: string; gross: number; loads: Load[] }
    >(
      dispatchStaff.map((profile) => [
        profile.id,
        {
          id: profile.id,
          name: profile.full_name ?? profile.email ?? "Staff member",
          gross: 0,
          loads: [],
        },
      ]),
    );
    for (const load of periodLoads) {
      if (!load.dispatcher_id) continue;
      const current = byDispatcher.get(load.dispatcher_id) ?? {
        id: load.dispatcher_id,
        name: dispatcherName(load.dispatcher_id),
        gross: 0,
        loads: [],
      };
      current.gross += Number(load.driver_pay ?? 0);
      current.loads.push(load);
      byDispatcher.set(load.dispatcher_id, current);
    }
    return [...byDispatcher.values()].sort((a, b) =>
      sort === "high" ? b.gross - a.gross : a.gross - b.gross,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodLoads, sort, dispatchStaff]);

  const companyRows = periodLoads
    .filter((load) => Number(load.cut ?? 0) > 0)
    .filter((load) => personId === "all" || load.dispatcher_id === personId)
    .sort((a, b) => Number(b.cut) - Number(a.cut));
  const selectedPerson =
    personId === "all" ? null : (people.find((person) => person.id === personId) ?? null);
  const details =
    personId === "all"
      ? periodLoads.filter((load) => load.dispatcher_id)
      : (selectedPerson?.loads ?? []);
  const rangeText =
    period === "week"
      ? `${displayDate(range.start, false)} – ${displayDate(range.end)} · Amazon Relay week`
      : period === "day"
        ? displayDate(range.start)
        : `${displayDate(range.start, false)} – ${displayDate(range.end)}`;

  function exportPdf() {
    const grossRows = (view === "company" ? companyRows : details).map((load) => ({
      load: load.load_number,
      driver: driverName(load.driver_id),
      dispatcher: dispatcherName(load.dispatcher_id),
      pay: money(load.driver_pay),
      cut: money(load.cut),
      state: label(load.status),
    }));
    const tonuRows = tonuLoads.map((load) => ({
      load: load.load_number,
      driver: driverName(load.driver_id),
      dispatcher: dispatcherName(load.dispatcher_id),
      pay: money(load.tonu_amount),
      cut: "—",
      state: "TONU · cancelled",
    }));
    const rowsHtml = [...grossRows, ...tonuRows]
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.load)}</td><td>${escapeHtml(row.driver)}</td><td>${escapeHtml(row.dispatcher)}</td><td>${escapeHtml(row.state)}</td><td>${escapeHtml(row.pay)}</td><td>${escapeHtml(row.cut)}</td></tr>`,
      )
      .join("");
    const popup = window.open("", "_blank", "width=1000,height=750");
    if (!popup) {
      toast.error("Allow pop-ups to export the PDF report.");
      return;
    }
    popup.document.write(
      `<!doctype html><html><head><title>Gross report</title><style>body{font:12px Arial,sans-serif;color:#17212c;padding:28px}h1{margin:0 0 8px}p{color:#516174}.totals{display:flex;gap:24px;margin:20px 0;padding:14px;background:#f1f5f9}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #d8e0e8}th{font-size:10px;text-transform:uppercase;color:#536477}@media print{body{padding:0}}</style></head><body><h1>Vantera · Gross & TONU</h1><p>${escapeHtml(rangeText)} · ${escapeHtml(view === "company" ? "Company profit view" : "Dispatcher gross view")} · ${escapeHtml(personId === "all" ? "All dispatchers" : dispatcherName(personId))}</p><div class="totals"><span>Driver pay: <b>${escapeHtml(money(driverPayTotal))}</b></span><span>Company CUT: <b>${escapeHtml(money(companyProfit))}</b></span><span>TONU: <b>${escapeHtml(money(tonuTotal))}</b></span><span>Unpaid loads: <b>${escapeHtml(money(unpaidAmount))} · ${unpaidLoads.length} loads</b></span></div><table><thead><tr><th>Load</th><th>Driver</th><th>Dispatcher</th><th>Status</th><th>Pay / TONU</th><th>CUT</th></tr></thead><tbody>${rowsHtml || "<tr><td colspan='6'>No filtered records in this period.</td></tr>"}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`,
    );
    popup.document.close();
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Gross board" count={rangeText}>
          <PrimaryButton onClick={exportPdf}>Export PDF</PrimaryButton>
          <GhostButton onClick={() => setAnchor(shiftAnchor(anchor, period, -1))}>←</GhostButton>
          <GhostButton onClick={() => setAnchor(localKey(new Date()))}>Today</GhostButton>
          <GhostButton onClick={() => setAnchor(shiftAnchor(anchor, period, 1))}>→</GhostButton>
        </PanelHeader>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex gap-1">
            {(["day", "week", "month", "year"] as Period[]).map((item) => (
              <GhostButton key={item} active={period === item} onClick={() => setPeriod(item)}>
                {label(item)}
              </GhostButton>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-mut">
            Anchor date
            <input
              type="date"
              value={anchor}
              onChange={(event) => setAnchor(event.target.value)}
              className="h-8 rounded-lg bg-ink px-2 text-fg ring-1 ring-line"
            />
          </label>
          <div className="ml-auto flex gap-1">
            <GhostButton active={view === "people"} onClick={() => setView("people")}>
              People gross
            </GhostButton>
            <GhostButton active={view === "company"} onClick={() => setView("company")}>
              Company profit
            </GhostButton>
          </div>
        </div>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 xl:grid-cols-5">
          <Summary
            label="Driver pay"
            value={money(driverPayTotal)}
            detail="Driver pay on all non-cancelled loads in the period"
          />
          <Summary
            label="Company profit · CUT"
            value={money(companyProfit)}
            detail={`${companyRows.length} loads with a CUT`}
          />
          <Summary
            label="TONU"
            value={money(tonuTotal)}
            detail={`${tonuLoads.length} cancelled loads with TONU`}
          />
          <Summary
            label="Unpaid loads"
            value={money(unpaidAmount)}
            detail={`${unpaidLoads.length} loads awaiting payment`}
          />
          <Summary
            label="Loads in range"
            value={String(filteredPeriodLoads.length)}
            detail="Using delivery date, then pickup date"
          />
        </div>

        {view === "people" ? (
          <>
            <PanelHeader title="Gross by dispatcher" count={`${people.length} dispatchers`}>
              <SelectInput
                label="Dispatcher"
                value={personId}
                onChange={setPersonId}
                options={[
                  { value: "all", text: "All dispatchers" },
                  ...dispatchStaff.map((profile) => ({
                    value: profile.id,
                    text: profile.full_name ?? profile.email ?? "Staff member",
                  })),
                ]}
              />
              <SelectInput
                label="Sort gross"
                value={sort}
                onChange={(value) => setSort(value as "high" | "low")}
                options={[
                  { value: "high", text: "High to low" },
                  { value: "low", text: "Low to high" },
                ]}
              />
            </PanelHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] uppercase text-mut">
                    <th className="px-4 py-2">Dispatcher</th>
                    <th className="px-4 py-2">Loads</th>
                    <th className="px-4 py-2">Gross · assigned loads</th>
                    <th className="px-4 py-2">Company CUT</th>
                  </tr>
                </thead>
                <tbody>
                  {people
                    .filter((person) => personId === "all" || person.id === personId)
                    .map((person) => (
                      <tr key={person.id} className="border-b border-line/60 hover:bg-panel2">
                        <td className="px-4 py-3 font-medium text-fg">{person.name}</td>
                        <td className="px-4 py-3">{person.loads.length}</td>
                        <td className="num px-4 py-3 font-mono text-delivered">
                          {money(person.gross)}
                        </td>
                        <td className="num px-4 py-3 font-mono text-transit">
                          {money(
                            person.loads.reduce((sum, load) => sum + Number(load.cut ?? 0), 0),
                          )}
                        </td>
                      </tr>
                    ))}
                  {!isLoading &&
                    people.filter((person) => personId === "all" || person.id === personId)
                      .length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          <EmptyRow text="No dispatcher gross in this date range." />
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
            <PanelHeader
              title={
                selectedPerson
                  ? `${selectedPerson.name} · load detail`
                  : "Dispatcher loads included"
              }
              count={`${details.length} loads`}
            />
            <GrossLoadRows
              loads={details}
              driverName={driverName}
              dispatcherName={dispatcherName}
              showCut={false}
            />
          </>
        ) : (
          <>
            <PanelHeader title="Company profit · CUT loads" count={`${companyRows.length} loads`} />
            <p className="px-4 py-2 text-xs text-mut">
              Every load with a CUT entered is included. Start and end use recorded pickup and
              delivery times when available.
            </p>
            <GrossLoadRows
              loads={companyRows}
              driverName={driverName}
              dispatcherName={dispatcherName}
              showCut
            />
          </>
        )}
      </Panel>
    </div>
  );
}

function Summary({
  label: title,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
      <div className="font-mono text-[10px] tracking-[0.12em] text-mut uppercase">{title}</div>
      <div className="num mt-1 text-xl font-semibold text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-mut">{detail}</div>
    </div>
  );
}

function GrossLoadRows({
  loads,
  driverName,
  dispatcherName,
  showCut,
}: {
  loads: Load[];
  driverName: (id: string | null) => string;
  dispatcherName: (id: string | null) => string;
  showCut: boolean;
}) {
  if (!loads.length)
    return (
      <EmptyRow
        text={
          showCut
            ? "No loads have CUT recorded in this date range."
            : "No assigned loads in this date range."
        }
      />
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-left text-xs">
        <thead>
          <tr className="border-b border-line font-mono text-[10px] uppercase text-mut">
            <th className="px-4 py-2">Load ID</th>
            <th className="px-4 py-2">Driver</th>
            <th className="px-4 py-2">Dispatch</th>
            <th className="px-4 py-2">Started</th>
            <th className="px-4 py-2">Ended</th>
            {showCut && <th className="px-4 py-2">CUT · profit</th>}
            <th className="px-4 py-2">Driver gross</th>
          </tr>
        </thead>
        <tbody>
          {loads.map((load) => (
            <tr key={load.id} className="border-b border-line/60">
              <td className="px-4 py-3 font-mono text-fg">{load.load_number}</td>
              <td className="px-4 py-3">{driverName(load.driver_id)}</td>
              <td className="px-4 py-3">{dispatcherName(load.dispatcher_id)}</td>
              <td className="px-4 py-3">
                {dateTime(load.pickup_departed_at ?? load.pickup_arrived_at ?? load.pickup_date)}
              </td>
              <td className="px-4 py-3">
                {dateTime(
                  load.delivery_departed_at ??
                    load.delivered_at ??
                    load.delivery_arrived_at ??
                    load.delivery_date,
                )}
              </td>
              {showCut && (
                <td className="num px-4 py-3 font-mono text-transit">{money(load.cut)}</td>
              )}
              <td className="num px-4 py-3 font-mono">{money(load.driver_pay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
