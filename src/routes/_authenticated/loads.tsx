import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { LoadStopsEditor } from "@/components/LoadStopsEditor";
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
import { automaticDriverDispatchState } from "@/lib/driver-dispatch";
import { createSelectedLoadsPdf } from "@/lib/loads-pdf";
import { useServerFn } from "@tanstack/react-start";
import { scanLoadFile } from "@/lib/load-scan.functions";
import {
  AMAZON_FACILITIES,
  facilityMiles,
  findFacility,
  isAmazonLoadId,
} from "@/lib/amazon-facilities";
import {
  createLoadStop,
  easternDateToday,
  initialLoadStops,
  normalizeLoadStops,
  type LoadStop,
} from "@/lib/load-stops";

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

function normalizeCityState(city: string, state: string) {
  const parts = city.split(",").map((part) => part.trim()).filter(Boolean);
  const cityName = parts[0] ?? "";
  const stateName = (state || parts[1] || "").replace(/\./g, "").trim().toLowerCase();
  const stateCode = US_STATE_ABBREVIATIONS[stateName] ?? stateName.toUpperCase();
  return cityName && stateCode ? `${cityName.toLowerCase()}, ${stateCode}` : "";
}

function estimateLoadStopMiles(stops: LoadStop[]) {
  if (stops.length < 2) return null;
  const facilities = stops.map((stop) => {
    const codeMatch = findFacility(stop.facility_name);
    if (codeMatch) return codeMatch;
    const address = stop.street_address.trim().toLowerCase();
    const city = normalizeCityState(stop.city, stop.state);
    const postalCode = stop.postal_code.match(/\b\d{5}\b/)?.[0] ?? stop.street_address.match(/\b\d{5}\b/)?.[0] ?? "";
    return AMAZON_FACILITIES.find((facility) =>
      (address && facility.address.trim().toLowerCase() === address) ||
      (city && normalizeCityState(facility.city, "") === city) ||
      (postalCode && facility.address.match(/\b\d{5}\b/)?.[0] === postalCode),
    ) ?? null;
  });
  if (facilities.some((facility) => !facility)) return null;
  let total = 0;
  for (let index = 1; index < facilities.length; index++) {
    const leg = facilityMiles(facilities[index - 1]!, facilities[index]!);
    if (leg == null) return null;
    total += leg;
  }
  return total;
}

function notifyLoadSaveError(message: string) {
  if (/stops.*schema cache|schema cache.*stops/i.test(message)) {
    toast.error("Database update required: apply the latest Supabase migration, then reload the page.");
    return;
  }
  toast.error(message);
}

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

