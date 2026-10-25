import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAllEntityDocs, useDrivers, useTrailers, useTrucks } from "@/hooks/useTms";
import { collectExpiries, collectMissing, type ExpiryItem, type ExpiryKind } from "@/lib/alerts";
import { EmptyRow, GhostButton, Panel, PanelHeader } from "./ui-kit";
import { exportCsv } from "./entity-kit";

const LINK: Record<ExpiryKind, "/safety" | "/trucks" | "/trailers"> = { driver: "/safety", truck: "/trucks", trailer: "/trailers" };

/** All expiring dates and documents, soonest first. */
export function useExpiryItems(kinds?: ExpiryKind[]): ExpiryItem[] {
  const { data: drivers = [] } = useDrivers();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { data: docs = [] } = useAllEntityDocs();
  return useMemo(() => {
    const all = collectExpiries({ drivers, trucks, trailers, docs });
    return kinds ? all.filter((i) => kinds.includes(i.kind)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, trucks, trailers, docs, kinds?.join(",")]);
}

export function ExpiryChip({ days }: { days: number }) {
  const cls = days < 0 ? "bg-problem/12 text-problem" : days <= 30 ? "bg-transit/15 text-transit" : "bg-panel2 text-mut";
  const text = days < 0 ? `Expired ${-days}d ago` : days === 0 ? "Expires today" : `In ${days}d`;
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{text}</span>;
}

export function ExpiryAlerts({ kinds, title = "Expiring documents and dates" }: { kinds?: ExpiryKind[]; title?: string }) {
  const items = useExpiryItems(kinds);
  const [windowDays, setWindowDays] = useState(60);
  const [all, setAll] = useState(false);
  const shown = items.filter((i) => i.days <= windowDays);
  const expired = shown.filter((i) => i.days < 0).length;
  const rows = all ? shown : shown.slice(0, 12);
  return (
    <Panel>
      <PanelHeader title={title} count={`${expired} expired · ${shown.length - expired} coming up`}>
        {[30, 60, 90].map((d) => (
          <GhostButton key={d} active={windowDays === d} onClick={() => setWindowDays(d)}>{d} days</GhostButton>
        ))}
        <GhostButton
          onClick={() =>
            exportCsv("expiring.csv", shown.map((i) => ({ Who: i.owner, Item: i.what, Date: i.date, Days: i.days })))
          }
        >
          Export CSV
        </GhostButton>
      </PanelHeader>
      {shown.length === 0 ? (
        <EmptyRow text={`Nothing expires in the next ${windowDays} days.`} />
      ) : (
        <div className="divide-y divide-line/60">
          {rows.map((i) => (
            <div key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
              <ExpiryChip days={i.days} />
              <span className="font-medium text-fg">{i.owner}</span>
              <span className="text-mut">{i.what}</span>
              <span className="num font-mono text-[11px] text-mut">{i.date}</span>
              <span className="ml-auto">
                <Link to={LINK[i.kind]} className="text-accent">Open</Link>
              </span>
            </div>
          ))}
          {shown.length > rows.length && (
            <div className="px-4 py-2"><GhostButton onClick={() => setAll(true)}>Show all {shown.length}</GhostButton></div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Active drivers with missing dates or missing required documents. */
export function MissingInfo() {
  const { data: drivers = [] } = useDrivers();
  const { data: docs = [] } = useAllEntityDocs();
  const [open, setOpen] = useState(false);
  const missing = useMemo(() => collectMissing({ drivers, docs }), [drivers, docs]);
  const people = new Set(missing.map((m) => m.owner)).size;
  return (
    <Panel>
      <PanelHeader title="Safety requirements" count={missing.length === 0 ? "all complete" : `⚠ ${missing.length} missing · ${people} drivers`}>
        {missing.length > 0 && <GhostButton onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</GhostButton>}
      </PanelHeader>
      {missing.length === 0 && <EmptyRow text="Every active driver has the required dates and documents." />}
      {open && (
        <div className="divide-y divide-line/60">
          {missing.map((m) => (
            <div key={m.key} className="flex items-center gap-3 px-4 py-2 text-xs">
              <span className="rounded bg-transit/15 px-1.5 py-0.5 font-mono text-[10px] text-transit">WARNING</span>
              <span className="font-medium text-fg">{m.owner}</span>
              <span className="text-transit">{m.what}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
