import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GhostButton, PrimaryButton, SelectInput, TextInput } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { AMAZON_FACILITIES, type AmazonFacility } from "@/lib/amazon-facilities";
import {
  createLoadStop,
  MAX_LOAD_STOPS,
  easternDateToday,
  type LoadStop,
  type LoadStopType,
} from "@/lib/load-stops";

const TYPE_OPTIONS = [
  { value: "pickup", text: "Pickup" },
  { value: "delivery", text: "Delivery" },
  { value: "intermediate", text: "Intermediate" },
];
const STATUS_OPTIONS = [
  { value: "scheduled", text: "Scheduled" },
  { value: "arrived", text: "Arrived" },
  { value: "in_progress", text: "In progress" },
  { value: "completed", text: "Completed" },
  { value: "issue", text: "Issue" },
];
const TIMEZONE_OPTIONS = [
  { value: "America/New_York", text: "Eastern (ET)" },
  { value: "America/Chicago", text: "Central (CT)" },
  { value: "America/Denver", text: "Mountain (MT)" },
  { value: "America/Los_Angeles", text: "Pacific (PT)" },
  { value: "America/Anchorage", text: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", text: "Hawaii (HT)" },
];

function location(stop: LoadStop) {
  const city = [stop.city, stop.state].filter(Boolean).join(", ");
  return city || stop.facility_name || "Location not entered";
}

type FacilityChoice = AmazonFacility & { name?: string; state?: string; postal_code?: string };
type SavedFacility = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  created_at: string;
};
const LOCAL_FACILITIES_KEY = "vantera:custom-facilities:v1";

function readLocalFacilities(): SavedFacility[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_FACILITIES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedFacility =>
      !!item && typeof item === "object" && typeof item.name === "string" &&
      typeof item.address === "string" && typeof item.city === "string" &&
      typeof item.state === "string" && typeof item.postal_code === "string",
    );
  } catch {
    return [];
  }
}