function loadEndDateKey(
  load: Pick<Load, "delivered_at" | "delivery_departed_at" | "delivery_date" | "created_at">,
) {
  const value =
    load.delivered_at ?? load.delivery_departed_at ?? load.delivery_date ?? load.created_at;
  if (value.length === 10) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : dayKey(date);
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
  "stops",
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
  const navigate = useNavigate();
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
  const [selectedLoadIds, setSelectedLoadIds] = useState<Set<string>>(() => new Set());
  const [brokerTransferOpen, setBrokerTransferOpen] = useState(false);
  const [bulkBrokerId, setBulkBrokerId] = useState("");
  const [transferringBroker, setTransferringBroker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editing, setEditing] = useState<Load | null>(null);
  const [imported, setImported] = useState<LoadInitial | undefined>(undefined);
  const [pendingCancellation, setPendingCancellation] = useState<Load | null>(null);
  const [tonuDraft, setTonuDraft] = useState("");
  const [cancellingLoad, setCancellingLoad] = useState(false);

  useEffect(() => {
    // Consume load deep links once. Leaving `?open=...` in the URL makes a browser refresh
    // reopen the old drawer beside whichever filters the user currently has selected.
    if (!open) return;
    setSelectedId(open);
    setFilter("all");
    setDriverFilter("all");
    setDateFilter("all");
    setSearch("");
    void navigate({ to: "/loads", search: {}, replace: true });
  }, [open, navigate]);

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
        const loadDay = loadEndDateKey(l);
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
        const aDate = loadEndDateKey(a);
        const bDate = loadEndDateKey(b);
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
  const selectedLoads = useMemo(
    () => allLoads.filter((load) => selectedLoadIds.has(load.id)),
    [allLoads, selectedLoadIds],
  );
  const selectedActiveLoads = selectedLoads.filter((load) => !load.deleted_at);
  const selectedVisibleCount = rows.filter((load) => selectedLoadIds.has(load.id)).length;
  const allVisibleSelected = rows.length > 0 && selectedVisibleCount === rows.length;
  const bulkBrokerTransferCount = selectedActiveLoads.filter(
    (load) => load.broker_id !== bulkBrokerId,
  ).length;

  function toggleVisibleSelection() {
    setSelectedLoadIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) rows.forEach((load) => next.delete(load.id));
      else rows.forEach((load) => next.add(load.id));
      return next;
    });
  }

  function toggleLoadSelection(loadId: string) {
    setSelectedLoadIds((current) => {
      const next = new Set(current);
      if (next.has(loadId)) next.delete(loadId);
      else next.add(loadId);
      return next;
    });
  }

  function selectAllActiveLoads() {
    setSelectedLoadIds(new Set(loads.map((load) => load.id)));
  }

  async function transferSelectedLoadsToBroker() {
    const broker = brokers.find((item) => item.id === bulkBrokerId);
    const transferLoads = selectedActiveLoads.filter((load) => load.broker_id !== bulkBrokerId);
    if (!broker || !transferLoads.length) {
      toast.error("Choose a broker and at least one selected load with a different broker.");
      return;
    }
    setTransferringBroker(true);
    const transferredIds: string[] = [];
    let transferError = "";
    for (let index = 0; index < transferLoads.length; index += 100) {
      const batch = transferLoads.slice(index, index + 100);
      const { data, error } = await supabase
        .from("loads")
        .update({ broker_id: broker.id })
        .in(
          "id",
          batch.map((load) => load.id),
        )
        .select("id");
      if (error) {
        transferError = error.message;
        break;
      }
      const batchIds = (data ?? []).map((row) => row.id);
      transferredIds.push(...batchIds);
      if (batchIds.length !== batch.length) {
        transferError = `Only ${batchIds.length} of ${batch.length} loads in a batch were updated. Check your access and refresh the board.`;
        break;
      }
    }
    if (transferredIds.length) {
      await Promise.all(
        transferredIds.map((id) =>
          logLoadEvent(id, "broker_changed", `Broker changed to ${broker.name} in a bulk transfer`),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["loads"] }),
        queryClient.invalidateQueries({ queryKey: ["loads", "all"] }),
      ]);
      setSelectedLoadIds(
        (current) => new Set([...current].filter((id) => !transferredIds.includes(id))),
      );
    }
    setTransferringBroker(false);
    if (transferError) {
      toast.error(
        transferredIds.length
          ? `Transferred ${transferredIds.length} loads; the remaining transfer failed: ${transferError}`
          : transferError,
      );
      return;
    }
    toast.success(`${transferredIds.length} loads transferred to ${broker.name}`);
    setBrokerTransferOpen(false);
    setBulkBrokerId("");
  }

  function downloadSelectedLoadsPdf() {
    if (!selectedLoads.length) {
      toast.error("Select at least one load to download a PDF.");
      return;
    }
    const records = selectedLoads.map((load) => ({
      loadNumber: load.load_number,
      broker:
        brokers.find((broker) => broker.id === load.broker_id)?.name ??
        load.customer_name ??
        "No broker",
      route: `${load.pickup_location ?? "—"} -> ${load.delivery_location ?? "—"}`,
      status: label(load.status),
      revenue: loadRevenue(load),
      driverPay: Number(load.driver_pay ?? 0),
      cut: Number(load.cut ?? 0),
      paidAmount: load.status === "paid" ? loadRevenue(load) : 0,
      paidDate: load.paid_date ?? "",
    }));
    const bytes = createSelectedLoadsPdf(records, new Date().toLocaleDateString());
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `vantera-selected-loads-${dayKey(new Date())}.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`PDF downloaded with ${records.length} loads`);
  }

  function exportCsv(backupAll = false) {
    const exportRows = backupAll ? allLoads : rows;
    if (!exportRows.length) return void toast.error("There are no loads to export");
    const columns = LOAD_BACKUP_COLUMNS.filter((column) => allLoads.some((load) => column in load));
    const body = [
      columns,
      ...exportRows.map((load) =>
        columns.map((column) => {
          const value = load[column as keyof Load];
          return value == null ? "\\N" : column === "stops" ? JSON.stringify(value) : String(value);
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
    const update = {
      status,
      is_problem: status === "problem",
      ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
    };
    const { error } = await supabase.from("loads").update(update).eq("id", load.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logLoadEvent(load.id, "status_change", `Status set to ${label(status)}`);
    queryClient.invalidateQueries({ queryKey: ["loads"] });
    if (load.driver_id) queryClient.invalidateQueries({ queryKey: ["drivers"] });
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
      queryClient.invalidateQueries({ queryKey: ["drivers"] }),
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
    if (driver && ["new", "available"].includes(load.status)) patch.status = "booked";
    if (driver && !load.truck_id) {
      const t = trucks.find((tr) => tr.assigned_driver_id === driver.id);
      if (t) patch.truck_id = t.id;
    }
    const { error } = await supabase.from("loads").update(patch).eq("id", load.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const resultingLoads = loads.map((item) =>
      item.id === load.id
        ? { ...item, driver_id: driverId, status: patch.status ?? item.status }
        : item,
    );
    if (driver)
      await supabase
        .from("drivers")
        .update(automaticDriverDispatchState(resultingLoads, driver.id))
        .eq("id", driver.id);
    if (load.driver_id && load.driver_id !== driverId) {
      await supabase
        .from("drivers")
        .update(automaticDriverDispatchState(resultingLoads, load.driver_id))
        .eq("id", load.driver_id);
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
    if (load.driver_id) queryClient.invalidateQueries({ queryKey: ["drivers"] });
    queryClient.invalidateQueries({ queryKey: ["load-events", load.id] });
    setSelectedId(null);
    toast.success(`${load.load_number} moved to Deleted`);
  }

  return (
    <div className="flex min-w-0 gap-4">
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

          <div className="flex flex-wrap items-center gap-2 border-y border-line/70 px-4 py-2.5">
            <span className="font-mono text-[10px] text-mut">{selectedLoads.length} selected</span>
            <GhostButton onClick={selectAllActiveLoads} disabled={!loads.length}>
              Select all active loads ({loads.length})
            </GhostButton>
            <GhostButton
              onClick={() => setSelectedLoadIds(new Set())}
              disabled={!selectedLoadIds.size}
            >
              Clear selection
            </GhostButton>
            <span className="flex-1" />
            <GhostButton onClick={downloadSelectedLoadsPdf} disabled={!selectedLoads.length}>
              Download selected PDF
            </GhostButton>
            {me?.canWrite && (
              <PrimaryButton
                onClick={() => setBrokerTransferOpen(true)}
                disabled={!selectedActiveLoads.length}
              >
                Transfer broker
              </PrimaryButton>
            )}
          </div>

          <div className="divide-y divide-line md:hidden">
            {isLoading && <EmptyRow text="Loading loads…" />}
            {!isLoading && rows.length === 0 && (
              <EmptyRow text="No loads match this view. Create one to get started." />
            )}
            {rows.map((load) => (
              <div key={load.id} className="flex items-start gap-3 p-3">
                <input
                  type="checkbox"
                  checked={selectedLoadIds.has(load.id)}
                  onChange={() => toggleLoadSelection(load.id)}
                  aria-label={`Select load ${load.load_number}`}
                  className="mt-1 size-5 shrink-0 accent-accent"
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(load.id)}
                  className={`min-w-0 flex-1 rounded-lg p-2 text-left ${selectedId === load.id ? "bg-panel2" : "hover:bg-panel2/70"}`}
                  aria-label={`Open load ${load.load_number}`}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm font-semibold text-fg">{load.load_number}</span>
                    {load.deleted_at ? (
                      <span className="shrink-0 font-mono text-[10px] text-destructive uppercase">Deleted</span>
                    ) : (
                      <StatusPill status={load.is_problem ? "problem" : load.status} />
                    )}
                  </span>
                  <span className="mt-1 block truncate text-xs text-fg">
                    {load.pickup_location ?? "—"} <span className="text-mut">→</span> {load.delivery_location ?? "—"}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-mut">
                    <span className="truncate">{driverName(load.driver_id)}</span>
                    <span className="num shrink-0 font-mono">{money(loadRevenue(load))} · CUT {money(load.cut)}</span>
                  </span>
                  <span className="mt-1 block font-mono text-[10px] text-mut">End date · {loadEndDateKey(load)}</span>
                </button>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <div className="grid h-9 min-w-[1080px] grid-cols-[28px_minmax(0,1fr)] items-center gap-2 border-b border-line px-4 font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisibleSelection}
                aria-label="Select all visible loads"
                className="size-3.5 accent-accent"
              />
              <div className="grid h-full grid-cols-[100px_1.2fr_90px_100px_110px_115px_70px_75px_95px_100px] items-center gap-2">
                <span>Ref</span>
                <span>Origin → Dest</span>
                <span>End date</span>
                <span>Truck / Trail</span>
                <span>Driver</span>
                <span>Dispatch</span>
                <span>Miles</span>
                <span>CUT</span>
                <span>Revenue</span>
                <span>Status</span>
              </div>
            </div>

            <div className="min-w-[1080px] divide-y divide-line">
              {isLoading && <EmptyRow text="Loading loads…" />}
              {!isLoading && rows.length === 0 && (
                <EmptyRow text="No loads match this view. Create one to get started." />
              )}
              {rows.map((l) => (
                <div
                  key={l.id}
                  className="grid min-h-11 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 px-4"
                >
                  <input
                    type="checkbox"
                    checked={selectedLoadIds.has(l.id)}
                    onChange={() => toggleLoadSelection(l.id)}
                    aria-label={`Select load ${l.load_number}`}
                    className="mx-auto size-3.5 accent-accent"
                  />
                  <button
                    onClick={() => setSelectedId(l.id)}
                    className={`grid h-11 w-full grid-cols-[100px_1.2fr_90px_100px_110px_115px_70px_75px_95px_100px] items-center gap-2 text-left hover:bg-panel2 ${
                      selectedId === l.id ? "bg-panel2" : ""
                    }`}
                  >
                    <span className="font-mono text-xs text-fg">{l.load_number}</span>
                    <span className="truncate text-fg">
                      {l.pickup_location ?? "—"} → {l.delivery_location ?? "—"}
                    </span>
                    <span className="num font-mono text-[10px] text-mut">{loadEndDateKey(l)}</span>
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
                </div>
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
          loads={loads}
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
          loads={loads}
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
      {brokerTransferOpen && (
        <Modal
          title={`Transfer broker for ${selectedActiveLoads.length} selected loads`}
          onClose={() => {
            if (!transferringBroker) setBrokerTransferOpen(false);
          }}
        >
          <div className="space-y-4">
            <p className="text-xs text-mut">
              Move all selected active loads to one broker. Loads already assigned to that broker
              will be skipped.
            </p>
            <SelectInput
              label="Destination broker"
              value={bulkBrokerId}
              onChange={setBulkBrokerId}
              options={[
                { value: "", text: "Choose a broker" },
                ...brokers.map((broker) => ({ value: broker.id, text: broker.name })),
              ]}
            />
            <p className="text-[11px] text-mut">
              {bulkBrokerTransferCount} load{bulkBrokerTransferCount === 1 ? "" : "s"} will be
              transferred.
            </p>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <GhostButton
                disabled={transferringBroker}
                onClick={() => setBrokerTransferOpen(false)}
              >
                Cancel
              </GhostButton>
              <PrimaryButton
                disabled={!bulkBrokerId || !bulkBrokerTransferCount || transferringBroker}
                onClick={() => void transferSelectedLoadsToBroker()}
              >
                {transferringBroker ? "Transferring…" : "Transfer selected loads"}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function loadStatusChoice(status: string) {
  if (["booked", "upcoming", "assigned", "dispatched"].includes(status)) return "booked";
  if (["picked_up", "in_transit", "at_delivery", "unloading"].includes(status))
    return "in_transit";
  if (["delivered", "pod_received", "billing", "paid"].includes(status)) return "delivered";
  if (status === "cancelled" || status === "rejected") return status;
  return "booked";
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
  const itinerary = normalizeLoadStops(load.stops);
  const mileageEstimate = Number(load.miles ?? 0) > 0
    ? Number(load.miles)
    : estimateLoadStopMiles(itinerary);
  const displayedRatePerMile = mileageEstimate ? loadRevenue(load) / mileageEstimate : rpm(load);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/65 sm:static sm:inset-auto sm:z-auto sm:bg-transparent">
    <aside className="drawer-in flex h-[100dvh] w-full max-w-none shrink-0 flex-col overflow-hidden bg-panel ring-1 ring-line shadow-2xl shadow-black/20 sm:sticky sm:top-2 sm:h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-1rem)] sm:w-96 sm:max-w-[calc(100vw-1rem)] sm:rounded-xl">
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
            {money(loadRevenue(load))} · {displayedRatePerMile.toFixed(2)}/mi
          </div>
        </div>

        {canWrite && !load.deleted_at && (
          <div className="rounded-lg bg-panel2/70 p-3 ring-1 ring-line">
            <SelectInput
              label="Load status"
              value={loadStatusChoice(load.status)}
              onChange={(next) => {
                if (next !== loadStatusChoice(load.status)) onStatus(next);
              }}
              options={[
                { value: "booked", text: "Upcoming" },
                { value: "in_transit", text: "In transit" },
                { value: "delivered", text: "Delivered" },
                { value: "cancelled", text: "Cancelled" },
                { value: "rejected", text: "Rejected" },
              ]}
            />
          </div>
        )}

        <Section title="Shipment itinerary" hint={`${itinerary.length} stops`}>
          {itinerary.length ? (
            <div className="space-y-1.5">
              {itinerary.map((stop, index) => (
                <div key={stop.id} className="flex items-start gap-2 rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-panel font-mono text-[10px] text-accent ring-1 ring-line">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-fg">{stop.stop_type} · {stop.facility_name || "Facility not entered"}</div>
                    <div className="truncate text-[10px] text-mut">{[stop.street_address, stop.city, stop.state, stop.postal_code].filter(Boolean).join(", ") || "Address not entered"}</div>
                  </div>
                  <div className="shrink-0 text-right text-[10px] text-mut">
                    {stop.appointment_date || "No date"}{stop.appointment_time ? ` · ${stop.appointment_time}` : ""}
                    <div>{stop.status.replaceAll("_", " ")}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyRow text="No stops recorded for this load." />
          )}
        </Section>

        <Section title="Assignment">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-panel2 p-3 text-xs ring-1 ring-line">
            <Cell label="Truck" value={truck} mono />
            <Cell label="Trailer" value={trailer} mono />
            <Cell label="Driver" value={driverName} />
            <Cell
              label={Number(load.miles ?? 0) > 0 ? "Miles" : mileageEstimate ? "Miles (estimate)" : "Miles"}
              value={mileageEstimate ? Math.round(mileageEstimate).toLocaleString() : "—"}
              mono
            />
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
    </div>
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
  pickup_time: string;
  delivery_location: string;
  delivery_date: string;
  delivery_time: string;
  commodity: string;
  weight: string;
  equipment_type: string;
  miles: string;
  rate: string;
  driver_pay: string;
  cut: string;
  notes: string;
};

type LoadInitial = Partial<LoadForm> & { stops?: LoadStop[] };

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
    const restored: Record<string, unknown> = {};
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
      } else if (column === "stops") {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error();
          restored[column] = parsed;
        } catch {
          throw new Error(`Invalid stops JSON on CSV row ${rowIndex + 2}`);
        }
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
  onParsed: (initial: LoadInitial) => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const scan = useServerFn(scanLoadFile);
  const qc = useQueryClient();
  const [pending, setPending] = useState<LoadInitial | null>(null);
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
        return "booked";
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
      const scannedStops = l.stops.map((item, index) => {
        const stop = createLoadStop(item.kind === "pickup" ? "pickup" : "delivery", index + 1);
        const scheduled = item.scheduled ?? "";
        stop.facility_name = item.facility_code || "";
        stop.street_address = item.address || "";
        stop.city = item.city || "";
        stop.appointment_date = /^\d{4}-\d{2}-\d{2}/.test(scheduled)
          ? scheduled.slice(0, 10)
          : easternDateToday();
        stop.appointment_time = scheduled.match(/(?:T|\s)(\d{2}:\d{2})/)?.[1] ?? "";
        return stop;
      });
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
        stops: scannedStops,
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
  loads,
  dispatchers,
  existing,
  initial,
  onClose,
  onCreated,
}: {
  brokers: { id: string; name: string }[];
  drivers: Driver[];
  loads: Load[];
  dispatchers: Profile[];
  existing?: Load;
  initial?: LoadInitial | undefined;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<LoadForm>(() => {
    const todayEastern = easternDateToday();
    const base: LoadForm = {
      load_number: `L-${Math.floor(10000 + Math.random() * 89999)}`,
      driver_id: "",
      dispatcher_id: "",
      broker_id: "",
      customer_name: "",
      shipper: "",
      consignee: "",
      pickup_location: "",
      pickup_date: existing ? s(existing.pickup_date) : initial?.pickup_date || todayEastern,
      pickup_time: existing ? s(existing.pickup_time) : s(initial?.pickup_time),
      delivery_location: "",
      delivery_date: existing ? s(existing.delivery_date) : initial?.delivery_date || todayEastern,
      delivery_time: existing ? s(existing.delivery_time) : s(initial?.delivery_time),
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
    const { stops: _initialStops, ...initialFields } = initial ?? {};
    return { ...base, ...initialFields };
  });
  const [stops, setStops] = useState<LoadStop[]>(() =>
    initialLoadStops(
      initial?.stops ?? existing?.stops,
      {
        shipper: form.shipper,
        pickup_address: existing?.pickup_address,
        pickup_location: form.pickup_location,
        pickup_date: form.pickup_date,
        pickup_time: form.pickup_time,
        consignee: form.consignee,
        delivery_address: existing?.delivery_address,
        delivery_location: form.delivery_location,
        delivery_date: form.delivery_date,
        delivery_time: form.delivery_time,
      },
      existing ? "" : easternDateToday(),
    ),
  );
  const [cutManuallySet, setCutManuallySet] = useState(() => {
    const rate = Number(existing?.rate ?? initial?.rate ?? 0);
    const driverPay = Number(existing?.driver_pay ?? initial?.driver_pay ?? 0);
    const cut = Number(existing?.cut ?? initial?.cut ?? 0);
    return Boolean(existing || initial?.cut) && cut !== rate - driverPay;
  });
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [pickupAddr, setPickupAddr] = useState(
    stops.find((stop) => stop.stop_type === "pickup")?.street_address ??
      existing?.pickup_address ?? findFacility(form.shipper)?.address ?? "",
  );
  const [deliveryAddr, setDeliveryAddr] = useState(
    [...stops].reverse().find((stop) => stop.stop_type === "delivery")?.street_address ??
      existing?.delivery_address ?? findFacility(form.consignee)?.address ?? "",
  );
  const [autoMiles, setAutoMiles] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (form.miles.trim() && form.miles !== "0" && form.miles !== autoMiles) return;
    const estimatedMiles = estimateLoadStopMiles(stops);
    if (estimatedMiles == null) return;
    const estimateText = String(estimatedMiles);
    if (form.miles !== estimateText) set("miles")(estimateText);
    if (autoMiles !== estimateText) setAutoMiles(estimateText);
  }, [stops, form.miles, autoMiles]);
  function changeStops(next: LoadStop[]) {
    const ordered = next.map((stop, index) => ({ ...stop, sequence_number: index + 1 }));
    setStops(ordered);
    const estimatedMiles = estimateLoadStopMiles(ordered);
    const pickup = ordered.find((stop) => stop.stop_type === "pickup") ?? ordered[0];
    const delivery = [...ordered].reverse().find((stop) => stop.stop_type === "delivery") ?? ordered.at(-1);
    const place = (stop: LoadStop | undefined) =>
      stop ? [stop.city, stop.state].filter(Boolean).join(", ") : "";
    setForm((current) => ({
      ...current,
      shipper: pickup?.facility_name ?? "",
      pickup_location: place(pickup),
      pickup_date: pickup?.appointment_date ?? "",
      pickup_time: pickup?.appointment_time ?? "",
      consignee: delivery?.facility_name ?? "",
      delivery_location: place(delivery),
      delivery_date: delivery?.appointment_date ?? "",
      delivery_time: delivery?.appointment_time ?? "",
      ...(estimatedMiles != null && (current.miles === "" || current.miles === autoMiles)
        ? { miles: String(estimatedMiles) }
        : {}),
    }));
    if (estimatedMiles != null && (form.miles === "" || form.miles === autoMiles))
      setAutoMiles(String(estimatedMiles));
    setPickupAddr(pickup?.street_address ?? "");
    setDeliveryAddr(delivery?.street_address ?? "");
  }
  const setFinancial = (k: "rate" | "driver_pay") => (v: string) => {
    setCutManuallySet(false);
    setForm((current) => {
      const next = { ...current, [k]: v };
      const rate = next.rate.trim() ? Number(next.rate) : null;
      const driverPay = next.driver_pay.trim() ? Number(next.driver_pay) : null;
      next.cut =
        rate !== null && driverPay !== null && Number.isFinite(rate) && Number.isFinite(driverPay)
          ? (rate - driverPay).toFixed(2)
          : "";
      return next;
    });
  };
  const isAmazon = /amazon/i.test(brokers.find((b) => b.id === form.broker_id)?.name ?? "");
  const selectedDriver = drivers.find((driver) => driver.id === form.driver_id);
  const isCompanyDriver = selectedDriver?.driver_type === "company_driver";
  const isPercentageOwnerOperator =
    selectedDriver?.driver_type === "owner_operator" && selectedDriver.pay_type === "percentage";
  const selectedDriverIssues = selectedDriver ? safetyIssues(selectedDriver) : [];

  useEffect(() => {
    if (!isCompanyDriver && !isPercentageOwnerOperator) return;
    setCutManuallySet(false);
    setForm((current) => {
      const rate = current.rate.trim() ? Number(current.rate) : null;
      const driverPay = isPercentageOwnerOperator && rate !== null
        ? (rate * Math.min(100, Math.max(0, Number(selectedDriver?.pay_rate ?? 0)))) / 100
        : current.driver_pay.trim() ? Number(current.driver_pay) : null;
      const cut =
        rate !== null && driverPay !== null && Number.isFinite(rate) && Number.isFinite(driverPay)
          ? (rate - driverPay).toFixed(2)
          : "";
      const driverPayText = isPercentageOwnerOperator && driverPay !== null
        ? driverPay.toFixed(2)
        : current.driver_pay;
      return current.cut === cut && current.driver_pay === driverPayText
        ? current
        : { ...current, driver_pay: driverPayText, cut };
    });
  }, [isCompanyDriver, isPercentageOwnerOperator, selectedDriver?.pay_rate, form.rate]);

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
    const index = side === "pickup"
      ? stops.findIndex((stop) => stop.stop_type === "pickup")
      : stops.map((stop) => stop.stop_type).lastIndexOf("delivery");
    if (index >= 0) {
      const next = stops.slice();
      const stop = next[index]!;
      next[index] = {
        ...stop,
        facility_name: up,
        street_address: fac?.address ?? "",
        city: fac?.city ?? stop.city,
      };
      setStops(next);
      const estimatedMiles = estimateLoadStopMiles(next);
      if (estimatedMiles != null && (form.miles === "" || form.miles === autoMiles)) {
        setAutoMiles(String(estimatedMiles));
        set("miles")(String(estimatedMiles));
      }
    }
    setForm((f) => side === "pickup"
      ? { ...f, shipper: up, pickup_location: fac ? fac.city : f.pickup_location }
      : { ...f, consignee: up, delivery_location: fac ? fac.city : f.delivery_location });
  }

  function setStopFacility(side: "pickup" | "delivery", value: string) {
    set(side === "pickup" ? "shipper" : "consignee")(value);
    const index = side === "pickup"
      ? stops.findIndex((stop) => stop.stop_type === "pickup")
      : stops.map((stop) => stop.stop_type).lastIndexOf("delivery");
    if (index >= 0) {
      const next = stops.slice();
      const facility = findFacility(value);
      const [city = "", state = ""] = facility?.city.split(",").map((part) => part.trim()) ?? [];
      next[index] = {
        ...next[index]!,
        facility_name: value,
        ...(facility ? { street_address: facility.address, city, state, country: "United States" } : {}),
      };
      setStops(next);
      const estimatedMiles = estimateLoadStopMiles(next);
      if (estimatedMiles != null && (form.miles === "" || form.miles === autoMiles)) {
        setAutoMiles(String(estimatedMiles));
        set("miles")(String(estimatedMiles));
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const orderedStops = stops.map((stop, index) => ({ ...stop, sequence_number: index + 1 }));
    const primaryPickup = orderedStops.find((stop) => stop.stop_type === "pickup") ?? orderedStops[0];
    const primaryDelivery =
      [...orderedStops].reverse().find((stop) => stop.stop_type === "delivery") ?? orderedStops.at(-1);
    const stopPlace = (stop: LoadStop | undefined) =>
      stop ? [stop.city, stop.state].filter(Boolean).join(", ") : "";
    const fields = {
      load_number: isAmazon ? form.load_number.trim().toUpperCase() : form.load_number,
      driver_id: form.driver_id || null,
      dispatcher_id: form.dispatcher_id || null,
      broker_id: form.broker_id || null,
      customer_name: isAmazon ? "Amazon" : form.customer_name || null,
      shipper: primaryPickup?.facility_name || form.shipper || null,
      consignee: primaryDelivery?.facility_name || form.consignee || null,
      pickup_location: stopPlace(primaryPickup) || form.pickup_location || null,
      pickup_address: primaryPickup?.street_address || pickupAddr || null,
      pickup_date: primaryPickup?.appointment_date || form.pickup_date || null,
      pickup_time: primaryPickup?.appointment_time || form.pickup_time || null,
      delivery_location: stopPlace(primaryDelivery) || form.delivery_location || null,
      delivery_address: primaryDelivery?.street_address || deliveryAddr || null,
      delivery_date: primaryDelivery?.appointment_date || form.delivery_date || null,
      delivery_time: primaryDelivery?.appointment_time || form.delivery_time || null,
      stops: orderedStops as never,
      commodity: form.commodity || null,
      equipment_type: form.equipment_type || null,
      miles: form.miles ? Number(form.miles) : null,
      rate: form.rate ? Number(form.rate) : 0,
      driver_pay: form.driver_pay ? Number(form.driver_pay) : 0,
      cut: isCompanyDriver || isPercentageOwnerOperator
        ? form.rate.trim() && form.driver_pay.trim()
          ? Number(form.rate) - Number(form.driver_pay)
          : 0
        : form.cut
          ? Number(form.cut)
          : 0,
      notes: form.notes || null,
    };
    if (existing) {
      const { error } = await supabase.from("loads").update(fields).eq("id", existing.id);
      setBusy(false);
      if (error) {
        notifyLoadSaveError(error.message);
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
        status: "booked",
        created_by: userData.user?.id ?? null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      notifyLoadSaveError(error.message);
      return;
    }
    await logLoadEvent(
      data.id,
      "created",
      initial ? "Load created from an import or template" : "Load created",
    );
    if (form.driver_id) {
      const driverLoads = [...loads, { driver_id: form.driver_id, status: "booked" }];
      await supabase
        .from("drivers")
        .update(automaticDriverDispatchState(driverLoads, form.driver_id))
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
            <TextInput label="Shipper / pickup facility" value={form.shipper} onChange={(value) => setStopFacility("pickup", value)} />
            <TextInput label="Consignee / delivery facility" value={form.consignee} onChange={(value) => setStopFacility("delivery", value)} />
          </>
        )}
        <TextInput label="Commodity" value={form.commodity} onChange={set("commodity")} />
        <LoadStopsEditor stops={stops} onChange={changeStops} />
        <TextInput label="Equipment" value={form.equipment_type} onChange={set("equipment_type")} />
        <TextInput
          label={
            autoMiles !== null && form.miles === autoMiles ? "Miles (auto)" : "Miles"
          }
          type="number"
          value={form.miles}
          onChange={(v) => {
            setAutoMiles(null);
            set("miles")(v);
          }}
        />
        <p className="col-span-full -mt-2 text-[10px] text-mut">Miles are estimated from the full stop order when locations match the facility directory. You can enter or adjust miles manually.</p>
        <TextInput
          label="Rate ($)"
          type="number"
          value={form.rate}
          onChange={setFinancial("rate")}
        />
        <TextInput
          label={isPercentageOwnerOperator
            ? `Driver pay ($ · ${selectedDriver?.pay_rate}% gross)`
            : "Driver pay ($)"}
          type="number"
          value={form.driver_pay}
          onChange={setFinancial("driver_pay")}
          disabled={isPercentageOwnerOperator}
        />
        <div>
          <TextInput
            label={
              isCompanyDriver || isPercentageOwnerOperator
                ? "CUT ($ · locked: gross − driver share)"
                : cutManuallySet
                  ? "CUT ($ · manual)"
                  : "CUT ($ · rate − driver pay)"
            }
            type="number"
            value={form.cut}
            disabled={isCompanyDriver || isPercentageOwnerOperator}
            onChange={(value) => {
              setCutManuallySet(true);
              set("cut")(value);
            }}
          />
          <p className="mt-1 text-[10px] text-mut">
            {form.rate.trim() && form.driver_pay.trim()
              ? isCompanyDriver || isPercentageOwnerOperator
                ? `Locked calculation: $${(Number(form.rate) - Number(form.driver_pay)).toFixed(2)}.`
                : `Calculated: $${(Number(form.rate) - Number(form.driver_pay)).toFixed(2)}. You can override CUT.`
              : "Enter rate and driver pay to calculate company CUT."}
          </p>
        </div>
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = (query || value).trim().toLowerCase();
  const matches = normalized
    ? AMAZON_FACILITIES.filter((f) =>
        `${f.code} ${f.city} ${f.address}`.toLowerCase().includes(normalized),
      ).slice(0, 30)
    : AMAZON_FACILITIES.slice(0, 30);

  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{text}</span>
      <div className="relative">
        <input
          value={open ? query : value}
          onFocus={() => {
            setQuery(value);
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Search code, city, or address (e.g. SAT3)"
          autoComplete="off"
          className="mt-1 h-9 w-full rounded-lg bg-ink px-3 font-mono text-sm text-fg ring-1 ring-line focus:outline-none"
        />
        {open && (
          <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl">
            {matches.length ? matches.map((f) => (
              <button
                key={f.code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(f.code);
                  setQuery(f.code);
                  setOpen(false);
                }}
                className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-xs hover:bg-ink"
              >
                <span className="font-mono font-semibold text-fg">{f.code}</span>
                <span className="min-w-0 flex-1 truncate text-mut">{f.city} · {f.address}</span>
              </button>
            )) : <p className="px-2 py-2 text-xs text-mut">No matching facility. You can still enter a code manually.</p>}
            <p className="border-t border-line px-2 py-1.5 text-[10px] text-mut">Showing up to 30 matches · {AMAZON_FACILITIES.length.toLocaleString()} facilities indexed</p>
          </div>
        )}
      </div>
      <span className={`mt-1 block text-[11px] ${address ? "text-accent" : "text-mut"}`}>
        {address ||
          (value ? "Unknown facility — type address in city field" : "Type a facility code")}
      </span>
    </label>
  );
}
