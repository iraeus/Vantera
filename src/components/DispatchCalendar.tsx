import { Fragment, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivity, logLoadEvent, useActivity, type Driver, type Load, type Profile } from "@/hooks/useTms";
import { useQueryClient } from "@tanstack/react-query";
import { useBusinessSettings } from "@/hooks/useSettings";
import { dispatchStatusName } from "@/lib/dispatch-statuses";
import { loadRevenue, money } from "@/lib/tms";
import { Panel } from "@/components/ui-kit";

const FILTERS = [
  { value: "all", label: "All drivers", color: "text-fg" },
  { value: "ready", label: "Ready", color: "text-delivered" },
  { value: "prebook", label: "Prebooked", color: "text-transit" },
  { value: "covered", label: "Covered", color: "text-accent" },
  { value: "in_transit", label: "In transit", color: "text-transit" },
  { value: "issue", label: "Issue", color: "text-problem" },
  { value: "home", label: "Home", color: "text-mut" },
  { value: "rest", label: "Rest", color: "text-mut" },
  { value: "other", label: "Other", color: "text-mut" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];
type PositionedLoad = { load: Load; start: number; end: number };
const LOAD_STATUSES = [
  { value: "booked", label: "Upcoming" },
  { value: "in_transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function valueDateKey(value: string | null | undefined) {
  if (!value) return null;
  if (value.length === 10) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateKey(date);
}

function dateDistance(from: string, to: string) {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function addDays(key: string, amount: number) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function driverCategory(driver: Driver): FilterValue {
  const status = driver.dispatch_status ?? "";
  if (status === "rest_home") return driver.status === "off_duty" ? "rest" : "home";
  if (status === "home" || driver.status === "home") return "home";
  if (status === "rest" || driver.status === "off_duty") return "rest";
  if (["ready", "prebook", "covered", "in_transit", "issue"].includes(status))
    return status as FilterValue;
  return "other";
}

function driverShare(driver: Driver, gross: number, storedPay: number) {
  if (driver.driver_type === "owner_operator" && driver.pay_type === "percentage") {
    return (gross * Math.min(100, Math.max(0, Number(driver.pay_rate ?? 0)))) / 100;
  }
  return storedPay;
}

function currency(value: number, fractionDigits = 0) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function compactDate(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function loadDates(load: Load, fallback: string) {
  const start =
    valueDateKey(load.pickup_date) ??
    valueDateKey(load.pickup_eta) ??
    valueDateKey(load.created_at) ??
    fallback;
  const end =
    valueDateKey(load.delivery_date) ??
    valueDateKey(load.delivery_eta) ??
    valueDateKey(load.delivery_departed_at) ??
    valueDateKey(load.delivered_at) ??
    start;
  return start <= end ? { start, end } : { start: end, end: start };
}

function loadTone(status: string) {
  if (["delivered", "pod_received", "billing", "paid"].includes(status)) return "bg-delivered";
  if (["cancelled", "rejected", "tonu"].includes(status)) return "bg-mut";
  if (["picked_up", "in_transit", "at_delivery", "unloading"].includes(status))
    return "bg-transit";
  return "bg-accent";
}

function loadStatusLabel(status: string) {
  if (["booked", "upcoming", "assigned", "dispatched"].includes(status)) return "Upcoming";
  if (["picked_up", "in_transit", "at_delivery", "unloading"].includes(status))
    return "In transit";
  if (["delivered", "pod_received", "billing", "paid"].includes(status)) return "Delivered";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function masterStatusForDispatch(driver: Driver, status: string) {
  if (["ready", "covered", "prebook"].includes(status)) return "available";
  if (status === "in_transit") return "on_load";
  if (status === "home") return "home";
  if (["rest", "off_duty"].includes(status)) return "off_duty";
  return driver.status;
}

function normalizedLoadStatus(status: string) {
  if (["booked", "upcoming", "assigned", "dispatched"].includes(status)) return "booked";
  if (["picked_up", "in_transit", "at_delivery", "unloading"].includes(status)) return "in_transit";
  if (["delivered", "pod_received", "billing", "paid"].includes(status)) return "delivered";
  return status;
}

export function DispatchCalendar({
  drivers,
  loads,
  dispatchers,
  canEdit,
}: {
  drivers: Driver[];
  loads: Load[];
  dispatchers: Profile[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { dispatchStatuses } = useBusinessSettings();
  const [statusFilter, setStatusFilter] = useState<FilterValue>("all");
  const [search, setSearch] = useState("");
  const [weekShift, setWeekShift] = useState(0);
  const [noteDriver, setNoteDriver] = useState<Driver | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [selectedLoad, setSelectedLoad] = useState<Load | null>(null);
  const [loadMenuPoint, setLoadMenuPoint] = useState<{ top: number; left: number } | null>(null);
  const [showLoadStatuses, setShowLoadStatuses] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const { data: driverActivity = [] } = useActivity("driver", noteDriver?.id);
  const noteHistory = driverActivity.filter((entry) => entry.description.startsWith("Dispatch note"));

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.status !== "inactive"),
    [drivers],
  );
  const currentSunday = useMemo(() => {
    const today = new Date();
    const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    sunday.setDate(sunday.getDate() - sunday.getDay() + weekShift * 7);
    return dateKey(sunday);
  }, [weekShift]);
  const rangeEnd = addDays(currentSunday, 6);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(currentSunday, index)),
    [currentSunday],
  );
  const counts = useMemo(() => {
    const result: Record<FilterValue, number> = {
      all: activeDrivers.length,
      ready: 0,
      prebook: 0,
      covered: 0,
      in_transit: 0,
      issue: 0,
      home: 0,
      rest: 0,
      other: 0,
    };
    activeDrivers.forEach((driver) => (result[driverCategory(driver)] += 1));
    return result;
  }, [activeDrivers]);
  const visibleDrivers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return activeDrivers
      .filter((driver) => statusFilter === "all" || driverCategory(driver) === statusFilter)
      .filter((driver) => !query || driver.full_name.toLocaleLowerCase().includes(query))
      .slice()
      .sort((a, b) => {
        const aStatus = dispatchStatuses.find((item) => item.value === a.dispatch_status);
        const bStatus = dispatchStatuses.find((item) => item.value === b.dispatch_status);
        return (
          (aStatus?.priority ?? 999) - (bStatus?.priority ?? 999) ||
          a.full_name.localeCompare(b.full_name)
        );
      });
  }, [activeDrivers, dispatchStatuses, search, statusFilter]);

  const loadsByDriver = useMemo(() => {
    const grouped = new Map<string, PositionedLoad[]>();
    for (const driver of activeDrivers) {
      const assigned = loads
        .filter((load) => load.driver_id === driver.id && !load.deleted_at)
        .map((load) => {
          const dates = loadDates(load, currentSunday);
          const start = dateDistance(currentSunday, dates.start);
          const end = dateDistance(currentSunday, dates.end);
          if (end < 0 || start > 6) return null;
          return { load, start: Math.max(0, start), end: Math.min(6, end) };
        })
        .filter((item): item is PositionedLoad => item !== null)
        .sort((a, b) => a.start - b.start || a.end - b.end);
      grouped.set(driver.id, assigned);
    }
    return grouped;
  }, [activeDrivers, currentSunday, loads]);

  const weekMetrics = useMemo(() => {
    const start = currentSunday;
    const end = addDays(start, 6);
    const byDriver = new Map<string, { trips: number; miles: number; gross: number; pay: number }>();
    for (const driver of activeDrivers) {
      const driverLoads = loads.filter((load) => {
        if (load.driver_id !== driver.id || load.deleted_at) return false;
        const metricDate =
          valueDateKey(load.delivered_at) ??
          valueDateKey(load.delivery_departed_at) ??
          valueDateKey(load.delivery_date) ??
          valueDateKey(load.pickup_departed_at) ??
          valueDateKey(load.pickup_date) ??
          valueDateKey(load.created_at) ??
          start;
        return metricDate >= start && metricDate <= end && !["cancelled", "rejected", "tonu"].includes(load.status);
      });
      const gross = driverLoads.reduce((sum, load) => sum + loadRevenue(load), 0);
      const miles = driverLoads.reduce((sum, load) => sum + Number(load.miles ?? 0), 0);
      const storedPay = driverLoads.reduce((sum, load) => sum + Number(load.driver_pay ?? 0), 0);
      byDriver.set(driver.id, {
        trips: driverLoads.length,
        miles,
        gross,
        pay: driverShare(driver, gross, storedPay),
      });
    }
    return byDriver;
  }, [activeDrivers, currentSunday, loads]);

  useEffect(() => {
    if (!noteDriver) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNoteDriver(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [noteDriver]);

  useEffect(() => {
    if (!selectedLoad) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedLoad(null);
        setShowLoadStatuses(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-load-menu], [data-load-trigger]")) return;
      setSelectedLoad(null);
      setShowLoadStatuses(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectedLoad]);

  function toggleFilter(value: FilterValue) {
    setStatusFilter((current) => (value === "all" || current === value ? "all" : value));
  }

  function openNote(driver: Driver) {
    setNoteDriver(driver);
    setNoteDraft("");
  }

  function openLoadMenu(load: Load, event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 240;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    const below = rect.bottom + 8;
    const top = below + menuHeight <= window.innerHeight
      ? below
      : Math.max(8, rect.top - menuHeight - 8);
    setLoadMenuPoint({ top, left });
    setSelectedLoad(load);
    setShowLoadStatuses(false);
  }

  async function saveNote() {
    if (!noteDriver) return;
    setSavingNote(true);
    const note = noteDraft.trim().slice(0, 500);
    const { error } = await supabase
      .from("drivers")
      .update({ dispatch_note: note || null })
      .eq("id", noteDriver.id);
    setSavingNote(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity(
      "driver",
      noteDriver.id,
      note ? `Dispatch note updated: ${note}` : "Dispatch note cleared",
    );
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    await queryClient.invalidateQueries({ queryKey: ["activity", "driver", noteDriver.id] });
    setNoteDraft("");
    toast.success("Dispatch note saved");
  }

  async function changeDriverStatus(driver: Driver, status: string) {
    setSavingStatusId(driver.id);
    const { error } = await supabase
      .from("drivers")
      .update({ dispatch_status: status, status: masterStatusForDispatch(driver, status) })
      .eq("id", driver.id);
    setSavingStatusId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const statusLabel = dispatchStatusName(status, dispatchStatuses);
    await logActivity("driver", driver.id, `Dispatch status changed to ${statusLabel}`);
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    toast.success(`${driver.full_name}: ${statusLabel}`);
  }

  async function changeLoadStatus(status: string) {
    if (!selectedLoad) return;
    setSavingStatusId(selectedLoad.id);
    const { error } = await supabase
      .from("loads")
      .update({
        status,
        is_problem: false,
        ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
      })
      .eq("id", selectedLoad.id);
    setSavingStatusId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logLoadEvent(selectedLoad.id, "status_change", `Status set to ${loadStatusLabel(status)}`);
    await queryClient.invalidateQueries({ queryKey: ["loads"] });
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    toast.success(`${selectedLoad.load_number} → ${loadStatusLabel(status)}`);
    setSelectedLoad(null);
    setShowLoadStatuses(false);
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="font-display text-base font-semibold">Dispatch calendar</div>
          <div className="mt-0.5 text-[11px] text-mut">
            Amazon weeks run Sunday through Saturday · assigned load IDs appear on their scheduled dates.
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWeekShift((value) => value - 1)}
            className="grid size-8 place-items-center rounded-lg bg-panel2 text-mut ring-1 ring-line hover:text-accent"
            aria-label="Previous Amazon week"
          >
            ‹
          </button>
          <span className="rounded-lg bg-panel2 px-3 py-2 text-xs text-fg ring-1 ring-line">
            {compactDate(currentSunday)} – {compactDate(rangeEnd)}
          </span>
          <button
            type="button"
            onClick={() => setWeekShift((value) => value + 1)}
            className="grid size-8 place-items-center rounded-lg bg-panel2 text-mut ring-1 ring-line hover:text-accent"
            aria-label="Next Amazon week"
          >
            ›
          </button>
          {weekShift !== 0 && (
            <button
              type="button"
              onClick={() => setWeekShift(0)}
              className="rounded-lg bg-panel2 px-2.5 py-2 text-xs text-mut ring-1 ring-line hover:text-accent"
            >
              Today
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3" aria-label="Filter drivers by status">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => toggleFilter(filter.value)}
            aria-pressed={statusFilter === filter.value}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] ring-1 transition-colors ${
              statusFilter === filter.value
                ? "bg-accent/15 text-accent ring-accent/50"
                : "bg-panel2 text-mut ring-line hover:text-accent"
            }`}
          >
            <strong className={`num mr-1.5 ${filter.color}`}>{counts[filter.value]}</strong>
            {filter.label}
          </button>
        ))}
        <label className="ml-auto flex min-w-52 flex-1 items-center gap-2 sm:flex-none">
          <span className="sr-only">Search drivers</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search driver name..."
            className="h-8 min-w-0 flex-1 rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line placeholder:text-mut focus:outline-none focus:ring-accent/50 sm:w-56"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[990px]">
          <div className="grid grid-cols-[140px_130px_minmax(480px,1fr)_190px] border-b border-line bg-panel2/60">
            <div className="px-2 py-2 font-mono text-[9px] tracking-[0.12em] text-mut">DRIVER</div>
            <div className="px-2 py-2 font-mono text-[9px] tracking-[0.12em] text-mut">DISPATCH NOTES</div>
            <div className="min-w-[480px] border-x border-line">
              <div className="border-b border-line px-2 py-1 text-center font-mono text-[8px] text-fg">
                AMAZON WEEK · {compactDate(currentSunday)}–{compactDate(rangeEnd)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day, index) => {
                  const date = new Date(`${day}T12:00:00`);
                  return (
                    <div
                      key={day}
                      className={`border-r border-line/70 px-0.5 py-1 text-center font-mono text-[8px] leading-tight ${index % 7 === 0 ? "text-transit" : "text-mut"}`}
                      title={date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    >
                      <span className="block">{["S", "M", "T", "W", "T", "F", "S"][date.getDay()]}</span>
                      {date.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="sticky right-0 z-20 bg-panel2 px-2 py-1.5 font-mono text-[8px] tracking-[0.1em] text-accent shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.9)]">WEEKLY SUMMARY</div>
          </div>

          {visibleDrivers.length === 0 ? (
            <div className="p-8 text-center text-xs text-mut">
              {activeDrivers.length === 0
                ? "No active drivers to show."
                : "No drivers match this status and search."}
            </div>
          ) : (
            <div className="divide-y divide-line/70">
              {visibleDrivers.map((driver) => {
                const category = driverCategory(driver);
                const categoryConfig = dispatchStatuses.find(
                  (item) => item.value === driver.dispatch_status,
                );
                const metric = weekMetrics.get(driver.id) ?? {
                  trips: 0,
                  miles: 0,
                  gross: 0,
                  pay: 0,
                };
                const position = loadsByDriver.get(driver.id) ?? [];
                const avgRate = metric.trips ? metric.gross / metric.trips : 0;
                const avgMile = metric.miles ? metric.gross / metric.miles : 0;
                return (
                  <Fragment key={driver.id}>
                  <div
                    className="grid min-h-[68px] grid-cols-[140px_130px_minmax(480px,1fr)_190px] odd:bg-panel/30 even:bg-panel2/30"
                  >
                    <div className="flex min-w-0 flex-col justify-center px-2 py-1.5">
                      <span className="truncate text-[8px] text-mut">
                        {dispatchers.find((person) => person.id === driver.dispatcher_id)?.full_name
                          ? `Dispatcher · ${dispatchers.find((person) => person.id === driver.dispatcher_id)?.full_name}`
                          : "Dispatcher · Unassigned"}
                      </span>
                      <span className="truncate text-[8px] text-mut">
                        {driver.unit_number ? `Unit ${driver.unit_number}` : "Unit not assigned"}
                      </span>
                      <span className="truncate text-[11px] font-semibold text-fg">{driver.full_name}</span>
                      {canEdit ? (
                        <select
                          value={driver.dispatch_status ?? "no_update"}
                          disabled={savingStatusId === driver.id}
                          onChange={(event) => void changeDriverStatus(driver, event.target.value)}
                          className="mt-1 h-6 w-full min-w-0 rounded-md bg-panel2 px-1.5 text-[9px] text-fg ring-1 ring-line focus:outline-none focus:ring-accent/50 disabled:opacity-60"
                          aria-label={`Change ${driver.full_name} dispatch status`}
                        >
                          {dispatchStatuses.map((status) => (
                            <option key={status.value} value={status.value}>{status.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="rounded-full px-2 py-1 text-[9px] font-semibold"
                          style={{
                            color: categoryConfig?.color ?? "var(--mut)",
                            backgroundColor: `color-mix(in srgb, ${categoryConfig?.color ?? "#64748b"} 16%, transparent)`,
                          }}
                        >
                          {dispatchStatusName(driver.dispatch_status, dispatchStatuses) ||
                            (category === "home" ? "Home" : category === "rest" ? "Rest" : "Other")}
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center px-2 py-2">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => noteDriver?.id === driver.id ? setNoteDriver(null) : openNote(driver)}
                          className="w-full truncate rounded-md border border-dashed border-line bg-panel2/50 px-2 py-1.5 text-left text-[10px] text-mut hover:border-accent/60 hover:text-fg"
                        >
                          {driver.dispatch_note || "Add dispatch note"}
                        </button>
                      ) : (
                        <span className="truncate text-[10px] text-mut">
                          {driver.dispatch_note || "No note"}
                        </span>
                      )}
                    </div>
                    <div className="relative grid min-h-[60px] min-w-[480px] grid-cols-7 grid-rows-1 items-center border-x border-line/80">
                      {days.map((day, index) => (
                        <span
                          key={`${driver.id}-${day}`}
                          className={`row-span-1 h-full border-r border-line/60 ${index === 0 ? "bg-transit/[0.025]" : ""}`}
                          style={{ gridColumn: index + 1, gridRow: 1 }}
                        />
                      ))}
                      {position.map(({ load, start, end }) => (
                        <button
                          key={load.id}
                          type="button"
                          disabled={!canEdit}
                          data-load-trigger
                          onClick={(event) => openLoadMenu(load, event)}
                          title={`${load.load_number} · ${loadStatusLabel(load.status)} · ${load.pickup_location ?? "—"} to ${load.delivery_location ?? "—"}`}
                          className={`z-10 mx-0.5 flex h-6 min-w-0 items-center overflow-hidden rounded px-1 font-mono text-[9px] font-semibold text-ink ${loadTone(load.status)} ${canEdit ? "cursor-pointer hover:brightness-110" : "cursor-default"}`}
                          style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: 1 }}
                        >
                          {load.load_number}
                        </button>
                      ))}
                    </div>
                    <div className="sticky right-0 z-10 flex items-center border-l-2 border-fuchsia-300/60 bg-fuchsia-400/[0.08] px-1.5 py-1 shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.9)]">
                      <div className="grid w-full grid-cols-2 gap-x-1.5 gap-y-0.5 text-[8px]">
                        <Metric label="Trips" value={String(metric.trips)} />
                        <Metric label="Miles" value={metric.miles.toLocaleString()} />
                        <Metric label="Avg rate" value={currency(avgRate)} />
                        <Metric label="Avg / mile" value={currency(avgMile, 2)} />
                        <Metric label="Weekly gross" value={money(metric.gross)} />
                        <div className="col-span-2 flex justify-between gap-1 border-t border-fuchsia-300/20 pt-0.5 font-semibold text-fuchsia-100">
                          <span className="truncate">
                            Driver share
                            {driver.driver_type === "owner_operator" && driver.pay_type === "percentage" && ` · ${Number(driver.pay_rate ?? 0)}%`}
                          </span>
                          <span className="num shrink-0">{money(metric.pay)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {noteDriver?.id === driver.id && (
                    <div className="col-span-full grid grid-cols-[140px_130px_minmax(480px,1fr)_190px] border-t border-accent/30 bg-panel2/70">
                      <div className="px-3 py-3 text-[10px] font-semibold text-fg">Dispatch notes · {driver.full_name}</div>
                      <div className="col-span-3 space-y-2 p-3">
                        {driver.dispatch_note && <div className="rounded-md bg-ink/60 px-3 py-2 text-[11px] text-fg">{driver.dispatch_note}<div className="mt-1 text-[9px] text-mut">Current note</div></div>}
                        <div className="max-h-32 space-y-1 overflow-y-auto">
                          {noteHistory.map((entry) => (
                            <div key={entry.id} className="rounded-md bg-ink/40 px-3 py-2 text-[10px] text-fg">
                              <div>{entry.description.replace(/^Dispatch note (updated:|cleared)/, "").trim() || "Note cleared"}</div>
                              <div className="mt-1 text-[9px] text-mut">
                                {dispatchers.find((person) => person.id === entry.actor_id)?.full_name ?? "Team member"} · {new Date(entry.created_at).toLocaleString()}
                              </div>
                            </div>
                          ))}
                          {noteHistory.length === 0 && !driver.dispatch_note && <div className="text-[10px] text-mut">No previous dispatch notes.</div>}
                        </div>
                        {canEdit && <div className="flex gap-2"><input value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a location or dispatch update..." className="h-8 min-w-0 flex-1 rounded-md bg-ink px-3 text-[10px] text-fg ring-1 ring-line placeholder:text-mut" /><button type="button" disabled={savingNote} onClick={() => void saveNote()} className="rounded-md bg-accent px-3 text-[10px] font-semibold text-ink disabled:opacity-60">{savingNote ? "Saving…" : "Save note"}</button></div>}
                      </div>
                    </div>
                  )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[10px] text-mut">
        <span>
          {visibleDrivers.length} of {activeDrivers.length} active drivers shown
          {statusFilter !== "all" && ` · ${FILTERS.find((item) => item.value === statusFilter)?.label}`}
        </span>
        <span>Weekly totals use loads assigned to the selected Amazon week.</span>
      </div>

      {selectedLoad && loadMenuPoint && canEdit && createPortal(
        <section
          data-load-menu
          aria-label={`Actions for load ${selectedLoad.load_number}`}
          style={{ position: "fixed", top: loadMenuPoint.top, left: loadMenuPoint.left, width: 224 }}
          className="z-[100] rounded-xl bg-panel p-3 shadow-2xl ring-1 ring-line"
        >
          <div className="truncate text-xs font-semibold text-fg">Load {selectedLoad.load_number}</div>
          <div className="mt-0.5 truncate text-[10px] text-mut">
            {selectedLoad.pickup_location ?? "—"} → {selectedLoad.delivery_location ?? "—"}
          </div>
          {!showLoadStatuses ? (
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => void navigate({ to: "/loads", search: { open: selectedLoad.id } })}
                className="rounded-lg bg-panel2 px-3 py-2 text-left text-xs text-fg ring-1 ring-line hover:text-accent"
              >
                See load details
              </button>
              <button
                type="button"
                onClick={() => setShowLoadStatuses(true)}
                className="rounded-lg bg-accent px-3 py-2 text-left text-xs font-semibold text-ink"
              >
                Change load status
              </button>
            </div>
          ) : (
            <label className="mt-3 block font-mono text-[10px] tracking-wider text-mut">
              LOAD STATUS
              <select
                autoFocus
                className="mt-1 h-9 w-full rounded-lg bg-panel2 px-3 font-sans text-xs text-fg ring-1 ring-line"
                value={normalizedLoadStatus(selectedLoad.status)}
                disabled={savingStatusId === selectedLoad.id}
                onChange={(event) => void changeLoadStatus(event.target.value)}
              >
                {LOAD_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => { setSelectedLoad(null); setShowLoadStatuses(false); }}
            className="mt-2 w-full rounded-lg px-3 py-1.5 text-[10px] text-mut hover:text-fg"
          >
            Close
          </button>
        </section>,
        document.body,
      )}

    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-1">
      <span className="truncate text-fuchsia-100/70">{label}</span>
      <span className="num shrink-0 font-medium text-fuchsia-50">{value}</span>
    </div>
  );
}
