import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/StatusPill";
import {
  EmptyRow,
  GhostButton,
  Modal,
  Panel,
  PanelHeader,
  PrimaryButton,
  SelectInput,
  TextInput,
} from "@/components/ui-kit";
import {
  useBrokers,
  useDrivers,
  useLoadEvents,
  useAllLoads,
  useTrailers,
  useTrucks,
  useProfiles,
  logLoadEvent,
  type Load,
  type Driver,
  type Profile,
} from "@/hooks/useTms";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadExtras } from "@/components/load-extras";
import { TemplatesModal, templateToForm } from "@/components/load-templates";
import {
  ACTIVE_STATUSES,
  LOAD_STATUSES,
  label,
  loadRevenue,
  money,
  rpm,
  safetyIssues,
} from "@/lib/tms";
import { parseAmazonLoad } from "@/lib/amazon-parse";
import { useServerFn } from "@tanstack/react-start";
import { scanLoadFile } from "@/lib/load-scan.functions";
import {
  AMAZON_FACILITIES,
  facilityMiles,
  findFacility,
  isAmazonLoadId,
} from "@/lib/amazon-facilities";

export const Route = createFileRoute("/_authenticated/loads")({
  validateSearch: (search: Record<string, unknown>): { open?: string } => {
    const open = search["open"];
    return typeof open === "string" ? { open } : {};
  },
  head: () => ({
    meta: [
      { title: "Load board · Vantera TMS" },
      { name: "description", content: "Every load, its status, assignment and rate in one board." },
      { property: "og:title", content: "Load board · Vantera TMS" },
      {
        property: "og:description",
        content: "Every load, its status, assignment and rate in one board.",
      },
    ],
  }),
  component: LoadBoard,
});

const FILTERS = [
  { key: "all", text: "All" },
  { key: "active", text: "Active" },
  { key: "in_transit", text: "In transit" },
  { key: "delivered", text: "Delivered" },
  { key: "problem", text: "Problem" },
  { key: "deleted", text: "Deleted" },
] as const;

type DateFilter = "amazon_week" | "day" | "all";
type LoadSort = "newest" | "oldest";

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekStartKey(date: Date) {
  const sunday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return dayKey(sunday);
}

function addDaysToKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const LOAD_BACKUP_COLUMNS = [
  "id",
  "load_number",
  "status",
  "driver_id",
  "dispatcher_id",
  "broker_id",
  "customer_name",
  "shipper",
  "consignee",
  "pickup_location",
  "pickup_address",
  "pickup_date",
  "pickup_time",
  "pickup_eta",
  "pickup_arrived_at",
  "pickup_departed_at",
  "delivery_location",
  "delivery_address",
  "delivery_date",
  "delivery_time",
  "delivery_eta",
  "delivery_arrived_at",
  "delivery_departed_at",
  "commodity",
  "weight",
  "pieces",
  "equipment_type",
  "truck_id",
  "trailer_id",
  "miles",
  "deadhead_miles",
  "rate",
  "fuel_surcharge",
  "detention",
  "layover",
  "other_charges",
  "driver_pay",
  "cut",
  "tonu_amount",
  "invoice_number",
  "invoice_date",
  "paid_date",
  "delivered_at",
  "current_location",
  "last_location_update",
  "eta",
  "next_update_at",
  "is_problem",
  "problem_note",
  "special_instructions",
  "notes",
  "created_by",
  "created_at",
  "updated_at",
  "deleted_at",
  "deleted_by",
] as const;

const LOAD_NUMBER_COLUMNS = new Set([
  "weight",
  "pieces",
  "miles",
  "deadhead_miles",
  "rate",
  "fuel_surcharge",
  "detention",
  "layover",
  "other_charges",
  "driver_pay",
  "cut",
  "tonu_amount",
]);
const LOAD_BOOLEAN_COLUMNS = new Set(["is_problem"]);

