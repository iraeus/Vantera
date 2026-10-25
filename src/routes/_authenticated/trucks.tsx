import { createFileRoute } from "@tanstack/react-router";
import { CrudPage } from "@/components/crud-page";
import { opts } from "@/components/record-form";
import { StatusPill } from "@/components/StatusPill";
import { DocumentsPanel, ExpiryBadge, FuelPanel, MaintenancePanel } from "@/components/entity-kit";
import { useDrivers, useLoads, useTrucks, type Truck } from "@/hooks/useTms";
import { TRUCK_STATUSES, label } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated/trucks")({
  validateSearch: (search: Record<string, unknown>): { open?: string } => {
    const open = search["open"];
    return typeof open === "string" ? { open } : {};
  },
  head: () => ({
    meta: [
      { title: "Trucks · Vantera TMS" },
      { name: "description", content: "Truck roster, status, expirations, maintenance and fuel." },
      { property: "og:title", content: "Trucks · Vantera TMS" },
      {
        property: "og:description",
        content: "Truck roster, status, expirations, maintenance and fuel.",
      },
    ],
  }),
  component: TrucksPage,
});

function TrucksPage() {
  const { open } = Route.useSearch();
  const { data: trucks = [], isLoading } = useTrucks();
  const { data: drivers = [] } = useDrivers();
  const { data: loads = [] } = useLoads();
  const driverOpts = [
    { value: "", text: "Unassigned" },
    ...drivers.map((d) => ({ value: d.id, text: d.full_name })),
  ];
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.full_name ?? "—";

  return (
    <CrudPage<Truck>
      title="Trucks"
      table="trucks"
      entityType="truck"
      module="trucks"
      queryKey="trucks"
      rows={trucks}
      initialOpenId={open}
      loading={isLoading}
      titleOf={(t) => `Truck ${t.truck_number}`}
      subtitleOf={(t) =>
        `${[t.year, t.make, t.model].filter(Boolean).join(" ") || "—"} · ${label(t.status)}`
      }
      searchKeys={["truck_number", "vin", "make", "model", "plate", "current_location"]}
      filters={[
        {
          key: "status",
          label: "statuses",
          options: opts(TRUCK_STATUSES),
          test: (r, v) => r.status === v,
        },
      ]}
      fields={[
        { key: "truck_number", label: "Truck #", required: true },
        { key: "status", label: "Status", type: "select", options: opts(TRUCK_STATUSES) },
        { key: "assigned_driver_id", label: "Driver", type: "select", options: driverOpts },
        { key: "vin", label: "VIN" },
        { key: "make", label: "Make" },
        { key: "model", label: "Model" },
        { key: "year", label: "Year", type: "number" },
        { key: "plate", label: "Plate" },
        { key: "plate_state", label: "Plate state" },
        { key: "mileage", label: "Mileage", type: "number" },
        {
          key: "ownership",
          label: "Ownership",
          type: "select",
          options: opts(["company", "owner_operator", "leased"], "—"),
        },
        { key: "current_location", label: "Current location" },
        { key: "insurance_expiration", label: "Insurance exp.", type: "date" },
        { key: "registration_expiration", label: "Registration exp.", type: "date" },
        { key: "inspection_due", label: "Inspection due", type: "date" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        { key: "truck_number", text: "Truck", className: "font-mono text-fg" },
        { key: "status", text: "Status", render: (t) => <StatusPill status={t.status} /> },
        {
          key: "assigned_driver_id",
          text: "Driver",
          render: (t) => driverName(t.assigned_driver_id),
        },
        {
          key: "make",
          text: "Unit",
          render: (t) => [t.year, t.make, t.model].filter(Boolean).join(" ") || "—",
        },
        {
          key: "mileage",
          text: "Miles",
          render: (t) => (t.mileage ? t.mileage.toLocaleString() : "—"),
        },
        { key: "current_location", text: "Location" },
        {
          key: "insurance_expiration",
          text: "Insurance",
          render: (t) => <ExpiryBadge date={t.insurance_expiration} />,
        },
        {
          key: "registration_expiration",
          text: "Registration",
          render: (t) => <ExpiryBadge date={t.registration_expiration} />,
        },
      ]}
      tabs={(t) => [
        {
          key: "maint",
          text: "Maintenance",
          body: <MaintenancePanel assetType="truck" assetId={t.id} />,
        },
        {
          key: "fuel",
          text: "Fuel",
          body: <FuelPanel truckId={t.id} driverId={t.assigned_driver_id} />,
        },
        {
          key: "loads",
          text: "Loads",
          body: (
            <div className="space-y-1 text-xs">
              {loads
                .filter((l) => l.truck_id === t.id)
                .map((l) => (
                  <div
                    key={l.id}
                    className="flex justify-between rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line"
                  >
                    <span className="font-mono">{l.load_number}</span>
                    <span className="text-mut">
                      {l.pickup_location} → {l.delivery_location}
                    </span>
                    <StatusPill status={l.status} />
                  </div>
                ))}
              {!loads.some((l) => l.truck_id === t.id) && (
                <div className="text-mut">No loads yet.</div>
              )}
            </div>
          ),
        },
        {
          key: "docs",
          text: "Documents",
          body: (
            <DocumentsPanel
              entityType="truck"
              entityId={t.id}
              docTypes={["registration", "insurance", "inspection", "title", "lease", "other"]}
            />
          ),
        },
      ]}
    />
  );
}
