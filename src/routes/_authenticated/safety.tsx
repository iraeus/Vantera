import { createFileRoute } from "@tanstack/react-router";
import { CrudPage } from "@/components/crud-page";
import { opts } from "@/components/record-form";
import { StatusPill } from "@/components/StatusPill";
import { DocumentsPanel, ExpiryBadge } from "@/components/entity-kit";
import { ExpiryAlerts, MissingInfo } from "@/components/expiry-alerts";
import { useDrivers, type Driver } from "@/hooks/useTms";
import { DRIVER_STATUSES } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated/safety")({
  head: () => ({
    meta: [
      { title: "Safety · Vantera TMS" },
      { name: "description", content: "Driver safety files: CDL, medical certificate, MVR, Clearinghouse and contacts." },
      { property: "og:title", content: "Safety · Vantera TMS" },
      { property: "og:description", content: "Driver safety files: CDL, medical certificate, MVR, Clearinghouse and contacts." },
    ],
  }),
  component: SafetyPage,
});

const DOC_TYPES = ["cdl_front", "cdl_back", "medical_certificate", "mvr", "clearinghouse", "drug_test", "application", "other"];

function SafetyPage() {
  const { data: drivers = [], isLoading } = useDrivers();
  return (
    <div className="space-y-4">
    <ExpiryAlerts kinds={["driver"]} title="Driver expiries (CDL, medical card, documents)" />
    <MissingInfo />
    <CrudPage<Driver>
      title="Driver safety files"
      table="drivers"
      entityType="driver"
      module="safety"
      queryKey="drivers"
      rows={drivers}
      loading={isLoading}
      titleOf={(d) => d.full_name}
      subtitleOf={(d) => `Unit ${d.unit_number ?? "—"} · ${d.phone ?? "no phone"} · ${d.email ?? "no email"}`}
      searchKeys={["full_name", "unit_number", "phone", "email", "cdl_number"]}
      filters={[{ key: "status", label: "statuses", options: opts(DRIVER_STATUSES), test: (r, v) => r.status === v }]}
      fields={[
        { key: "full_name", label: "Driver name", required: true },
        { key: "unit_number", label: "Unit" },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Email" },
        { key: "status", label: "Status", type: "select", options: opts(DRIVER_STATUSES) },
        { key: "cdl_number", label: "CDL #" },
        { key: "cdl_state", label: "CDL state" },
        { key: "cdl_expiration", label: "CDL exp.", type: "date" },
        { key: "medical_card_expiration", label: "Medical cert. exp.", type: "date" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        { key: "unit_number", text: "Unit", className: "font-mono" },
        { key: "full_name", text: "Driver", className: "text-fg" },
        { key: "phone", text: "Phone" },
        { key: "email", text: "Email" },
        { key: "status", text: "Status", render: (d) => <StatusPill status={d.status} /> },
        { key: "cdl_expiration", text: "CDL", render: (d) => <ExpiryBadge date={d.cdl_expiration} /> },
        { key: "medical_card_expiration", text: "Medical", render: (d) => <ExpiryBadge date={d.medical_card_expiration} /> },
      ]}
      tabs={(d) => [
        { key: "docs", text: "Documents", body: <DocumentsPanel entityType="driver" entityId={d.id} docTypes={DOC_TYPES} /> },
      ]}
    />
    </div>
  );
}
