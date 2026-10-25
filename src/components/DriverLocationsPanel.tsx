import { useEffect, useState } from "react";
import { Check, Clipboard, MapPin, Pencil, Search, Truck, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivity, logLoadEvent, type Driver, type Load } from "@/hooks/useTms";
import { EmptyRow, Modal, Panel, PanelHeader } from "@/components/ui-kit";
import { StatusPill } from "@/components/StatusPill";
import { ACTIVE_STATUSES, label } from "@/lib/tms";
import { useUserPreference } from "@/hooks/useUserPreference";

const DISPATCH_STATUSES = [
  { value: "ready", text: "Ready" },
  { value: "issue", text: "Issue" },
  { value: "covered", text: "Covered" },
  { value: "prebook", text: "Prebook" },
  { value: "in_transit", text: "In transit" },
  { value: "rest_home", text: "Rest / home" },
  { value: "shop", text: "Shop" },
  { value: "no_update", text: "No update" },
] as const;

const LOAD_RESOLUTIONS = [
  { value: "delivered", text: "Completed" },
  { value: "cancelled", text: "Cancelled" },
  { value: "rejected", text: "Rejected" },
  { value: "upcoming", text: "Upcoming / prebooked" },
] as const;

type LoadResolution = (typeof LOAD_RESOLUTIONS)[number]["value"];
type PendingStatusChange = {
  driver: Driver;
  status: string;
  activeLoads: Load[];
};

function masterStatusForDispatch(driver: Driver, status: string) {
  if (["ready", "covered", "prebook"].includes(status)) return "available";
  if (status === "in_transit") return "on_load";
  if (status === "rest_home") return "home";
  return driver.status;
}

