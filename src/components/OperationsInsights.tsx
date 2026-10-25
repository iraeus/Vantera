import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CircleAlert, MapPin, ShieldAlert } from "lucide-react";
import { useAllEntityDocs, useProfiles, useRecentLoadEvents, type Driver, type Load, type Trailer, type Truck } from "@/hooks/useTms";
import { collectExpiries, collectMissing } from "@/lib/alerts";
import { ACTIVE_STATUSES, label, money } from "@/lib/tms";
import { EmptyRow, GhostButton, Panel, PanelHeader } from "@/components/ui-kit";
import { fmtTime } from "@/components/entity-kit";

type Range = "day" | "week" | "month" | "year";

export function OperationsInsights({ loads, drivers, trucks, trailers }: {
  loads: Load[];
  drivers: Driver[];
  trucks: Truck[];
  trailers: Trailer[];
}) {
  const { data: profiles = [] } = useProfiles();
  const { data: docs = [] } = useAllEntityDocs();
  const { data: events = [] } = useRecentLoadEvents();
  const [range, setRange] = useState<Range>("week");
  const [sort, setSort] = useState<"high" | "low">("high");
  const now = new Date();
  const currentDate = dateOnly(now);
  const periodLoads = useMemo(
    () => loads.filter((load) => isInRange(loadDate(load), now, range)),
    [loads, range, currentDate],
  );
  const bins = useMemo(() => createBins(periodLoads, now, range), [periodLoads, range, currentDate]);
  const maxBin = Math.max(1, ...bins.map((bin) => bin.gross));

  const dispatcherTotals = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; loads: number; gross: number; cut: number }>();
    for (const profile of profiles.filter((item) => item.is_active)) {
      byId.set(profile.id, {
        id: profile.id,
        name: profile.full_name ?? profile.email ?? "Staff member",
        loads: 0,
        gross: 0,
        cut: 0,
      });
    }
    for (const load of periodLoads) {
      if (!load.dispatcher_id) continue;
      const current = byId.get(load.dispatcher_id) ?? {
        id: load.dispatcher_id,
        name: "Inactive dispatcher",
        loads: 0,
        gross: 0,
        cut: 0,
      };
      current.loads += 1;
      current.gross += Number(load.driver_pay ?? 0);
      current.cut += Number(load.cut ?? 0);
      byId.set(current.id, current);
    }
    return [...byId.values()]
      .filter((item) => item.loads > 0)
      .sort((a, b) => sort === "high" ? b.gross - a.gross : a.gross - b.gross);
  }, [periodLoads, profiles, sort]);

  const activeLoads = loads.filter((load) => load.driver_id && ACTIVE_STATUSES.includes(load.status));
  const dispatcherWorkload = countBy(activeLoads, (load) => load.dispatcher_id ?? "unassigned", (id) =>
    profiles.find((person) => person.id === id)?.full_name ?? "Unassigned",
  );
  const driverWorkload = countBy(activeLoads, (load) => load.driver_id ?? "unassigned", (id) =>
    drivers.find((driver) => driver.id === id)?.full_name ?? "Unassigned",
  );
  const maxWorkload = Math.max(1, ...dispatcherWorkload.map((item) => item.count), ...driverWorkload.map((item) => item.count));

  const missing = useMemo(() => collectMissing({ drivers, docs }).slice(0, 5), [drivers, docs]);
  const expiring = useMemo(() => collectExpiries({ drivers, trucks, trailers, docs }).filter((item) => item.days <= 30).slice(0, 3), [drivers, trucks, trailers, docs]);
  const safetyItems = [...missing.map((item) => ({ key: item.key, owner: item.owner, detail: item.what })), ...expiring.map((item) => ({ key: item.key, owner: item.owner, detail: `${item.what} · ${item.days < 0 ? `expired ${Math.abs(item.days)}d ago` : item.days === 0 ? "expires today" : `expires in ${item.days}d`}` }))].slice(0, 5);
  const cutLoads = periodLoads.filter((load) => Number(load.cut ?? 0) > 0).sort((a, b) => loadDate(b).getTime() - loadDate(a).getTime()).slice(0, 5);
  const cutTotal = periodLoads.reduce((sum, load) => sum + Number(load.cut ?? 0), 0);

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(270px,1fr)]">
        <Panel>
          <PanelHeader title="Dispatcher gross" count={`Amazon Relay · ${rangeLabel(range)}`}>
            <div className="flex flex-wrap items-center gap-1">
              {(["day", "week", "month", "year"] as const).map((item) => (
                <GhostButton key={item} active={range === item} onClick={() => setRange(item)}>{label(item)}</GhostButton>
              ))}
              <select aria-label="Sort dispatcher gross" value={sort} onChange={(event) => setSort(event.target.value as "high" | "low")} className="h-8 rounded-lg bg-panel2 px-2 text-[11px] text-fg ring-1 ring-line focus:ring-accent/40 focus:outline-none">
                <option value="high">Highest gross</option>
                <option value="low">Lowest gross</option>
              </select>
            </div>
          </PanelHeader>
          <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)]">
            <div>
              <div className="mb-3 flex items-end justify-between gap-2">
                <div><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-mut">Driver pay</span><div className="num mt-1 font-display text-2xl font-semibold">{money(periodLoads.reduce((sum, load) => sum + Number(load.driver_pay ?? 0), 0))}</div></div>
                <Link to="/gross" className="flex items-center gap-1 text-[11px] text-accent">Gross board <ArrowUpRight className="size-3.5" /></Link>
              </div>
              <div className="flex h-28 items-end gap-1.5 border-b border-line/70 px-1" role="img" aria-label={`Driver gross by ${range === "week" ? "day" : range}`}>
                {bins.map((bin) => (
                  <div key={bin.key} className="group/bar flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${bin.label}: ${money(bin.gross)}`}>
                    <div className="w-full max-w-8 rounded-t-md bg-gradient-to-t from-accent/55 to-accent transition-[height] duration-300" style={{ height: `${bin.gross ? Math.max(7, (bin.gross / maxBin) * 100) : 2}%` }} />
                    <span className="font-mono text-[9px] text-mut">{bin.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-mut"><span className="size-2 rounded-full bg-accent" />Driver pay by {range === "week" ? "day" : range}</div>
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-mut">Ranked dispatchers</span><span className="font-mono text-[10px] text-mut">CUT total {money(cutTotal)}</span></div>
              {dispatcherTotals.length === 0 ? <EmptyRow text="No dispatcher gross in this period." /> : (
                <div className="divide-y divide-line/60">
                  {dispatcherTotals.slice(0, 5).map((person, index) => (
                    <div key={person.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 py-2">
                      <span className="font-mono text-[10px] text-mut">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0"><strong className="block truncate text-xs font-medium text-fg">{person.name}</strong><small className="text-[10px] text-mut">{person.loads} loads · CUT {money(person.cut)}</small></span>
                      <strong className="num text-xs text-accent">{money(person.gross)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Safety overview" count={safetyItems.length ? `⚠ ${missing.length + expiring.length} to review` : "All clear"}>
            <Link to="/safety" className="text-[11px] text-accent">Open safety →</Link>
          </PanelHeader>
          <div className="divide-y divide-line/60">
            {safetyItems.length === 0 ? <EmptyRow text="Driver documents and dates are up to date." /> : safetyItems.map((item) => (
              <Link key={item.key} to="/safety" className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-panel2/70">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-transit/12 text-transit"><ShieldAlert className="size-3.5" /></span>
                <span className="min-w-0"><strong className="block truncate text-xs text-fg">{item.owner}</strong><small className="block truncate text-[10px] text-mut">{item.detail}</small></span>
                <CircleAlert className="ml-auto size-3.5 shrink-0 text-transit" />
              </Link>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(270px,1fr)]">
        <Panel>
          <PanelHeader title="Load activity" count="Latest updates" />
          <div className="divide-y divide-line/60">
            {events.length === 0 ? <EmptyRow text="No load activity has been recorded yet." /> : events.slice(0, 6).map((event) => {
              const load = loads.find((item) => item.id === event.load_id);
              const driverName = drivers.find((driver) => driver.id === load?.driver_id)?.full_name;
              return (
                <div key={event.id} className="grid grid-cols-[68px_14px_minmax(0,1fr)] items-center gap-2.5 px-4 py-2.5">
                  <span className="font-mono text-[10px] text-mut">{timeAgo(event.created_at)}</span>
                  <span className="size-2.5 rounded-full bg-accent/75 ring-4 ring-accent/10" />
                  <span className="min-w-0"><strong className="block truncate text-xs font-medium text-fg">{event.description || label(event.event_type)}</strong><small className="block truncate text-[10px] text-mut">{load ? `${load.load_number}${driverName ? ` · ${driverName}` : ""}` : "Load activity"} · {fmtTime(event.created_at)}</small></span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Route watch" count={`${activeLoads.length} active loads`}>
            <Link to="/dispatch" className="text-[11px] text-accent">Dispatch board →</Link>
          </PanelHeader>
          <div className="divide-y divide-line/60">
            {activeLoads.length === 0 ? <EmptyRow text="No active routes right now." /> : activeLoads.slice(0, 4).map((load) => {
              const driver = drivers.find((item) => item.id === load.driver_id);
              return (
                <div key={load.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3"><strong className="font-mono text-[11px] text-fg">{load.load_number} · {driver?.full_name ?? "Driver pending"}</strong><span className="rounded-full bg-accent/12 px-2 py-0.5 text-[9px] text-accent">{label(load.status)}</span></div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-mut"><span className="truncate">{load.pickup_location ?? "Pickup TBD"}</span><span className="h-px min-w-4 flex-1 border-t border-dashed border-accent/60" /><span className="truncate">{load.delivery_location ?? "Delivery TBD"}</span></div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-mut"><MapPin className="size-3 text-accent" /><span className="truncate">{load.current_location || "Waiting for a location update"}</span><span className="ml-auto shrink-0">{load.last_location_update ? timeAgo(load.last_location_update) : "No update"}</span></div>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Team workload" count="Active loads by assignment" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Workload title="Dispatchers" rows={dispatcherWorkload} max={maxWorkload} />
            <Workload title="Drivers" rows={driverWorkload} max={maxWorkload} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Company profit · CUT" count={`${cutLoads.length} loads shown`}>
            <Link to="/gross" className="text-[11px] text-accent">Full CUT board →</Link>
          </PanelHeader>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-mut">{rangeLabel(range)} CUT total</span><strong className="num font-display text-xl text-accent">{money(cutTotal)}</strong></div>
          {cutLoads.length === 0 ? <EmptyRow text="No company CUT recorded in this period." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]"><thead><tr className="border-y border-line/70 font-mono text-[9px] uppercase tracking-[0.1em] text-mut"><th className="px-4 py-2 font-normal">Load</th><th className="px-2 py-2 font-normal">Driver</th><th className="px-2 py-2 font-normal">Dispatch</th><th className="px-4 py-2 text-right font-normal">CUT</th></tr></thead><tbody className="divide-y divide-line/50">{cutLoads.map((load) => <tr key={load.id}><td className="px-4 py-2 font-mono text-fg">{load.load_number}</td><td className="px-2 py-2 text-mut">{drivers.find((driver) => driver.id === load.driver_id)?.full_name ?? "—"}</td><td className="px-2 py-2 text-mut">{profiles.find((person) => person.id === load.dispatcher_id)?.full_name ?? "—"}</td><td className="num px-4 py-2 text-right font-medium text-accent">{money(load.cut)}</td></tr>)}</tbody></table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

function Workload({ title, rows, max }: { title: string; rows: { id: string; name: string; count: number }[]; max: number }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mut">{title}</div>
      {rows.length === 0 ? <div className="py-2 text-xs text-mut">No assignments</div> : <div className="space-y-2.5">{rows.slice(0, 5).map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,88px)_minmax(0,1fr)_20px] items-center gap-2"><span className="truncate text-[10px] text-fg">{row.name}</span><div className="h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent transition-[width] duration-300" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} /></div><span className="num text-right font-mono text-[10px] text-mut">{row.count}</span></div>
      ))}</div>}
    </div>
  );
}

function countBy<T>(items: T[], keyOf: (item: T) => string, nameOf: (id: string) => string) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts].map(([id, count]) => ({ id, name: nameOf(id), count })).sort((a, b) => b.count - a.count);
}

function loadDate(load: Load) {
  const value = load.pickup_date ?? load.created_at;
  const [year = 1970, month = 1, day = 1] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateOnly(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isInRange(date: Date, now: Date, range: Range) {
  if (range === "day") return dateOnly(date) === dateOnly(now);
  if (range === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (range === "year") return date.getFullYear() === now.getFullYear();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function createBins(loads: Load[], now: Date, range: Range) {
  let bins: { key: string; label: string; from: Date; until: Date }[] = [];
  if (range === "day") {
    bins = [{ key: "today", label: "Today", from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), until: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) }];
  } else if (range === "week") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - start.getDay());
    bins = Array.from({ length: 7 }, (_, index) => {
      const from = new Date(start);
      from.setDate(start.getDate() + index);
      const until = new Date(from);
      until.setDate(from.getDate() + 1);
      return { key: dateOnly(from), label: from.toLocaleDateString("en-US", { weekday: "short" }), from, until };
    });
  } else if (range === "month") {
    const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    bins = Array.from({ length: Math.ceil(count / 7) }, (_, index) => {
      const from = new Date(now.getFullYear(), now.getMonth(), index * 7 + 1);
      const until = new Date(now.getFullYear(), now.getMonth(), Math.min(count + 1, index * 7 + 8));
      return { key: `week-${index + 1}`, label: `W${index + 1}`, from, until };
    });
  } else {
    bins = Array.from({ length: 12 }, (_, index) => ({
      key: `month-${index}`,
      label: new Date(now.getFullYear(), index, 1).toLocaleDateString("en-US", { month: "short" }),
      from: new Date(now.getFullYear(), index, 1),
      until: new Date(now.getFullYear(), index + 1, 1),
    }));
  }
  return bins.map((bin) => ({ ...bin, gross: loads.filter((load) => {
    const date = loadDate(load);
    return date >= bin.from && date < bin.until;
  }).reduce((sum, load) => sum + Number(load.driver_pay ?? 0), 0) }));
}

function rangeLabel(range: Range) {
  if (range === "week") return "this week · Sun–Sat";
  if (range === "day") return "today";
  return `this ${range}`;
}

function timeAgo(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000));
  if (minutes === 0) return "Now";
  if (minutes === 1) return "1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