function FacilityLookup({
  value,
  facilities,
  onSelect,
  onType,
}: {
  value: string;
  facilities: FacilityChoice[];
  onSelect: (facility: FacilityChoice) => void;
  onType: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = (open ? query : value).trim().toLowerCase();
  const matches = search
    ? facilities.filter((facility) =>
        `${facility.code} ${facility.name ?? ""} ${facility.city} ${facility.address} ${facility.postal_code ?? ""}`.toLowerCase().includes(search),
      ).slice(0, 20)
    : [];

  return (
    <label className="relative block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Facility / company</span>
      <input
        value={open ? query : value}
        onFocus={() => { setQuery(value); setOpen(true); }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          onType(next);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        placeholder="Search Amazon code, city, or address"
        className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:outline-none"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl">
          {matches.map((facility) => (
            <button
              key={facility.code}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(facility);
                setQuery(facility.code);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-ink"
            >
              <span className="font-mono font-semibold text-fg">{facility.code}</span>
              <span className="min-w-0 flex-1 truncate text-mut">{facility.city} · {facility.address}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

export function LoadStopsEditor({
  stops,
  onChange,
}: {
  stops: LoadStop[];
  onChange: (stops: LoadStop[]) => void;
}) {
  const queryClient = useQueryClient();
  const [savingFacility, setSavingFacility] = useState(false);
  const { data: savedFacilities = [] } = useQuery({
    queryKey: ["custom-facilities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("custom_facilities").select("*").order("name");
      const localFacilities = readLocalFacilities();
      if (error) return localFacilities;
      const byAddress = new Map<string, SavedFacility>();
      for (const facility of [...localFacilities, ...(data ?? [])])
        byAddress.set(`${facility.name.toLowerCase()}|${facility.address.toLowerCase()}`, facility);
      return [...byAddress.values()];
    },
    retry: false,
  });
  const facilityChoices: FacilityChoice[] = [
    ...AMAZON_FACILITIES,
    ...savedFacilities.map((facility) => ({
      code: facility.name,
      name: facility.name,
      city: `${facility.city}, ${facility.state}`,
      address: facility.address,
      postal_code: facility.postal_code,
      state: facility.state,
      lat: null,
      lng: null,
    })),
  ];
  const [selectedId, setSelectedId] = useState(stops[0]?.id ?? "");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const selected = stops.find((stop) => stop.id === selectedId) ?? stops[0];

  function update(next: LoadStop[]) {
    const numbered = next.map((stop, index) => ({ ...stop, sequence_number: index + 1 }));
    onChange(numbered);
  }

  function patchStop(id: string, values: Partial<LoadStop>) {
    update(stops.map((stop) => (stop.id === id ? { ...stop, ...values } : stop)));
  }

  function addStop() {
    if (stops.length >= MAX_LOAD_STOPS) return;
    const stop = createLoadStop("intermediate", stops.length + 1, easternDateToday());
    update([...stops, stop]);
    setSelectedId(stop.id);
  }

  function duplicateStop(stop: LoadStop) {
    if (stops.length >= MAX_LOAD_STOPS) return;
    const clone = { ...stop, id: createLoadStop(stop.stop_type, 0).id, status: "scheduled" };
    const index = stops.findIndex((item) => item.id === stop.id);
    update([...stops.slice(0, index + 1), clone, ...stops.slice(index + 1)]);
    setSelectedId(clone.id);
  }

  function moveStop(id: string, direction: -1 | 1) {
    const index = stops.findIndex((stop) => stop.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= stops.length) return;
    const next = stops.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    update(next);
  }

  function removeStop(id: string) {
    const next = stops.filter((stop) => stop.id !== id);
    update(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? "");
    setConfirmDeleteId(null);
  }

  const setType = (value: string) => {
    if (!selected) return;
    patchStop(selected.id, { stop_type: value as LoadStopType });
  };
  const set = (key: keyof LoadStop) => (value: string) => {
    if (selected) patchStop(selected.id, { [key]: value });
  };

  async function saveFacility() {
    if (!selected) return;
    const name = selected.facility_name.trim();
    if (!name || !selected.street_address.trim() || !selected.city.trim() || !selected.state.trim() || !selected.postal_code.trim()) {
      toast.error("Enter the facility name, street address, city, state, and ZIP before saving.");
      return;
    }
    setSavingFacility(true);
    const row = {
      name,
      address: selected.street_address.trim(),
      city: selected.city.trim(),
      state: selected.state.trim().toUpperCase(),
      postal_code: selected.postal_code.trim(),
    };
    const local = readLocalFacilities();
    const saved: SavedFacility = {
      ...row,
      id: `local-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    const nextLocal = [...local.filter((facility) =>
      !(facility.name.toLowerCase() === name.toLowerCase() && facility.address.toLowerCase() === row.address.toLowerCase()),
    ), saved];
    localStorage.setItem(LOCAL_FACILITIES_KEY, JSON.stringify(nextLocal));
    const { error } = await supabase.from("custom_facilities").upsert(row, { onConflict: "name,address" });
    setSavingFacility(false);
    if (error) {
      queryClient.setQueryData(["custom-facilities"], nextLocal);
      toast.success(`${name} saved on this device for future loads`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["custom-facilities"] });
    toast.success(`${name} saved for future loads`);
  }

  const alreadySaved = selected && savedFacilities.some((facility) =>
    facility.name.trim().toLowerCase() === selected.facility_name.trim().toLowerCase() &&
    facility.address.trim().toLowerCase() === selected.street_address.trim().toLowerCase(),
  );

  return (
    <section className="col-span-full rounded-xl bg-panel p-3 ring-1 ring-line md:p-4" aria-label="Multi-stop itinerary">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">Stops & appointments</h3>
          <p className="mt-0.5 text-[10px] text-mut">Details are optional while drafting. Dates default to today in Eastern Time.</p>
        </div>
        <span className="ml-auto font-mono text-[10px] text-mut">{stops.length} / {MAX_LOAD_STOPS} stops</span>
        <PrimaryButton onClick={addStop} disabled={stops.length >= MAX_LOAD_STOPS}>＋ Add stop</PrimaryButton>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(210px,0.68fr)_minmax(0,1.55fr)]">
        <div className="space-y-1.5" aria-label="Stop order">
          {stops.map((stop, index) => (
            <div key={stop.id} className={`rounded-lg p-2 ring-1 ${selected?.id === stop.id ? "bg-accent/10 ring-accent/50" : "bg-panel2/60 ring-line"}`}>
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedId(stop.id); setConfirmDeleteId(null); }}
                  aria-pressed={selected?.id === stop.id}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block font-mono text-[9px] text-mut">STOP {index + 1} · {stop.stop_type.toUpperCase()}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-fg">{stop.facility_name || location(stop)}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-mut">{stop.appointment_date || "No date"}{stop.appointment_time ? ` · ${stop.appointment_time}` : ""}</span>
                </button>
                <div className="flex shrink-0 gap-0.5">
                  <button type="button" onClick={() => moveStop(stop.id, -1)} disabled={index === 0} aria-label={`Move stop ${index + 1} up`} className="rounded px-1.5 text-[11px] text-mut hover:bg-panel disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveStop(stop.id, 1)} disabled={index === stops.length - 1} aria-label={`Move stop ${index + 1} down`} className="rounded px-1.5 text-[11px] text-mut hover:bg-panel disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => duplicateStop(stop)} disabled={stops.length >= MAX_LOAD_STOPS} aria-label={`Duplicate stop ${index + 1}`} className="rounded px-1.5 text-[11px] text-mut hover:bg-panel disabled:opacity-30">＋</button>
                  <button type="button" onClick={() => setConfirmDeleteId(stop.id)} aria-label={`Delete stop ${index + 1}`} className="rounded px-1.5 text-[11px] text-mut hover:text-problem">×</button>
                </div>
              </div>
              {confirmDeleteId === stop.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[10px] text-fg" role="alert">
                  <span>Delete this stop?</span>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="ml-auto rounded bg-panel px-2 py-1 text-mut ring-1 ring-line">Keep</button>
                  <button type="button" onClick={() => removeStop(stop.id)} className="rounded bg-problem px-2 py-1 font-semibold text-white">Delete</button>
                </div>
              )}
            </div>
          ))}
          <div className="rounded-md bg-panel2/50 px-2 py-1.5 text-[10px] text-mut">
            Route order: {stops.map((stop) => location(stop)).join(" → ")}
          </div>
        </div>

        {selected ? (
          <div className="rounded-lg bg-panel2/50 p-3">
            <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SelectInput label="Stop type" value={selected.stop_type} onChange={setType} options={TYPE_OPTIONS} />
              <SelectInput label="Stop status" value={selected.status} onChange={set("status")} options={STATUS_OPTIONS} />
              <FacilityLookup
                value={selected.facility_name}
                facilities={facilityChoices}
                onType={(value) => set("facility_name")(value)}
                onSelect={(facility) => {
                  const [city = "", stateFromCity = ""] = facility.city.split(",").map((part) => part.trim());
                  patchStop(selected.id, {
                    facility_name: facility.name ?? facility.code,
                    street_address: facility.address,
                    city,
                    state: facility.state ?? stateFromCity,
                    postal_code: facility.postal_code ?? "",
                    country: "United States",
                  });
                }}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <TextInput label="Street address" value={selected.street_address} onChange={set("street_address")} />
              <TextInput label="City" value={selected.city} onChange={set("city")} />
              <TextInput label="State / province" value={selected.state} onChange={set("state")} />
              <TextInput label="ZIP / postal code" value={selected.postal_code} onChange={set("postal_code")} />
              <SelectInput label="Country" value={selected.country} onChange={set("country")} options={[
                { value: "United States", text: "United States" },
                { value: "Canada", text: "Canada" },
                { value: "Mexico", text: "Mexico" },
              ]} />
              <SelectInput label="Time zone" value={selected.timezone} onChange={set("timezone")} options={TIMEZONE_OPTIONS} />
              <TextInput label="Appointment date" type="date" value={selected.appointment_date} onChange={set("appointment_date")} />
              <TextInput label="Appointment time" type="time" value={selected.appointment_time} onChange={set("appointment_time")} />
              <TextInput label="Appointment / reference #" value={selected.appointment_number} onChange={set("appointment_number")} />
              <TextInput label="BOL number" value={selected.bol_number} onChange={set("bol_number")} />
              <TextInput label="Contact name" value={selected.contact_name} onChange={set("contact_name")} />
              <TextInput label="Contact phone" value={selected.contact_phone} onChange={set("contact_phone")} />
              <TextInput label="Contact email" type="email" value={selected.contact_email} onChange={set("contact_email")} />
              <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-3">
                <span className="text-[10px] text-mut">Save complete facility details for reuse in future loads.</span>
                <button type="button" disabled={savingFacility || !!alreadySaved} onClick={saveFacility} className="shrink-0 rounded-lg bg-panel px-3 py-2 text-xs font-medium text-fg ring-1 ring-line hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50">
                  {savingFacility ? "Saving…" : alreadySaved ? "Facility saved" : "Save facility"}
                </button>
              </div>
              <label className="block sm:col-span-2 lg:col-span-3">
                <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Instructions / notes (optional)</span>
                <textarea value={selected.instructions} onChange={(event) => set("instructions")(event.target.value)} rows={2} className="mt-1 w-full rounded-lg bg-ink p-2 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:outline-none focus:ring-accent/40" placeholder="Gate, dock, temperature, or other instructions" />
              </label>
            </div>
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-lg bg-panel2/50 p-4 text-xs text-mut">Add a stop to begin the itinerary.</div>
        )}
      </div>
    </section>
  );
}