function LoadBoard() {
  const { open } = Route.useSearch();
  const { data: allLoads = [], isLoading } = useAllLoads();
  const loads = useMemo(() => allLoads.filter((l) => !l.deleted_at), [allLoads]);
  const deletedLoads = useMemo(() => allLoads.filter((l) => l.deleted_at), [allLoads]);
  const { data: drivers = [] } = useDrivers();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { data: brokers = [] } = useBrokers();
  const { data: profiles = [] } = useProfiles();
  const dispatchStaff = profiles.filter((p) => p.is_active);
  const { data: me } = useCurrentUser();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [driverFilter, setDriverFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("amazon_week");
  const [weekStart, setWeekStart] = useState(() => weekStartKey(new Date()));
  const [dayFilter, setDayFilter] = useState(() => dayKey(new Date()));
  const [loadSort, setLoadSort] = useState<LoadSort>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editing, setEditing] = useState<Load | null>(null);
  const [imported, setImported] = useState<Partial<LoadForm> | undefined>(undefined);
  const [pendingCancellation, setPendingCancellation] = useState<Load | null>(null);
  const [tonuDraft, setTonuDraft] = useState("");
  const [cancellingLoad, setCancellingLoad] = useState(false);

  useEffect(() => {
    // Deep links should initialize the drawer once per URL change. Reapplying `open` every
    // time loads refresh would switch away from the load the user is editing or assigning.
    if (open) setSelectedId(open);
  }, [open]);

  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.full_name ?? "—";
  const dispatcherName = (id: string | null) => {
    const person = profiles.find((p) => p.id === id);
    return person?.full_name ?? person?.email ?? "—";
  };
  const truckNumber = (id: string | null) => trucks.find((t) => t.id === id)?.truck_number ?? "—";
  const trailerNumber = (id: string | null) =>
    trailers.find((t) => t.id === id)?.trailer_number ?? "—";

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (filter === "deleted" ? deletedLoads : loads)
      .filter((l) => {
        if (filter === "active" && !ACTIVE_STATUSES.includes(l.status)) return false;
        if (filter === "in_transit" && l.status !== "in_transit") return false;
        if (filter === "delivered" && !["delivered", "pod_received", "paid"].includes(l.status))
          return false;
        if (filter === "problem" && !l.is_problem && l.status !== "problem") return false;
        if (driverFilter !== "all" && l.driver_id !== driverFilter) return false;
        const loadDay = (l.pickup_date ?? l.created_at).slice(0, 10);
        if (
          dateFilter === "amazon_week" &&
          (loadDay < weekStart || loadDay > addDaysToKey(weekStart, 6))
        )
          return false;
        if (dateFilter === "day" && loadDay !== dayFilter) return false;
        if (!q) return true;
        return [l.load_number, l.pickup_location, l.delivery_location, l.customer_name, l.commodity]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const aDate = (a.pickup_date ?? a.created_at).slice(0, 10);
        const bDate = (b.pickup_date ?? b.created_at).slice(0, 10);
        return loadSort === "newest" ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
      });
  }, [
    loads,
    deletedLoads,
    filter,
    search,
    driverFilter,
    dateFilter,
    weekStart,
    dayFilter,
    loadSort,
  ]);

  const selected = allLoads.find((l) => l.id === selectedId) ?? null;

  function exportCsv(backupAll = false) {
    const exportRows = backupAll ? allLoads : rows;
    if (!exportRows.length) return void toast.error("There are no loads to export");
    const columns = LOAD_BACKUP_COLUMNS.filter((column) => allLoads.some((load) => column in load));
    const body = [
      columns,
      ...exportRows.map((load) =>
        columns.map((column) => {
          const value = load[column as keyof Load];
          return value == null ? "\\N" : String(value);
        }),
      ),
    ]
      .map((record) => record.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vantera-loads-${backupAll ? "full-backup" : "filtered"}-${dayKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function updateStatus(load: Load, status: string) {
    if (status === "cancelled") {
      setTonuDraft(load.tonu_amount ? String(load.tonu_amount) : "");
      setPendingCancellation(load);
      return;
    }
    const { error } = await supabase
      .from("loads")
      .update({ status, is_problem: status === "problem" })
      .eq("id", load.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logLoadEvent(load.id, "status_change", `Status set to ${label(status)}`);
    queryClient.invalidateQueries({ queryKey: ["loads"] });
    queryClient.invalidateQueries({ queryKey: ["load-events", load.id] });
    toast.success(`${load.load_number} → ${label(status)}`);
  }

  async function confirmCancellation() {
    if (!pendingCancellation) return;
    const amount = tonuDraft.trim() ? Number(tonuDraft) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Enter a valid TONU amount of $0 or more, or leave it blank.");
      return;
    }
    setCancellingLoad(true);
    const { error } = await supabase
      .from("loads")
      .update({ status: "cancelled", tonu_amount: amount, is_problem: false })
      .eq("id", pendingCancellation.id);
    setCancellingLoad(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logLoadEvent(
      pendingCancellation.id,
      "cancelled",
      amount > 0 ? `Load cancelled · TONU ${money(amount)}` : "Load cancelled · no TONU",
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["loads"] }),
      queryClient.invalidateQueries({ queryKey: ["load-events", pendingCancellation.id] }),
      queryClient.invalidateQueries({ queryKey: ["loads", "all"] }),
    ]);
    toast.success(
      amount > 0
        ? `${pendingCancellation.load_number} cancelled · TONU ${money(amount)}`
        : `${pendingCancellation.load_number} cancelled with no TONU`,
    );
    setPendingCancellation(null);
    setTonuDraft("");
  }

  async function assignDriver(load: Load, driverId: string | null) {
    const driver = drivers.find((d) => d.id === driverId);
    let safetyWarning = "";
    if (driver) {
      const issues = safetyIssues(driver);
      if (issues.length) {
        safetyWarning = issues.join(", ");
      }
    }
    const patch: Partial<Load> = { driver_id: driverId };
    if (driver && ["new", "available", "booked"].includes(load.status)) patch.status = "assigned";
    if (driver && !load.truck_id) {
      const t = trucks.find((tr) => tr.assigned_driver_id === driver.id);
      if (t) patch.truck_id = t.id;
    }
    const { error } = await supabase.from("loads").update(patch).eq("id", load.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (driver)
      await supabase
        .from("drivers")
        .update({ status: "on_load", dispatch_status: "in_transit" })
        .eq("id", driver.id);
    if (load.driver_id && load.driver_id !== driverId) {
      const formerDriverHasOtherLoads = loads.some(
        (item) =>
          item.id !== load.id &&
          item.driver_id === load.driver_id &&
          ACTIVE_STATUSES.includes(item.status),
      );
      if (!formerDriverHasOtherLoads) {
        await supabase
          .from("drivers")
          .update({ status: "available", dispatch_status: "ready" })
          .eq("id", load.driver_id);
      }
    }
    await logLoadEvent(
      load.id,
      "assigned",
      driver ? `Driver ${driver.full_name} assigned` : "Driver removed",
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["loads"] }),
      queryClient.invalidateQueries({ queryKey: ["drivers"] }),
      queryClient.invalidateQueries({ queryKey: ["load-events", load.id] }),
    ]);
    if (driver && safetyWarning)
      toast.warning(
        `${driver.full_name} assigned to ${load.load_number} with safety warning: ${safetyWarning}`,
      );
    else
      toast.success(
        driver ? `${driver.full_name} assigned to ${load.load_number}` : "Driver removed",
      );
  }

  async function assignDispatcher(load: Load, dispatcherId: string | null) {
    const { error } = await supabase
      .from("loads")
      .update({ dispatcher_id: dispatcherId })
      .eq("id", load.id);
    if (error) return void toast.error(error.message);
    const staffer = profiles.find((p) => p.id === dispatcherId);
    await logLoadEvent(
      load.id,
      "dispatcher_assigned",
      staffer
        ? `Dispatch assigned to ${staffer.full_name ?? staffer.email}`
        : "Dispatch assignment removed",
    );
    await queryClient.invalidateQueries({ queryKey: ["loads"] });
    await queryClient.invalidateQueries({ queryKey: ["load-events", load.id] });
    toast.success(
      staffer
        ? `Dispatch assigned to ${staffer.full_name ?? staffer.email}`
        : "Dispatch assignment removed",
    );
  }

  async function deleteLoad(load: Load) {
    if (!confirm(`Delete load ${load.load_number}? It will move to the Deleted tab.`)) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("loads")
      .update({ deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null })
      .eq("id", load.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logLoadEvent(load.id, "deleted", "Load deleted");
    queryClient.invalidateQueries({ queryKey: ["loads"] });
    queryClient.invalidateQueries({ queryKey: ["load-events", load.id] });
    setSelectedId(null);
    toast.success(`${load.load_number} moved to Deleted`);
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-4">
        <Panel>
          <PanelHeader title="Load board" count={`${rows.length} of ${loads.length} loads`}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search loads, cities, customers…"
              className="h-8 w-full min-w-0 rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none sm:w-64"
            />
            <GhostButton onClick={() => exportCsv()}>Export filtered</GhostButton>
            <GhostButton onClick={() => exportCsv(true)}>Backup all loads</GhostButton>
            {me?.canWrite && (
              <GhostButton onClick={() => setImporting(true)}>Import / CSV</GhostButton>
            )}
            {me?.canWrite && (
              <GhostButton onClick={() => setTemplatesOpen(true)}>Templates</GhostButton>
            )}
            {me?.canWrite && (
              <PrimaryButton
                onClick={() => {
                  setImported(undefined);
                  setCreating(true);
                }}
              >
                + New load
              </PrimaryButton>
            )}
          </PanelHeader>

          <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-4 py-2">
            {FILTERS.map((f) => (
              <GhostButton key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.text}
              </GhostButton>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 border-b border-line bg-panel2/40 px-4 py-3">
            <label className="min-w-44 flex-1 sm:flex-none">
              <span className="font-mono text-[9px] tracking-[0.12em] text-mut uppercase">
                Driver
              </span>
              <select
                value={driverFilter}
                onChange={(event) => setDriverFilter(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line focus:outline-none sm:w-52"
              >
                <option value="all">All drivers</option>
                {drivers
                  .slice()
                  .sort((a, b) => a.full_name.localeCompare(b.full_name))
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.full_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="min-w-36 flex-1 sm:flex-none">
              <span className="font-mono text-[9px] tracking-[0.12em] text-mut uppercase">
                Date filter
              </span>
              <select
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value as DateFilter)}
                className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line focus:outline-none sm:w-40"
              >
                <option value="amazon_week">Amazon Relay week</option>
                <option value="day">Exact day</option>
                <option value="all">All dates</option>
              </select>
            </label>
            {dateFilter === "amazon_week" && (
              <div className="flex h-9 items-center gap-2 rounded-lg bg-ink px-1.5 ring-1 ring-line">
                <button
                  type="button"
                  onClick={() => setWeekStart((week) => addDaysToKey(week, -7))}
                  aria-label="Previous Amazon Relay week"
                  className="grid h-7 w-7 place-items-center rounded-md text-mut hover:bg-panel2 hover:text-fg"
                >
                  ‹
                </button>
                <span className="min-w-28 text-center text-xs text-fg">
                  {displayDate(weekStart)} – {displayDate(addDaysToKey(weekStart, 6))}
                </span>
                <button
                  type="button"
                  onClick={() => setWeekStart((week) => addDaysToKey(week, 7))}
                  aria-label="Next Amazon Relay week"
                  className="grid h-7 w-7 place-items-center rounded-md text-mut hover:bg-panel2 hover:text-fg"
                >
                  ›
                </button>
              </div>
            )}
            {dateFilter === "day" && (
              <input
                aria-label="Exact load date"
                type="date"
                value={dayFilter}
                onChange={(event) => setDayFilter(event.target.value)}
                className="h-9 rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line focus:outline-none"
              />
            )}
            <label className="min-w-36 flex-1 sm:ml-auto sm:flex-none">
              <span className="font-mono text-[9px] tracking-[0.12em] text-mut uppercase">
                Sort by date
              </span>
              <select
                value={loadSort}
                onChange={(event) => setLoadSort(event.target.value as LoadSort)}
                className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line focus:outline-none sm:w-44"
              >
                <option value="newest">Newest pickup first</option>
                <option value="oldest">Oldest pickup first</option>
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <div className="grid h-9 min-w-[1040px] grid-cols-[100px_1.2fr_90px_100px_110px_115px_70px_75px_95px_100px] items-center gap-2 border-b border-line px-4 font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
              <span>Ref</span>
              <span>Origin → Dest</span>
              <span>Date</span>
              <span>Truck / Trail</span>
              <span>Driver</span>
              <span>Dispatch</span>
              <span>Miles</span>
              <span>CUT</span>
              <span>Revenue</span>
              <span>Status</span>
            </div>

            <div className="min-w-[1040px] divide-y divide-line">
              {isLoading && <EmptyRow text="Loading loads…" />}
              {!isLoading && rows.length === 0 && (
                <EmptyRow text="No loads match this view. Create one to get started." />
              )}
              {rows.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className={`grid h-11 w-full grid-cols-[100px_1.2fr_90px_100px_110px_115px_70px_75px_95px_100px] items-center gap-2 px-4 text-left hover:bg-panel2 ${
                    selectedId === l.id ? "bg-panel2" : ""
                  }`}
                >
                  <span className="font-mono text-xs text-fg">{l.load_number}</span>
                  <span className="truncate text-fg">
                    {l.pickup_location ?? "—"} → {l.delivery_location ?? "—"}
                  </span>
                  <span className="num font-mono text-[10px] text-mut">
                    {(l.pickup_date ?? l.created_at).slice(0, 10)}
                  </span>
                  <span className="num truncate font-mono text-xs text-mut">
                    {truckNumber(l.truck_id)} / {trailerNumber(l.trailer_id)}
                  </span>
                  <span className="truncate text-mut">{driverName(l.driver_id)}</span>
                  <span className="truncate text-mut">{dispatcherName(l.dispatcher_id)}</span>
                  <span className="num font-mono text-xs text-mut">{l.miles ?? "—"}</span>
                  <span className="num font-mono text-xs text-transit">{money(l.cut)}</span>
                  <span className="num font-mono text-xs text-mut">{money(loadRevenue(l))}</span>
                  {l.deleted_at ? (
                    <span className="font-mono text-[10px] text-destructive uppercase">
                      Deleted
                    </span>
                  ) : (
                    <StatusPill status={l.is_problem ? "problem" : l.status} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {selected && (
        <LoadDrawer
          key={selected.id}
          load={selected}
          onClose={() => setSelectedId(null)}
          driverName={driverName(selected.driver_id)}
          truck={truckNumber(selected.truck_id)}
          trailer={trailerNumber(selected.trailer_id)}
          canWrite={Boolean(me?.canWrite)}
          onStatus={(s) => updateStatus(selected, s)}
          onDelete={() => deleteLoad(selected)}
          onEdit={() => setEditing(selected)}
          drivers={drivers}
          dispatchers={dispatchStaff}
          dispatcherName={dispatcherName(selected.dispatcher_id)}
          onAssignDriver={(id) => assignDriver(selected, id)}
          onAssignDispatcher={(id) => assignDispatcher(selected, id)}
        />
      )}

      {templatesOpen && (
        <TemplatesModal
          canWrite={!!me?.canWrite}
          onClose={() => setTemplatesOpen(false)}
          onUse={(t) => {
            setTemplatesOpen(false);
            setImported(templateToForm(t));
            setCreating(true);
          }}
        />
      )}
      {importing && (
        <ImportModal
          brokers={brokers}
          onClose={() => setImporting(false)}
          onParsed={(init) => {
            setImporting(false);
            setImported(init);
            setCreating(true);
          }}
        />
      )}

      {editing && (
        <NewLoadModal
          key={editing.id}
          brokers={brokers}
          drivers={drivers}
          dispatchers={dispatchStaff}
          existing={editing}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["loads"] });
            queryClient.invalidateQueries({ queryKey: ["load-events", editing.id] });
          }}
        />
      )}

      {creating && (
        <NewLoadModal
          brokers={brokers}
          drivers={drivers}
          dispatchers={dispatchStaff}
          initial={imported}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: ["loads"] });
          }}
        />
      )}
      {pendingCancellation && (
        <Modal
          title={`Cancel load ${pendingCancellation.load_number}?`}
          onClose={() => {
            if (!cancellingLoad) setPendingCancellation(null);
          }}
        >
          <div className="space-y-4">
            <p className="text-xs text-mut">
              Enter the TONU paid for this cancellation, or leave it blank if no TONU is paid.
            </p>
            <label className="block text-xs font-medium text-fg" htmlFor="load-cancel-tonu">
              TONU amount · USD · optional
              <div className="mt-1 flex items-center gap-2 rounded-lg bg-ink px-3 ring-1 ring-line focus-within:ring-accent/50">
                <span className="text-mut">$</span>
                <input
                  id="load-cancel-tonu"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={tonuDraft}
                  onChange={(event) => setTonuDraft(event.target.value)}
                  placeholder="0.00"
                  disabled={cancellingLoad}
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-mut"
                />
              </div>
            </label>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                disabled={cancellingLoad}
                onClick={() => setPendingCancellation(null)}
                className="h-8 rounded-lg bg-panel2 px-2.5 text-xs text-mut ring-1 ring-line hover:text-fg disabled:opacity-50"
              >
                Keep load
              </button>
              <PrimaryButton disabled={cancellingLoad} onClick={() => void confirmCancellation()}>
                {cancellingLoad ? "Cancelling…" : "Confirm cancellation"}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LoadDrawer({
  load,
  onClose,
  driverName,
  truck,
  trailer,
  canWrite,
  onStatus,
  onDelete,
  onEdit,
  drivers,
  dispatchers,
  dispatcherName,
  onAssignDriver,
  onAssignDispatcher,
}: {
  load: Load;
  onClose: () => void;
  driverName: string;
  truck: string;
  trailer: string;
  canWrite: boolean;
  onStatus: (status: string) => void;
  onDelete: () => void;
  onEdit: () => void;
  drivers: Driver[];
  dispatchers: Profile[];
  dispatcherName: string;
  onAssignDriver: (driverId: string | null) => void;
  onAssignDispatcher: (dispatcherId: string | null) => void;
}) {
  const { data: events = [] } = useLoadEvents(load.id);

  return (
    <aside className="drawer-in sticky top-2 flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-96 max-w-[calc(100vw-1rem)] shrink-0 flex-col overflow-hidden rounded-xl bg-panel ring-1 ring-line shadow-2xl shadow-black/20">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="font-mono text-xs text-mut">{load.load_number}</span>
        <StatusPill status={load.is_problem ? "problem" : load.status} />
        <button onClick={onClose} className="ml-auto font-mono text-xs text-mut hover:text-fg">
          ESC
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        <div>
          <div className="font-display text-lg font-semibold tracking-tight text-fg">
            {load.pickup_location ?? "—"} → {load.delivery_location ?? "—"}
          </div>
          <div className="mt-1 font-mono text-[11px] text-mut">
            {load.customer_name ?? "No customer"} · {load.equipment_type ?? "—"} ·{" "}
            {money(loadRevenue(load))} · {rpm(load).toFixed(2)}/mi
          </div>
        </div>

        {canWrite && !load.deleted_at && (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => onStatus("booked")}
              disabled={load.status === "booked"}
              className="rounded-lg bg-accent/12 px-3 py-2.5 text-xs font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20 disabled:opacity-50"
            >
              {load.status === "booked" ? "Upcoming ✓" : "Mark upcoming"}
            </button>
            <button
              onClick={() => onStatus("in_transit")}
              disabled={load.status === "in_transit"}
              className="rounded-lg bg-transit/12 px-3 py-2.5 text-xs font-semibold text-transit ring-1 ring-transit/30 hover:bg-transit/20 disabled:opacity-50"
            >
              {load.status === "in_transit" ? "In transit ✓" : "Mark in transit"}
            </button>
            <button
              onClick={() => onStatus("delivered")}
              disabled={load.status === "delivered"}
              className="rounded-lg bg-delivered/12 px-3 py-2.5 text-xs font-semibold text-delivered ring-1 ring-delivered/30 hover:bg-delivered/20 disabled:opacity-50"
            >
              {load.status === "delivered" ? "Delivered ✓" : "Mark delivered"}
            </button>
          </div>
        )}

        <Section title="Assignment">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-panel2 p-3 text-xs ring-1 ring-line">
            <Cell label="Truck" value={truck} mono />
            <Cell label="Trailer" value={trailer} mono />
            <Cell label="Driver" value={driverName} />
            <Cell label="Miles" value={load.miles ? String(load.miles) : "—"} mono />
          </div>
          {canWrite && !load.deleted_at && (
            <DriverAssign load={load} drivers={drivers} onAssign={onAssignDriver} />
          )}
        </Section>

        <Section title="Dispatch assignment">
          <div className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
            <Cell label="Assigned dispatch" value={dispatcherName} />
            {canWrite && !load.deleted_at && (
              <DispatcherAssign
                currentId={load.dispatcher_id}
                staff={dispatchers}
                onAssign={onAssignDispatcher}
              />
            )}
          </div>
        </Section>

        <Section title="Tracking">
          <div className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-fg">{load.current_location ?? "No location update"}</span>
              <span className="num font-mono text-mut">
                {load.eta ? new Date(load.eta).toLocaleString() : "no ETA"}
              </span>
            </div>
            <div className="num font-mono text-[10px] text-mut">
              Last update{" "}
              {load.last_location_update
                ? new Date(load.last_location_update).toLocaleString()
                : "—"}
            </div>
          </div>
        </Section>

        <Section title="Charges">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-panel2 p-3 text-xs ring-1 ring-line">
            <Cell label="Line haul" value={money(load.rate)} mono />
            <Cell label="Fuel surcharge" value={money(load.fuel_surcharge)} mono />
            <Cell label="Detention" value={money(load.detention)} mono />
            <Cell label="Layover" value={money(load.layover)} mono />
            <Cell label="Other" value={money(load.other_charges)} mono />
            <Cell label="CUT · company profit" value={money(load.cut)} mono />
            <Cell label="Driver pay" value={money(load.driver_pay)} mono />
            {(load.status === "cancelled" || load.tonu_amount > 0) && (
              <Cell label="TONU · cancellation" value={money(load.tonu_amount)} mono />
            )}
          </div>
        </Section>

        <LoadExtras load={load} canWrite={canWrite && !load.deleted_at} />

        {load.deleted_at && (
          <div className="rounded-lg bg-panel2 p-3 text-xs text-mut ring-1 ring-line">
            Deleted {new Date(load.deleted_at).toLocaleString()}
          </div>
        )}

        {canWrite && !load.deleted_at && (
          <Section title="Move status">
            <div className="flex flex-wrap gap-1.5">
              {LOAD_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onStatus(s)}
                  className={`rounded-md px-2 py-1 text-[11px] ring-1 ring-line ${
                    load.status === s
                      ? "bg-accent/12 text-accent"
                      : "bg-panel2 text-mut hover:text-fg"
                  }`}
                >
                  {label(s)}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Timeline">
          <div className="space-y-2">
            {events.length === 0 && <p className="text-xs text-mut">No activity yet.</p>}
            {events.map((e) => (
              <div key={e.id} className="rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
                <div className="text-fg">{e.description ?? label(e.event_type)}</div>
                <div className="num mt-0.5 font-mono text-[10px] text-mut">
                  {new Date(e.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {load.notes && (
          <Section title="Notes">
            <p className="text-xs text-mut">{load.notes}</p>
          </Section>
        )}
      </div>
      {canWrite && !load.deleted_at && (
        <div className="shrink-0 space-y-2 border-t border-line bg-panel px-3 py-3">
          <button
            onClick={onEdit}
            className="w-full rounded-lg bg-accent/12 px-3 py-2.5 text-xs font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20"
          >
            Edit load
          </button>
          <button
            onClick={onDelete}
            className="w-full rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive ring-1 ring-destructive/30 hover:bg-destructive/20"
          >
            Delete load
          </button>
        </div>
      )}
    </aside>
  );
}

function DriverAssign({
  load,
  drivers,
  onAssign,
}: {
  load: Load;
  drivers: Driver[];
  onAssign: (driverId: string | null) => void;
}) {
  const [driverId, setDriverId] = useState(load.driver_id ?? "");
  const options = drivers
    .map((d) => ({ d, issues: safetyIssues(d) }))
    .sort((a, b) => a.issues.length - b.issues.length);
  const selected = options.find(({ d }) => d.id === driverId);
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <select
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-lg bg-ink px-2 text-xs text-fg ring-1 ring-line focus:outline-none"
      >
        <option value="">— No driver —</option>
        {options.map(({ d, issues }) => (
          <option key={d.id} value={d.id}>
            {d.unit_number ? `${d.unit_number} · ` : ""}
            {d.full_name}
            {issues.length ? ` (not cleared: ${issues.join(", ")})` : " ✓ cleared"}
          </option>
        ))}
      </select>
      <button
        onClick={() => onAssign(driverId || null)}
        disabled={(driverId || null) === (load.driver_id ?? null)}
        className="h-9 rounded-lg bg-accent px-3 text-xs font-medium text-ink disabled:opacity-40"
      >
        {driverId ? "Assign" : "Remove"}
      </button>
      {selected?.issues.length ? (
        <div
          className="basis-full rounded-md bg-transit/12 px-3 py-2 text-xs text-transit"
          role="status"
        >
          ⚠ Safety warning: {selected.issues.join(", ")}. You can still assign this driver.
        </div>
      ) : null}
    </div>
  );
}

function DispatcherAssign({
  currentId,
  staff,
  onAssign,
}: {
  currentId: string | null;
  staff: Profile[];
  onAssign: (id: string | null) => void;
}) {
  const [staffId, setStaffId] = useState(currentId ?? "");
  return (
    <div className="mt-3 flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <SelectInput
          label="Staff dispatcher"
          value={staffId}
          onChange={setStaffId}
          options={[
            { value: "", text: "Unassigned" },
            ...staff.map((p) => ({ value: p.id, text: p.full_name ?? p.email ?? "Staff member" })),
          ]}
        />
      </div>
      <PrimaryButton
        onClick={() => onAssign(staffId || null)}
        disabled={staffId === (currentId ?? "")}
      >
        Assign dispatch
      </PrimaryButton>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{title}</div>
      {children}
    </div>
  );
}

function Cell({ label: text, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-mut">{text.toUpperCase()}</div>
      <div className={`mt-0.5 text-fg ${mono ? "num font-mono" : ""}`}>{value}</div>
    </div>
  );
}

type LoadForm = {
  load_number: string;
  driver_id: string;
  dispatcher_id: string;
  broker_id: string;
  customer_name: string;
  shipper: string;
  consignee: string;
  pickup_location: string;
  pickup_date: string;
  delivery_location: string;
  delivery_date: string;
  commodity: string;
  weight: string;
  equipment_type: string;
  miles: string;
  rate: string;
  driver_pay: string;
  cut: string;
  notes: string;
};

const s = (v: unknown) => (v == null ? "" : String(v));

function normalizeCsvHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function csvNumber(value: string | undefined) {
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsv(input: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      record.push(field);
      if (record.some((cell) => cell.trim())) records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  record.push(field);
  if (record.some((cell) => cell.trim())) records.push(record);
  if (!records.length) return [];
  const firstRecord = records[0];
  if (!firstRecord) return [];
  const headers = firstRecord.map((header) => header.replace(/^\uFEFF/, "").trim());
  return records
    .slice(1)
    .map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
    );
}

async function restoreLoadBackup(rows: Record<string, string>[], headers: string[]) {
  const columns = headers.filter((header) =>
    LOAD_BACKUP_COLUMNS.includes(header as (typeof LOAD_BACKUP_COLUMNS)[number]),
  );
  if (!columns.includes("id") || !columns.includes("load_number")) {
    throw new Error("This backup needs both id and load_number columns");
  }
  const payload = rows.map((row, rowIndex) => {
    const restored: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      const raw = row[column];
      if (raw === undefined) continue;
      if (raw === "\\N") {
        restored[column] = null;
      } else if (LOAD_NUMBER_COLUMNS.has(column)) {
        if (!raw.trim()) {
          restored[column] = null;
          continue;
        }
        const value = Number(raw.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(value))
          throw new Error(`Invalid ${column} value on CSV row ${rowIndex + 2}`);
        restored[column] = value;
      } else if (LOAD_BOOLEAN_COLUMNS.has(column)) {
        restored[column] = ["true", "t", "1", "yes"].includes(raw.trim().toLowerCase());
      } else {
        restored[column] = raw;
      }
    }
    if (typeof restored["id"] !== "string" || !restored["id"].trim()) {
      throw new Error(`Missing load id on CSV row ${rowIndex + 2}`);
    }
    if (typeof restored["load_number"] !== "string" || !restored["load_number"].trim()) {
      throw new Error(`Missing load number on CSV row ${rowIndex + 2}`);
    }
    return restored;
  });

  for (let offset = 0; offset < payload.length; offset += 100) {
    const { error } = await supabase
      .from("loads")
      .upsert(payload.slice(offset, offset + 100) as never, { onConflict: "id" });
    if (error) throw new Error(`Backup restore stopped after ${offset} rows: ${error.message}`);
  }
  return payload.length;
}

function ImportModal({
  brokers,
  onClose,
  onParsed,
}: {
  brokers: { id: string; name: string }[];
  onClose: () => void;
  onParsed: (initial: Partial<LoadForm>) => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const scan = useServerFn(scanLoadFile);
  const qc = useQueryClient();
  const [pending, setPending] = useState<Partial<LoadForm> | null>(null);
  const [broker, setBroker] = useState({
    name: "",
    mc_number: "",
    dot_number: "",
    phone: "",
    email: "",
    address: "",
  });
  const setB = (k: keyof typeof broker) => (v: string) => setBroker((b) => ({ ...b, [k]: v }));
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matched = broker.name
    ? brokers.find(
        (b) =>
          norm(b.name) === norm(broker.name) ||
          (norm(b.name).length > 3 && norm(broker.name).includes(norm(b.name))),
      )
    : undefined;

  async function confirmBroker() {
    if (!pending) return;
    if (!broker.name.trim()) return void toast.error("Enter the broker name");
    let id = matched?.id;
    const extra: {
      mc_number?: string;
      dot_number?: string;
      phone?: string;
      email?: string;
      address?: string;
    } = Object.fromEntries(
      Object.entries({
        mc_number: broker.mc_number,
        dot_number: broker.dot_number,
        phone: broker.phone,
        email: broker.email,
        address: broker.address,
      }).filter(([, v]) => v.trim()),
    );
    if (id) {
      if (Object.keys(extra).length) await supabase.from("brokers").update(extra).eq("id", id);
    } else {
      const { data, error } = await supabase
        .from("brokers")
        .insert({ name: broker.name.trim(), is_customer: true, ...extra })
        .select("id")
        .single();
      if (error) return void toast.error(error.message);
      id = data.id;
      toast.success(`New broker "${broker.name.trim()}" added`);
    }
    await qc.invalidateQueries({ queryKey: ["brokers"] });
    onParsed({ ...pending, broker_id: id, customer_name: broker.name.trim() });
  }
  const amazon = brokers.find((b) => /amazon/i.test(b.name));

  function pick(f: File | null) {
    setFile(f);
    setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  }

  async function importTripsCsv(csvFile: File) {
    if (csvFile.size > 20 * 1024 * 1024) return void toast.error("CSV is too large (max 20 MB)");
    setImportingCsv(true);
    try {
      const rows = parseCsv(await csvFile.text());
      if (!rows.length) throw new Error("The CSV has no data rows");
      const firstRow = rows[0];
      if (!firstRow) throw new Error("The CSV has no data rows");
      const headers = Object.keys(firstRow);
      const normalizedHeaders = headers.map(normalizeCsvHeader);
      if (normalizedHeaders.includes("id") && normalizedHeaders.includes("loadnumber")) {
        const backupCount = await restoreLoadBackup(rows, headers);
        await qc.invalidateQueries({ queryKey: ["loads"] });
        await qc.invalidateQueries({ queryKey: ["loads", "all"] });
        toast.success(
          `Restored ${backupCount} loads from the Vantera backup. Matching load IDs were updated; missing loads were recreated.`,
        );
        onClose();
        return;
      }
      const col = (aliases: string[]) =>
        headers.find((h) => aliases.includes(normalizeCsvHeader(h)));
      const tripCol = col(["tripid"]);
      const stageCol = col(["tripstage"]);
      const loadCol = col(["loadid"]);
      const executionCol = col(["loadexecutionstatus"]);
      const milesCol = col(["estimatedistance", "estimatedmiles"]);
      const rateCol = col(["estimatedcost", "rate"]);
      if ((!tripCol && !loadCol) || !stageCol || !executionCol || !milesCol || !rateCol) {
        throw new Error(
          "CSV needs Trip ID (or Load ID), Trip Stage, Load Execution Status, Estimate Distance, and Estimated Cost columns",
        );
      }
      const trips = new Map<string, { id: string; stage: string; miles: number; rate: number }>();
      for (const row of rows) {
        const id = String((tripCol ? row[tripCol] : "") || (loadCol ? row[loadCol] : "") || "")
          .trim()
          .toUpperCase();
        if (!id) continue;
        const stage = String(row[stageCol] ?? "").trim();
        const trip = trips.get(id) ?? { id, stage, miles: 0, rate: 0 };
        if (!trip.stage && stage) trip.stage = stage;
        if (/^(completed|complete|delivered)$/i.test(String(row[executionCol] ?? "").trim())) {
          trip.miles += csvNumber(row[milesCol]);
          trip.rate += csvNumber(row[rateCol]);
        }
        trips.set(id, trip);
      }
      const grouped = [...trips.values()];
      if (!grouped.length) throw new Error("No rows with a Trip ID or Load ID were found");
      const existingIds = new Set<string>();
      for (let offset = 0; offset < grouped.length; offset += 100) {
        const idBatch = grouped.slice(offset, offset + 100).map((trip) => trip.id);
        const { data: existingLoads, error: existingError } = await supabase
          .from("loads")
          .select("load_number")
          .in("load_number", idBatch);
        if (existingError) throw new Error(existingError.message);
        for (const load of existingLoads ?? []) existingIds.add(load.load_number.toUpperCase());
      }
      const fresh = grouped.filter((trip) => !existingIds.has(trip.id.toUpperCase()));
      const { data: userData } = await supabase.auth.getUser();
      const toStatus = (stage: string) => {
        const value = stage.toLowerCase();
        if (/cancel/.test(value)) return "cancelled";
        if (/reject/.test(value)) return "rejected";
        if (/complete|deliver/.test(value)) return "delivered";
        if (/transit|progress|started/.test(value)) return "in_transit";
        if (/paid/.test(value)) return "paid";
        return "new";
      };
      const inserts = fresh.map((trip) => ({
        load_number: trip.id,
        status: toStatus(trip.stage),
        miles: Math.round(trip.miles * 100) / 100,
        rate: Math.round(trip.rate * 100) / 100,
        equipment_type: "Power only",
        created_by: userData.user?.id ?? null,
      }));
      for (let offset = 0; offset < inserts.length; offset += 100) {
        const { error } = await supabase.from("loads").insert(inserts.slice(offset, offset + 100));
        if (error) throw new Error(error.message);
      }
      if (inserts.length) {
        await qc.invalidateQueries({ queryKey: ["loads"] });
        await qc.invalidateQueries({ queryKey: ["loads", "all"] });
      }
      toast.success(
        `Imported ${inserts.length} trips${grouped.length - inserts.length ? ` · skipped ${grouped.length - inserts.length} duplicates` : ""}. Completed leg miles and rates were combined; cancelled legs were ignored.`,
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import CSV");
    } finally {
      setImportingCsv(false);
    }
  }

  async function scanFile() {
    if (!file) return undefined;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File is too large (max 10 MB)");
      return undefined;
    }
    setScanning(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const out = await scan({ data: { dataUrl, mime: file.type, name: file.name } });
      if (!out.load) return void toast.error(out.error ?? "Scan failed");
      const l = out.load;
      const picks = l.stops.filter((x) => x.kind === "pickup");
      const drops = l.stops.filter((x) => x.kind === "drop");
      const first = picks[0] ?? l.stops[0];
      const last = drops[drops.length - 1] ?? l.stops[l.stops.length - 1];
      const from = findFacility(first?.facility_code ?? "");
      const to = findFacility(last?.facility_code ?? "");
      const miles = l.miles ?? (from && to ? facilityMiles(from, to) : null);
      const extra = [
        l.tractor && `Tractor: ${l.tractor}`,
        l.trailer && `Trailer: ${l.trailer}`,
        l.driver && `Driver: ${l.driver}`,
        l.stops.length > 2 &&
          "Stops: " +
            l.stops.map((x) => `${x.kind} ${x.facility_code || x.city} ${x.scheduled}`).join(" → "),
        l.notes,
      ].filter(Boolean);
      const isAmz = /amazon/i.test(l.broker.name) || isAmazonLoadId(l.load_number);
      setBroker({
        name: isAmz ? "Amazon" : l.broker.name,
        mc_number: l.broker.mc_number,
        dot_number: l.broker.dot_number,
        phone: l.broker.phone,
        email: l.broker.email,
        address: l.broker.address,
      });
      setPending({
        load_number: l.load_number.toUpperCase(),
        customer_name: l.broker.name,
        shipper: (first?.facility_code || "").toUpperCase(),
        consignee: (last?.facility_code || "").toUpperCase(),
        pickup_location: from?.city ?? first?.city ?? "",
        delivery_location: to?.city ?? last?.city ?? "",
        pickup_date: (first?.scheduled ?? "").slice(0, 10),
        delivery_date: (last?.scheduled ?? "").slice(0, 10),
        miles: miles != null ? String(Math.round(miles)) : "",
        rate: l.rate != null ? String(l.rate) : "",
        equipment_type: l.equipment_type || "Power only",
        notes: extra.join("\n"),
      });
      toast.success("Load scanned — confirm the broker");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function go() {
    const p = parseAmazonLoad(text);
    if (!p.load_number && !p.shipper) {
      toast.error("Couldn't find an Amazon load ID or facility in that text");
      return;
    }
    const from = findFacility(p.shipper);
    const to = findFacility(p.consignee);
    onParsed({
      ...p,
      broker_id: amazon?.id ?? "",
      customer_name: "Amazon",
      pickup_location: from?.city ?? "",
      delivery_location: to?.city ?? "",
    });
  }

  return (
    <Modal title="Import load" onClose={onClose} wide>
      {pending ? (
        <div className="space-y-3">
          <p className="text-xs text-mut">
            {matched
              ? `Matched existing broker "${matched.name}". Add or correct MC / DOT if needed.`
              : "This is a new broker — check the name and add the MC / DOT number. It will be saved to Broker CRM."}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <TextInput label="Broker name *" value={broker.name} onChange={setB("name")} />
            <TextInput label="MC #" value={broker.mc_number} onChange={setB("mc_number")} />
            <TextInput label="DOT #" value={broker.dot_number} onChange={setB("dot_number")} />
            <TextInput label="Phone" value={broker.phone} onChange={setB("phone")} />
            <TextInput label="Email" value={broker.email} onChange={setB("email")} />
            <TextInput label="Address" value={broker.address} onChange={setB("address")} />
          </div>
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setPending(null)}>Back</GhostButton>
            <PrimaryButton onClick={confirmBroker}>Continue to load</PrimaryButton>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-mut">
            Select an Amazon Relay CSV to add trip summaries automatically, or import a Vantera
            loads backup CSV to restore complete load records. Other files can be scanned from a
            rate confirmation or Relay screenshot/PDF, then reviewed before saving.
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-ink p-4 text-xs text-mut hover:text-fg">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0] ?? null;
                if (selected?.name.toLowerCase().endsWith(".csv")) void importTripsCsv(selected);
                else pick(selected);
                e.currentTarget.value = "";
              }}
            />
            {preview ? (
              <img src={preview} alt="Upload preview" className="max-h-48 rounded" />
            ) : (
              <span>
                {importingCsv
                  ? "Importing trips…"
                  : file
                    ? file.name
                    : "Choose an image/PDF or Amazon Relay CSV"}
              </span>
            )}
          </label>
          <div className="mt-2 flex justify-end">
            <PrimaryButton onClick={scanFile} disabled={!file || scanning}>
              {scanning ? "Scanning…" : "Scan load with AI"}
            </PrimaryButton>
          </div>
          <p className="mt-4 mb-2 text-xs text-mut">Or paste the load text:</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"T-112ABCD9X\nSAT3  Oct 6 08:00\nDFW6  Oct 7 14:00\n275 mi  $1,250.00"}
            className="w-full rounded-lg bg-ink p-3 font-mono text-xs text-fg ring-1 ring-line focus:outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={go} disabled={!text.trim()}>
              Read text
            </PrimaryButton>
          </div>
        </>
      )}
    </Modal>
  );
}

function NewLoadModal({
  brokers,
  drivers,
  dispatchers,
  existing,
  initial,
  onClose,
  onCreated,
}: {
  brokers: { id: string; name: string }[];
  drivers: Driver[];
  dispatchers: Profile[];
  existing?: Load;
  initial?: Partial<LoadForm> | undefined;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<LoadForm>(() => {
    const base: LoadForm = {
      load_number: `L-${Math.floor(10000 + Math.random() * 89999)}`,
      driver_id: "",
      dispatcher_id: "",
      broker_id: "",
      customer_name: "",
      shipper: "",
      consignee: "",
      pickup_location: "",
      pickup_date: "",
      delivery_location: "",
      delivery_date: "",
      commodity: "",
      weight: "",
      equipment_type: "Power only",
      miles: "",
      rate: "",
      driver_pay: "",
      cut: "",
      notes: "",
    };
    if (existing) {
      (Object.keys(base) as (keyof LoadForm)[]).forEach((k) => {
        base[k] = s((existing as Record<string, unknown>)[k]);
      });
    }
    return { ...base, ...initial };
  });
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [pickupAddr, setPickupAddr] = useState(
    existing?.pickup_address ?? findFacility(form.shipper)?.address ?? "",
  );
  const [deliveryAddr, setDeliveryAddr] = useState(
    existing?.delivery_address ?? findFacility(form.consignee)?.address ?? "",
  );
  const [autoMiles, setAutoMiles] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isAmazon = /amazon/i.test(brokers.find((b) => b.id === form.broker_id)?.name ?? "");
  const selectedDriver = drivers.find((driver) => driver.id === form.driver_id);
  const selectedDriverIssues = selectedDriver ? safetyIssues(selectedDriver) : [];

  function pickBroker(id: string) {
    const amz = /amazon/i.test(brokers.find((b) => b.id === id)?.name ?? "");
    setForm((f) => ({
      ...f,
      broker_id: id,
      customer_name: amz ? "Amazon" : f.customer_name === "Amazon" ? "" : f.customer_name,
      load_number: amz ? "" : f.load_number || `L-${Math.floor(10000 + Math.random() * 89999)}`,
    }));
  }

  function facility(side: "pickup" | "delivery", code: string) {
    const up = code.toUpperCase();
    const fac = findFacility(up);
    (side === "pickup" ? setPickupAddr : setDeliveryAddr)(fac ? fac.address : "");
    setForm((f) => {
      const next =
        side === "pickup"
          ? { ...f, shipper: up, pickup_location: fac ? fac.city : f.pickup_location }
          : { ...f, consignee: up, delivery_location: fac ? fac.city : f.delivery_location };
      // Auto-calculate miles when both facilities are known, unless the user typed miles manually.
      const from = findFacility(next.shipper);
      const to = findFacility(next.consignee);
      const miles = from && to ? facilityMiles(from, to) : null;
      if (miles != null && (f.miles === "" || f.miles === autoMiles)) {
        next.miles = String(miles);
        setAutoMiles(String(miles));
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const fields = {
      load_number: isAmazon ? form.load_number.trim().toUpperCase() : form.load_number,
      driver_id: form.driver_id || null,
      dispatcher_id: form.dispatcher_id || null,
      broker_id: form.broker_id || null,
      customer_name: isAmazon ? "Amazon" : form.customer_name || null,
      shipper: form.shipper || null,
      consignee: form.consignee || null,
      pickup_location: form.pickup_location || null,
      pickup_address: pickupAddr || null,
      pickup_date: form.pickup_date || null,
      delivery_location: form.delivery_location || null,
      delivery_address: deliveryAddr || null,
      delivery_date: form.delivery_date || null,
      commodity: form.commodity || null,
      weight: form.weight ? Number(form.weight) : null,
      equipment_type: form.equipment_type || null,
      miles: form.miles ? Number(form.miles) : null,
      rate: form.rate ? Number(form.rate) : 0,
      driver_pay: form.driver_pay ? Number(form.driver_pay) : 0,
      cut: form.cut ? Number(form.cut) : 0,
      notes: form.notes || null,
    };
    if (existing) {
      const { error } = await supabase.from("loads").update(fields).eq("id", existing.id);
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      await logLoadEvent(existing.id, "edited", "Load edited");
      toast.success("Load updated");
      onCreated();
      return;
    }
    const { data, error } = await supabase
      .from("loads")
      .insert({
        ...fields,
        status: form.driver_id ? "assigned" : "new",
        created_by: userData.user?.id ?? null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logLoadEvent(
      data.id,
      "created",
      initial ? "Load created from an import or template" : "Load created",
    );
    if (form.driver_id) {
      await supabase
        .from("drivers")
        .update({ status: "on_load", dispatch_status: "in_transit" })
        .eq("id", form.driver_id);
      const selectedDriver = drivers.find((d) => d.id === form.driver_id);
      const warnings = selectedDriver ? safetyIssues(selectedDriver) : [];
      await logLoadEvent(
        data.id,
        "assigned",
        selectedDriver
          ? `Driver ${selectedDriver.full_name} assigned during load creation`
          : "Driver assigned during load creation",
      );
      await queryClient.invalidateQueries({ queryKey: ["drivers"] });
      if (warnings.length)
        toast.warning(`Load created and assigned with safety warning: ${warnings.join(", ")}`);
      else toast.success("Load created and driver assigned");
    } else toast.success("Load created");
    await queryClient.invalidateQueries({ queryKey: ["loads"] });
    onCreated();
  }

  return (
    <Modal
      title={existing ? `Edit ${existing.load_number}` : isAmazon ? "New Amazon load" : "New load"}
      onClose={onClose}
      wide
    >
      <datalist id="amz-fac">
        {AMAZON_FACILITIES.map((f) => (
          <option key={f.code} value={f.code}>
            {f.city}
          </option>
        ))}
      </datalist>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SelectInput
          label="Broker"
          value={form.broker_id}
          onChange={pickBroker}
          options={[
            { value: "", text: "—" },
            ...brokers.map((b) => ({ value: b.id, text: b.name })),
          ]}
        />
        <label className="block">
          <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
            {isAmazon ? "Amazon load ID *" : "Load ID *"}
          </span>
          <input
            required
            value={form.load_number}
            onChange={(e) =>
              set("load_number")(isAmazon ? e.target.value.toUpperCase() : e.target.value)
            }
            placeholder={isAmazon ? "Enter load ID" : ""}
            className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line focus:outline-none"
          />
        </label>
        {!existing && (
          <>
            <SelectInput
              label="Assign driver (optional)"
              value={form.driver_id}
              onChange={set("driver_id")}
              options={[
                { value: "", text: "Assign later" },
                ...drivers
                  .filter((d) => d.status !== "inactive")
                  .map((d) => ({ value: d.id, text: d.full_name })),
              ]}
            />
            {selectedDriverIssues.length > 0 && (
              <div
                className="rounded-lg bg-transit/12 px-3 py-2 text-xs text-transit md:col-span-3"
                role="status"
              >
                ⚠ {selectedDriver?.full_name} has safety warnings: {selectedDriverIssues.join(", ")}
                . You can still create and assign this load.
              </div>
            )}
          </>
        )}
        <SelectInput
          label="Assign dispatch (optional)"
          value={form.dispatcher_id}
          onChange={set("dispatcher_id")}
          options={[
            { value: "", text: "Unassigned" },
            ...dispatchers.map((p) => ({
              value: p.id,
              text: p.full_name ?? p.email ?? "Staff member",
            })),
          ]}
        />
        {isAmazon ? (
          <TextInput label="Customer" value="Amazon" onChange={() => {}} />
        ) : (
          <TextInput label="Customer" value={form.customer_name} onChange={set("customer_name")} />
        )}
        {isAmazon ? (
          <>
            <FacilityInput
              label="Shipper facility (e.g. SAT3)"
              value={form.shipper}
              address={pickupAddr}
              onChange={(v) => facility("pickup", v)}
            />
            <FacilityInput
              label="Consignee facility"
              value={form.consignee}
              address={deliveryAddr}
              onChange={(v) => facility("delivery", v)}
            />
          </>
        ) : (
          <>
            <TextInput label="Shipper" value={form.shipper} onChange={set("shipper")} />
            <TextInput label="Consignee" value={form.consignee} onChange={set("consignee")} />
          </>
        )}
        <TextInput label="Commodity" value={form.commodity} onChange={set("commodity")} />
        <TextInput
          label="Pickup city"
          value={form.pickup_location}
          onChange={set("pickup_location")}
        />
        <TextInput
          label="Pickup date"
          type="date"
          value={form.pickup_date}
          onChange={set("pickup_date")}
        />
        <TextInput label="Equipment" value={form.equipment_type} onChange={set("equipment_type")} />
        <TextInput
          label="Delivery city"
          value={form.delivery_location}
          onChange={set("delivery_location")}
        />
        <TextInput
          label="Delivery date"
          type="date"
          value={form.delivery_date}
          onChange={set("delivery_date")}
        />
        <TextInput label="Weight (lb)" type="number" value={form.weight} onChange={set("weight")} />
        <TextInput
          label={
            isAmazon && autoMiles !== null && form.miles === autoMiles ? "Miles (auto)" : "Miles"
          }
          type="number"
          value={form.miles}
          onChange={(v) => {
            setAutoMiles(null);
            set("miles")(v);
          }}
        />
        <TextInput label="Rate ($)" type="number" value={form.rate} onChange={set("rate")} />
        <TextInput
          label="Driver pay ($)"
          type="number"
          value={form.driver_pay}
          onChange={set("driver_pay")}
        />
        <TextInput label="CUT ($)" type="number" value={form.cut} onChange={set("cut")} />
        <div className="col-span-full">
          <TextInput label="Notes" value={form.notes} onChange={set("notes")} />
        </div>
        <div className="col-span-full flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Saving…" : existing ? "Save changes" : "Create load"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function FacilityInput({
  label: text,
  value,
  address,
  onChange,
}: {
  label: string;
  value: string;
  address: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{text}</span>
      <input
        list="amz-fac"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="SAT3"
        className="mt-1 h-9 w-full rounded-lg bg-ink px-3 font-mono text-sm text-fg ring-1 ring-line focus:outline-none"
      />
      <span className={`mt-1 block text-[11px] ${address ? "text-accent" : "text-mut"}`}>
        {address ||
          (value ? "Unknown facility — type address in city field" : "Type a facility code")}
      </span>
    </label>
  );
}
