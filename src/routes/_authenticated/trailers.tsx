import { createFileRoute } from "@tanstack/react-router";
import { CrudPage } from "@/components/crud-page";
import { opts } from "@/components/record-form";
import { StatusPill } from "@/components/StatusPill";
import { DocumentsPanel, ExpiryBadge, MaintenancePanel } from "@/components/entity-kit";
import { useDrivers, useTrailers, useTrucks, type Trailer } from "@/hooks/useTms";
import { TRAILER_STATUSES, label } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated/trailers")({
  validateSearch: (search: Record<string, unknown>): { open?: string } => {
    const open = search["open"];
    return typeof open === "string" ? { open } : {};
  },
  head: () => ({
    meta: [
      { title: "Trailers · Vantera TMS" },
      { name: "description", content: "Trailer roster, assignments, expirations and maintenance." },
      { property: "og:title", content: "Trailers · Vantera TMS" },
      {
        property: "og:description",
        content: "Trailer roster, assignments, expirations and maintenance.",
      },
    ],
  }),
  component: TrailersPage,
});

const TYPES = ["dry_van", "reefer", "flatbed", "step_deck", "tanker", "conestoga", "other"];

function TrailersPage() {
  const { open } = Route.useSearch();
  const { data: trailers = [], isLoading } = useTrailers();
  const { data: trucks = [] } = useTrucks();
  const { data: drivers = [] } = useDrivers();
  const truckNo = (id: string | null) => trucks.find((t) => t.id === id)?.truck_number ?? "—";
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.full_name ?? "—";

  return (
    <CrudPage<Trailer>
      title="Trailers"
      table="trailers"
      entityType="trailer"
      module="trailers"
      queryKey="trailers"
      rows={trailers}
      initialOpenId={open}
      loading={isLoading}
      titleOf={(t) => `Trailer ${t.trailer_number}`}
      subtitleOf={(t) => `${label(t.trailer_type)} · ${label(t.status)}`}
      searchKeys={["trailer_number", "vin", "make", "plate", "current_location"]}
      filters={[
        {
          key: "status",
          label: "statuses",
          options: opts(TRAILER_STATUSES),
          test: (r, v) => r.status === v,
        },
        { key: "type", label: "types", options: opts(TYPES), test: (r, v) => r.trailer_type === v },
      ]}
      fields={[
        { key: "trailer_number", label: "Trailer #", required: true },
        { key: "status", label: "Status", type: "select", options: opts(TRAILER_STATUSES) },
        { key: "trailer_type", label: "Type", type: "select", options: opts(TYPES, "—") },
        {
          key: "assigned_truck_id",
          label: "Truck",
          type: "select",
          options: [
            { value: "", text: "Unassigned" },
            ...trucks.map((t) => ({ value: t.id, text: t.truck_number })),
          ],
        },
        {
          key: "assigned_driver_id",
          label: "Driver",
          type: "select",
          options: [
            { value: "", text: "Unassigned" },
            ...drivers.map((d) => ({ value: d.id, text: d.full_name })),
          ],
        },
        { key: "vin", label: "VIN" },
        { key: "make", label: "Make" },
        { key: "model", label: "Model" },
        { key: "year", label: "Year", type: "number" },
        { key: "plate", label: "Plate" },
        { key: "plate_state", label: "Plate state" },
        { key: "mileage", label: "Mileage", type: "number" },
        { key: "current_location", label: "Current location" },
        { key: "registration_expiration", label: "Registration exp.", type: "date" },
        { key: "insurance_expiration", label: "Insurance exp.", type: "date" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        { key: "trailer_number", text: "Trailer", className: "font-mono text-fg" },
        { key: "status", text: "Status", render: (t) => <StatusPill status={t.status} /> },
        { key: "trailer_type", text: "Type", render: (t) => label(t.trailer_type) },
        { key: "assigned_truck_id", text: "Truck", render: (t) => truckNo(t.assigned_truck_id) },
        {
          key: "assigned_driver_id",
          text: "Driver",
          render: (t) => driverName(t.assigned_driver_id),
        },
        { key: "current_location", text: "Location" },
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
          body: <MaintenancePanel assetType="trailer" assetId={t.id} />,
        },
        {
          key: "docs",
          text: "Documents",
          body: (
            <DocumentsPanel
              entityType="trailer"
              entityId={t.id}
              docTypes={["registration", "insurance", "inspection", "other"]}
            />
          ),
        },
      ]}
    />
  );
}
