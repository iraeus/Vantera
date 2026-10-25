import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useBrokers, useDrivers, useLoads, useTrailers, useTrucks } from "@/hooks/useTms";

type Hit = { id: string; kind: string; title: string; sub: string; to: string };

const has = (q: string, ...vals: unknown[]) =>
  vals.some((v) => v != null && String(v).toLowerCase().includes(q));

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: loads = [] } = useLoads();
  const { data: drivers = [] } = useDrivers();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { data: brokers = [] } = useBrokers();

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out: Hit[] = [];
    loads.forEach((l) => {
      if (
        has(
          s,
          l.load_number,
          l.customer_name,
          l.pickup_location,
          l.delivery_location,
          l.shipper,
          l.consignee,
          l.commodity,
        )
      )
        out.push({
          id: l.id,
          kind: "Load",
          title: l.load_number,
          sub: `${l.pickup_location ?? "—"} → ${l.delivery_location ?? "—"}`,
          to: "/loads",
        });
    });
    drivers.forEach((d) => {
      if (has(s, d.full_name, d.phone, d.email, d.unit_number, d.cdl_number, d.driver_code))
        out.push({
          id: d.id,
          kind: "Driver",
          title: d.full_name,
          sub: [d.unit_number && `Unit ${d.unit_number}`, d.phone, d.email]
            .filter(Boolean)
            .join(" · "),
          to: "/drivers",
        });
    });
    trucks.forEach((t) => {
      if (has(s, t.truck_number, t.vin, t.plate, t.make, t.model))
        out.push({
          id: t.id,
          kind: "Truck",
          title: t.truck_number,
          sub: [t.make, t.model, t.plate].filter(Boolean).join(" · "),
          to: "/trucks",
        });
    });
    trailers.forEach((t) => {
      if (has(s, t.trailer_number, t.vin, t.plate, t.trailer_type))
        out.push({
          id: t.id,
          kind: "Trailer",
          title: t.trailer_number,
          sub: [t.trailer_type, t.plate].filter(Boolean).join(" · "),
          to: "/trailers",
        });
    });
    brokers.forEach((b) => {
      if (has(s, b.name, b.mc_number, b.dot_number, b.contact_name, b.phone, b.email))
        out.push({
          id: b.id,
          kind: "Broker",
          title: b.name,
          sub: [b.mc_number && `MC ${b.mc_number}`, b.phone].filter(Boolean).join(" · "),
          to: "/brokers",
        });
    });
    return out.slice(0, 30);
  }, [q, loads, drivers, trucks, trailers, brokers]);

  function openHit(hit: Hit) {
    navigate({ to: hit.to, search: { open: hit.id } });
    setOpen(false);
    setQ("");
  }

  return (
    <div className="relative ml-auto w-full max-w-96">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && hits[0]) openHit(hits[0]);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search loads, drivers, trucks, brokers…"
        aria-label="Search everything"
        className="h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 z-50 mt-1 max-h-96 w-full overflow-auto rounded-lg bg-panel ring-1 ring-line shadow-lg">
          {hits.length === 0 && <div className="px-3 py-3 text-xs text-mut">No results</div>}
          {hits.map((h, i) => (
            <button
              key={i}
              onMouseDown={() => openHit(h)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel2"
            >
              <span className="w-14 shrink-0 font-mono text-[10px] text-mut uppercase">
                {h.kind}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-fg">{h.title}</span>
                <span className="block truncate text-[11px] text-mut">{h.sub || "—"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