export function DriverLocationsPanel({
  drivers,
  loads,
  canEdit,
  canEditDispatch = false,
  title = "Available drivers",
}: {
  drivers: Driver[];
  loads: Load[];
  canEdit: boolean;
  canEditDispatch?: boolean;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingDispatchId, setSavingDispatchId] = useState<string | null>(null);
  const [completingLoadId, setCompletingLoadId] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<PendingStatusChange | null>(null);
  const [loadResolutions, setLoadResolutions] = useState<Record<string, LoadResolution | "">>({});
  const [tonuDrafts, setTonuDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [selectedDriverId, setSelectedDriverId] = useUserPreference<string | null>(
    "dispatch-selected-driver",
    drivers[0]?.id ?? null,
  );
  const [driverSearch, setDriverSearch] = useUserPreference("dispatch-driver-search", "");

  useEffect(() => {
    if (!selectedDriverId || !drivers.some((driver) => driver.id === selectedDriverId)) {
      setSelectedDriverId(drivers[0]?.id ?? null);
    }
  }, [drivers, selectedDriverId]);

  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId) ?? null;
  const visibleDrivers = drivers.filter((driver) =>
    `${driver.full_name} ${driver.current_location ?? ""} ${driver.unit_number ?? ""}`
      .toLowerCase()
      .includes(driverSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function startEditing(driver: Driver) {
    setEditingId(driver.id);
    setLocationDraft(driver.current_location ?? "");
  }

  async function saveLocation(driver: Driver) {
    const location = locationDraft.trim().slice(0, 500);
    if (!location) {
      toast.error("Enter the driver's city, state or current location.");
      return;
    }
    setSavingId(driver.id);
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("drivers")
      .update({ current_location: location, last_location_update: updatedAt })
      .eq("id", driver.id);
    setSavingId(null);
    if (error) {
      if (error.code === "PGRST204" && error.message.includes("current_location")) {
        toast.error(
          "Driver location fields are missing from Supabase. Apply the latest driver-location migration, then retry.",
        );
      } else {
        toast.error(error.message);
      }
      return;
    }
    await logActivity("driver", driver.id, `Last known location updated to ${location}`);
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    setEditingId(null);
    toast.success(`${driver.full_name}'s location updated`);
  }

  async function copyLocation(location: string) {
    try {
      await navigator.clipboard.writeText(location);
      toast.success("Location copied");
    } catch {
      toast.error("Could not copy location. Select and copy the text instead.");
    }
  }

  async function saveDispatchNote(driver: Driver) {
    const note = noteDraft.trim().slice(0, 500);
    setSavingDispatchId(driver.id);
    const { error } = await supabase
      .from("drivers")
      .update({ dispatch_note: note || null })
      .eq("id", driver.id);
    setSavingDispatchId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity(
      "driver",
      driver.id,
      note ? `Dispatch note updated: ${note}` : "Dispatch note cleared",
    );
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    setNoteEditingId(null);
    toast.success("Dispatch note saved");
  }

  async function changeDispatchStatus(driver: Driver, status: string) {
    setSavingDispatchId(driver.id);
    const driverStatus = masterStatusForDispatch(driver, status);
    const { error } = await supabase
      .from("drivers")
      .update({ dispatch_status: status, status: driverStatus })
      .eq("id", driver.id);
    setSavingDispatchId(null);
    if (error) {
      toast.error(
        error.code === "PGRST204" && error.message.includes("dispatch_status")
          ? "Dispatch status fields are missing from Supabase. Apply the latest Dispatch Board migration, then retry."
          : error.message,
      );
      return;
    }
    const statusLabel =
      DISPATCH_STATUSES.find((item) => item.value === status)?.text ?? label(status);
    await logActivity("driver", driver.id, `Dispatch status changed to ${statusLabel}`);
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    toast.success(`${driver.full_name}: ${statusLabel}`);
  }

  function requestDispatchStatus(driver: Driver, status: string) {
    const activeLoads = loads
      .filter((load) => load.driver_id === driver.id && ACTIVE_STATUSES.includes(load.status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (activeLoads.length && status !== "in_transit" && status !== "no_update") {
      setLoadResolutions(Object.fromEntries(activeLoads.map((load) => [load.id, ""])));
      setPendingStatusChange({ driver, status, activeLoads });
      return;
    }
    void changeDispatchStatus(driver, status);
  }

  async function confirmDispatchStatus() {
    if (!pendingStatusChange) return;
    const { driver, status, activeLoads } = pendingStatusChange;
    const selected = activeLoads.filter((load) => loadResolutions[load.id]);
    if (!selected.length) {
      toast.error("Choose at least one load and its new status before continuing.");
      return;
    }
    const invalidTonu = selected.some((load) => {
      if (loadResolutions[load.id] !== "cancelled") return false;
      const value = tonuDrafts[load.id]?.trim() ?? "";
      return value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0);
    });
    if (invalidTonu) {
      toast.error("Enter a valid TONU amount of $0 or more, or leave it blank.");
      return;
    }

    setSavingDispatchId(driver.id);
    const changed = await Promise.all(
      selected.map(async (load) => {
        const resolution = loadResolutions[load.id] as LoadResolution;
        const tonuAmount = tonuDrafts[load.id]?.trim() ? Number(tonuDrafts[load.id]) : 0;
        const update = await supabase
          .from("loads")
          .update({
            status: resolution,
            ...(resolution === "cancelled" ? { tonu_amount: tonuAmount } : {}),
            ...(resolution === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
          })
          .eq("id", load.id)
          .eq("driver_id", driver.id)
          .in("status", ACTIVE_STATUSES)
          .select("id")
          .maybeSingle();
        return { load, resolution, ...update };
      }),
    );
    const failures = changed.filter((item) => item.error || !item.data);
    if (failures.length) {
      setSavingDispatchId(null);
      await queryClient.invalidateQueries({ queryKey: ["loads"] });
      toast.error(
        `${failures.length} load${failures.length === 1 ? "" : "s"} could not be updated. Refresh the board and review the loads.`,
      );
      return;
    }

    await Promise.all(
      changed.map(({ load, resolution }) =>
        logLoadEvent(load.id, resolution, `Load ${load.load_number} updated from Dispatch Board`),
      ),
    );
    const { error: statusError } = await supabase
      .from("drivers")
      .update({
        dispatch_status: status,
        status: masterStatusForDispatch(driver, status),
      })
      .eq("id", driver.id);
    if (statusError) {
      setSavingDispatchId(null);
      toast.error(
        statusError.code === "PGRST204" && statusError.message.includes("dispatch_status")
          ? "Dispatch status fields are missing from Supabase. Apply the latest Dispatch Board migration, then retry."
          : statusError.message,
      );
      return;
    }

    const terminalChanges = changed.filter(({ resolution }) => resolution !== "upcoming");
    const keepActiveLoadIds = new Set(
      loads.filter((load) => ACTIVE_STATUSES.includes(load.status)).map((load) => load.id),
    );
    changed
      .filter(({ resolution }) => resolution !== "upcoming")
      .forEach(({ load }) => keepActiveLoadIds.delete(load.id));
    const equipmentUpdates = terminalChanges.flatMap(({ load }) => {
      const updates: Array<Promise<{ error: { message: string } | null }>> = [];
      if (
        load.truck_id &&
        !loads.some(
          (item) =>
            item.id !== load.id &&
            keepActiveLoadIds.has(item.id) &&
            item.truck_id === load.truck_id,
        )
      ) {
        updates.push(
          (async () =>
            await supabase
              .from("trucks")
              .update({ status: "available" })
              .eq("id", load.truck_id!))(),
        );
      }
      if (
        load.trailer_id &&
        !loads.some(
          (item) =>
            item.id !== load.id &&
            keepActiveLoadIds.has(item.id) &&
            item.trailer_id === load.trailer_id,
        )
      ) {
        updates.push(
          (async () =>
            await supabase
              .from("trailers")
              .update({ status: "available" })
              .eq("id", load.trailer_id!))(),
        );
      }
      return updates;
    });
    const equipmentResults = await Promise.all(equipmentUpdates);
    await logActivity(
      "driver",
      driver.id,
      `Dispatch status changed to ${DISPATCH_STATUSES.find((item) => item.value === status)?.text ?? label(status)}; ${changed.length} load(s) updated`,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["loads"] }),
      queryClient.invalidateQueries({ queryKey: ["drivers"] }),
      queryClient.invalidateQueries({ queryKey: ["trucks"] }),
      queryClient.invalidateQueries({ queryKey: ["trailers"] }),
    ]);
    setSavingDispatchId(null);
    setPendingStatusChange(null);
    setLoadResolutions({});
    setTonuDrafts({});
    if (equipmentResults.some((result) => result.error)) {
      toast.warning("Driver status and loads updated; review equipment availability.");
    } else {
      toast.success(`${driver.full_name} updated; ${changed.length} load(s) resolved.`);
    }
  }

  async function completeLoad(driver: Driver, load: Load) {
    setCompletingLoadId(load.id);
    const deliveredAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("loads")
      .update({ status: "delivered", delivered_at: deliveredAt })
      .eq("id", load.id)
      .eq("driver_id", driver.id)
      .in("status", ACTIVE_STATUSES)
      .select("id")
      .maybeSingle();
    if (error) {
      setCompletingLoadId(null);
      toast.error(error.message);
      return;
    }
    if (!data) {
      setCompletingLoadId(null);
      await queryClient.invalidateQueries({ queryKey: ["loads"] });
      toast.error("This load is no longer active. The board has been refreshed.");
      return;
    }

    await logLoadEvent(load.id, "delivered", "Load marked delivered from Dispatch Board");
    const driverHasOtherLoads = loads.some(
      (item) =>
        item.id !== load.id &&
        item.driver_id === driver.id &&
        ACTIVE_STATUSES.includes(item.status),
    );
    const resources: Array<Promise<{ error: { message: string } | null }>> = [
      (async () =>
        await supabase
          .from("drivers")
          .update(
            driverHasOtherLoads
              ? { status: "on_load" }
              : { status: "available", dispatch_status: "ready" },
          )
          .eq("id", driver.id))(),
    ];
    if (
      load.truck_id &&
      !loads.some(
        (item) =>
          item.id !== load.id &&
          item.truck_id === load.truck_id &&
          ACTIVE_STATUSES.includes(item.status),
      )
    ) {
      resources.push(
        (async () =>
          await supabase.from("trucks").update({ status: "available" }).eq("id", load.truck_id!))(),
      );
    }
    if (
      load.trailer_id &&
      !loads.some(
        (item) =>
          item.id !== load.id &&
          item.trailer_id === load.trailer_id &&
          ACTIVE_STATUSES.includes(item.status),
      )
    ) {
      resources.push(
        (async () =>
          await supabase
            .from("trailers")
            .update({ status: "available" })
            .eq("id", load.trailer_id!))(),
      );
    }
    const resourceResults = await Promise.all(resources);
    await logActivity(
      "driver",
      driver.id,
      `Load ${load.load_number} completed from Dispatch Board`,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["loads"] }),
      queryClient.invalidateQueries({ queryKey: ["drivers"] }),
      queryClient.invalidateQueries({ queryKey: ["trucks"] }),
      queryClient.invalidateQueries({ queryKey: ["trailers"] }),
    ]);
    setCompletingLoadId(null);
    if (resourceResults.some((result) => result.error)) {
      toast.warning(`${load.load_number} is delivered; review driver or equipment availability.`);
    } else if (driverHasOtherLoads) {
      toast.success(`${load.load_number} marked delivered; other loads remain assigned.`);
    } else {
      toast.success(`${load.load_number} marked delivered; ${driver.full_name} is ready.`);
    }
  }

  return (
    <>
      <Panel className="p-4">
        <PanelHeader title={title} count={`${drivers.length} listed`} />
        <div className="grid gap-3 lg:grid-cols-[minmax(210px,0.75fr)_minmax(0,2fr)]">
          <aside className="overflow-hidden rounded-lg bg-background/55 ring-1 ring-line/70">
            <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
              <Search className="size-3.5 shrink-0 text-mut" aria-hidden="true" />
              <input
                value={driverSearch}
                onChange={(event) => setDriverSearch(event.target.value)}
                placeholder="Find a driver…"
                aria-label="Search drivers"
                className="h-7 min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-mut"
              />
            </div>
            <div className="max-h-[min(62vh,620px)] space-y-1 overflow-y-auto p-1.5">
              {drivers.length === 0 && <EmptyRow text="No active drivers have been added yet." />}
              {visibleDrivers.length === 0 && drivers.length > 0 && (
                <EmptyRow text="No drivers match that search." />
              )}
              {visibleDrivers.map((driver) => {
                const activeCount = loads.filter(
                  (load) => load.driver_id === driver.id && ACTIVE_STATUSES.includes(load.status),
                ).length;
                const isSelected = selectedDriverId === driver.id;
                return (
                  <button
                    key={driver.id}
                    type="button"
                    onClick={() => setSelectedDriverId(driver.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${isSelected ? "bg-accent/12 ring-1 ring-accent/35" : "hover:bg-panel2/70"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-fg">
                        {driver.full_name}
                      </span>
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-mut">
                      <span className="truncate">
                        {driver.current_location || "Location not entered"}
                      </span>
                      <span className="shrink-0 font-mono">{activeCount} loads</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
          <div className="min-w-0 space-y-2">
            {!selectedDriver && drivers.length === 0 && (
              <EmptyRow text="No active drivers have been added yet." />
            )}
            {selectedDriver &&
              [selectedDriver].map((driver) => {
                const location = driver.current_location?.trim() ?? "";
                const editing = editingId === driver.id;
                const activeLoads = loads
                  .filter(
                    (load) => load.driver_id === driver.id && ACTIVE_STATUSES.includes(load.status),
                  )
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                return (
                  <div
                    key={driver.id}
                    className="group/location rounded-lg bg-panel2/65 px-3 py-2 ring-1 ring-line/70"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-fg">
                        {driver.full_name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {driver.unit_number && (
                          <span className="font-mono text-[10px] text-mut">
                            Unit {driver.unit_number}
                          </span>
                        )}
                        <StatusPill status={driver.status} />
                      </span>
                    </div>
                    {editing ? (
                      <form
                        className="mt-2 flex items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveLocation(driver);
                        }}
                      >
                        <label className="sr-only" htmlFor={`driver-location-${driver.id}`}>
                          Current location for {driver.full_name}
                        </label>
                        <input
                          id={`driver-location-${driver.id}`}
                          autoFocus
                          maxLength={500}
                          value={locationDraft}
                          onChange={(event) => setLocationDraft(event.target.value)}
                          placeholder="Enter any location, address, landmark or note"
                          className="h-8 min-w-0 flex-1 rounded-md bg-background px-2 text-xs text-fg ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
                        />
                        <button
                          type="submit"
                          disabled={savingId === driver.id}
                          className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
                          aria-label={`Save location for ${driver.full_name}`}
                          title="Save location"
                        >
                          <Check className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="grid size-8 shrink-0 place-items-center rounded-md text-mut hover:bg-panel hover:text-fg"
                          aria-label="Cancel location edit"
                          title="Cancel"
                        >
                          <X className="size-4" />
                        </button>
                      </form>
                    ) : (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                        <span
                          className={`min-w-0 flex-1 truncate text-[11px] ${location ? "text-fg" : "text-mut"}`}
                        >
                          {location || "Location not entered"}
                        </span>
                        {location && (
                          <button
                            type="button"
                            onClick={() => void copyLocation(location)}
                            className="grid size-7 shrink-0 place-items-center rounded-md text-mut opacity-0 transition-opacity hover:bg-panel hover:text-accent focus-visible:opacity-100 group-hover/location:opacity-100 group-focus-within/location:opacity-100 [@media(hover:none)]:opacity-100"
                            aria-label={`Copy ${driver.full_name}'s location`}
                            title="Copy location"
                          >
                            <Clipboard className="size-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => startEditing(driver)}
                            className="grid size-7 shrink-0 place-items-center rounded-md text-mut opacity-0 transition-opacity hover:bg-panel hover:text-accent focus-visible:opacity-100 group-hover/location:opacity-100 group-focus-within/location:opacity-100 [@media(hover:none)]:opacity-100"
                            aria-label={`Edit ${driver.full_name}'s location`}
                            title="Edit location"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="mt-0.5 pl-5 font-mono text-[10px] text-mut" aria-live="polite">
                      {location
                        ? formatLocationAge(driver.last_location_update, now)
                        : "No location update yet"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-mut">
                        <Truck className="size-3.5 text-accent" aria-hidden="true" />
                        {activeLoads.length === 0
                          ? "NO ACTIVE LOADS"
                          : `${activeLoads.length} ACTIVE LOAD${activeLoads.length === 1 ? "" : "S"}`}
                      </span>
                    </div>
                    {activeLoads.map((load) => (
                      <div
                        key={load.id}
                        className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-background/65 px-2 py-1.5"
                      >
                        <span className="font-mono text-[10px] font-medium text-fg">
                          ON LOAD · {load.load_number}
                        </span>
                        <StatusPill status={load.status} />
                        {canEditDispatch && (
                          <button
                            type="button"
                            disabled={completingLoadId === load.id}
                            onClick={() => void completeLoad(driver, load)}
                            className="ml-auto rounded-md bg-delivered/12 px-2.5 py-1 text-[10px] font-medium text-delivered ring-1 ring-delivered/25 hover:bg-delivered/20 disabled:opacity-50"
                          >
                            {completingLoadId === load.id ? "Completing…" : "Complete load"}
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-mut">
                        Dispatch status
                      </span>
                      {canEditDispatch ? (
                        <select
                          value={driver.dispatch_status ?? "no_update"}
                          disabled={savingDispatchId === driver.id}
                          onChange={(event) => requestDispatchStatus(driver, event.target.value)}
                          aria-label={`Dispatch status for ${driver.full_name}`}
                          className="h-7 max-w-full rounded-md bg-background px-2 text-[11px] text-fg ring-1 ring-line focus:ring-accent/40 focus:outline-none disabled:opacity-50"
                        >
                          {DISPATCH_STATUSES.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.text}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[11px] text-fg">
                          {DISPATCH_STATUSES.find(
                            (status) => status.value === driver.dispatch_status,
                          )?.text ?? "No update"}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex min-w-0 items-start gap-2">
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-mut">
                        Dispatch note
                      </span>
                      {noteEditingId === driver.id && canEditDispatch ? (
                        <form
                          className="flex min-w-0 flex-1 items-center gap-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveDispatchNote(driver);
                          }}
                        >
                          <label className="sr-only" htmlFor={`driver-dispatch-note-${driver.id}`}>
                            Dispatch note for {driver.full_name}
                          </label>
                          <input
                            id={`driver-dispatch-note-${driver.id}`}
                            autoFocus
                            maxLength={500}
                            value={noteDraft}
                            onChange={(event) => setNoteDraft(event.target.value)}
                            placeholder="Add a dispatch note"
                            className="h-7 min-w-0 flex-1 rounded-md bg-background px-2 text-[11px] text-fg ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
                          />
                          <button
                            type="submit"
                            disabled={savingDispatchId === driver.id}
                            className="grid size-7 shrink-0 place-items-center rounded-md bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
                            aria-label={`Save dispatch note for ${driver.full_name}`}
                            title="Save dispatch note"
                          >
                            <Check className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setNoteEditingId(null)}
                            className="grid size-7 shrink-0 place-items-center rounded-md text-mut hover:bg-panel hover:text-fg"
                            aria-label="Cancel dispatch note edit"
                            title="Cancel"
                          >
                            <X className="size-3.5" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <span
                            className={`min-w-0 flex-1 text-[11px] ${driver.dispatch_note ? "text-fg" : "text-mut"}`}
                          >
                            {driver.dispatch_note || "No note"}
                          </span>
                          {canEditDispatch && (
                            <button
                              type="button"
                              onClick={() => {
                                setNoteDraft(driver.dispatch_note ?? "");
                                setNoteEditingId(driver.id);
                              }}
                              className="grid size-7 shrink-0 place-items-center rounded-md text-mut opacity-0 transition-opacity hover:bg-panel hover:text-accent focus-visible:opacity-100 group-hover/location:opacity-100 group-focus-within/location:opacity-100 [@media(hover:none)]:opacity-100"
                              aria-label={`${driver.dispatch_note ? "Edit" : "Add"} dispatch note for ${driver.full_name}`}
                              title={
                                driver.dispatch_note ? "Edit dispatch note" : "Add dispatch note"
                              }
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </Panel>
      {pendingStatusChange && (
        <Modal
          title={`Update ${pendingStatusChange.driver.full_name} and their loads`}
          onClose={() => {
            if (savingDispatchId !== pendingStatusChange.driver.id) setPendingStatusChange(null);
          }}
          wide
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-transit/10 p-3 text-xs text-fg ring-1 ring-transit/25">
              <p className="font-medium">
                Set driver status to{" "}
                {DISPATCH_STATUSES.find((item) => item.value === pendingStatusChange.status)
                  ?.text ?? label(pendingStatusChange.status)}
              </p>
              <p className="mt-1 text-mut">
                Choose a new status for each load you want to change. Loads left as “Keep current”
                stay assigned to this driver. For a prebook, choose “Upcoming / prebooked.”
              </p>
            </div>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto">
              {pendingStatusChange.activeLoads.map((load) => (
                <div
                  key={load.id}
                  className="grid gap-2 rounded-lg bg-panel2 p-3 ring-1 ring-line sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg">
                      <span>{load.load_number}</span>
                      <StatusPill status={load.status} />
                    </div>
                    <p className="mt-1 truncate text-[11px] text-mut">
                      {load.pickup_location || "Pickup not entered"} →{" "}
                      {load.delivery_location || "Delivery not entered"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block space-y-1 text-[10px] text-mut">
                      <span>New load status</span>
                      <select
                        value={loadResolutions[load.id] ?? ""}
                        disabled={savingDispatchId === pendingStatusChange.driver.id}
                        onChange={(event) =>
                          setLoadResolutions((current) => ({
                            ...current,
                            [load.id]: event.target.value as LoadResolution | "",
                          }))
                        }
                        className="h-9 w-full rounded-md bg-background px-2 text-xs text-fg ring-1 ring-line focus:ring-accent/40 focus:outline-none"
                        aria-label={`New status for load ${load.load_number}`}
                      >
                        <option value="">Keep current</option>
                        {LOAD_RESOLUTIONS.map((resolution) => (
                          <option key={resolution.value} value={resolution.value}>
                            {resolution.text}
                          </option>
                        ))}
                      </select>
                    </label>
                    {loadResolutions[load.id] === "cancelled" && (
                      <label className="block space-y-1 text-[10px] text-mut">
                        <span>TONU amount · USD · optional</span>
                        <div className="flex items-center gap-1 rounded-md bg-background px-2 ring-1 ring-line focus-within:ring-accent/40">
                          <span>$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={tonuDrafts[load.id] ?? ""}
                            disabled={savingDispatchId === pendingStatusChange.driver.id}
                            onChange={(event) =>
                              setTonuDrafts((current) => ({
                                ...current,
                                [load.id]: event.target.value,
                              }))
                            }
                            aria-label={`TONU amount for cancelled load ${load.load_number}`}
                            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-mut"
                          />
                        </div>
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-[11px] text-mut">
                {Object.values(loadResolutions).filter(Boolean).length} load(s) selected · The
                status change is saved after load updates succeed.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={savingDispatchId === pendingStatusChange.driver.id}
                  onClick={() => setPendingStatusChange(null)}
                  className="rounded-lg bg-panel2 px-3 py-2 text-xs text-mut ring-1 ring-line hover:text-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    savingDispatchId === pendingStatusChange.driver.id ||
                    !Object.values(loadResolutions).some(Boolean)
                  }
                  onClick={() => void confirmDispatchStatus()}
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {savingDispatchId === pendingStatusChange.driver.id
                    ? "Updating…"
                    : "Confirm status & loads"}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function formatLocationAge(timestamp: string | null, now: number) {
  if (!timestamp) return "Update time unknown";
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 60_000));
  if (elapsedMinutes === 0) return "Updated just now";
  if (elapsedMinutes === 1) return "Updated 1 minute ago";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes} minutes ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours === 1) return "Updated 1 hour ago";
  if (hours < 24) return `Updated ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Updated 1 day ago" : `Updated ${days} days ago`;
}
