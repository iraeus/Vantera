import { CheckinLinkPanel } from "@/components/checkin-link";
import { createFileRoute } from "@tanstack/react-router";
import { CrudPage } from "@/components/crud-page";
import { opts } from "@/components/record-form";
import { StatusPill } from "@/components/StatusPill";
import { DocumentsPanel, ExpiryBadge } from "@/components/entity-kit";
import { useDrivers, useLoads, useProfiles, type Driver } from "@/hooks/useTms";
import { DRIVER_STATUSES, label, loadRevenue, money } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated/drivers")({
  validateSearch: (search: Record<string, unknown>): { open?: string } => {
    const open = search["open"];
    return typeof open === "string" ? { open } : {};
  },
  head: () => ({
    meta: [
      { title: "Drivers · Vantera TMS" },
      {
        name: "description",
        content: "Driver roster, CDL and medical expirations, pay and load history.",
      },
      { property: "og:title", content: "Drivers · Vantera TMS" },
      {
        property: "og:description",
        content: "Driver roster, CDL and medical expirations, pay and load history.",
      },
    ],
  }),
  component: DriversPage,
});

function DriversPage() {
  const { open } = Route.useSearch();
  const { data: drivers = [], isLoading } = useDrivers();
  const { data: loads = [] } = useLoads();
  const { data: profiles = [] } = useProfiles();

  return (
    <CrudPage<Driver>
      title="Drivers"
      table="drivers"
      entityType="driver"
      module="drivers"
      queryKey="drivers"
      rows={drivers}
      initialOpenId={open}
      loading={isLoading}
      titleOf={(d) => d.full_name}
      subtitleOf={(d) => `${d.driver_code ?? "—"} · ${label(d.status)} · ${d.phone ?? "no phone"}`}
      searchKeys={["full_name", "driver_code", "phone", "email", "cdl_number"]}
      filters={[
        {
          key: "status",
          label: "statuses",
          options: opts(DRIVER_STATUSES),
          test: (r, v) => r.status === v,
        },
      ]}
      fields={[
        { key: "full_name", label: "Full name", required: true },
        { key: "driver_code", label: "Driver code" },
        { key: "unit_number", label: "Unit" },
        { key: "status", label: "Status", type: "select", options: opts(DRIVER_STATUSES) },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Email" },
        {
          key: "dispatcher_id",
          label: "Dispatcher",
          type: "select",
          options: [
            { value: "", text: "—" },
            ...profiles.map((p) => ({ value: p.id, text: p.full_name ?? p.email ?? "" })),
          ],
        },
        { key: "cdl_number", label: "CDL #" },
        { key: "cdl_state", label: "CDL state" },
        { key: "cdl_expiration", label: "CDL exp.", type: "date" },
        { key: "medical_card_expiration", label: "Medical card exp.", type: "date" },
        { key: "hire_date", label: "Hire date", type: "date" },
        {
          key: "pay_type",
          label: "Pay type",
          type: "select",
          options: opts(["per_mile", "percentage", "flat", "hourly"], "—"),
        },
        { key: "pay_rate", label: "Pay rate", type: "number" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        { key: "full_name", text: "Driver", className: "text-fg" },
        { key: "driver_code", text: "Code", className: "font-mono" },
        { key: "status", text: "Status", render: (d) => <StatusPill status={d.status} /> },
        { key: "phone", text: "Phone" },
        {
          key: "cdl_expiration",
          text: "CDL",
          render: (d) => <ExpiryBadge date={d.cdl_expiration} />,
        },
        {
          key: "medical_card_expiration",
          text: "Medical",
          render: (d) => <ExpiryBadge date={d.medical_card_expiration} />,
        },
        {
          key: "pay_rate",
          text: "Pay",
          render: (d) => (d.pay_rate ? `${d.pay_rate} ${label(d.pay_type)}` : "—"),
        },
      ]}
      tabs={(d) => {
        const mine = loads.filter((l) => l.driver_id === d.id);
        const rev = mine.reduce((s, l) => s + loadRevenue(l), 0);
        const pay = mine.reduce((s, l) => s + Number(l.driver_pay), 0);
        const miles = mine.reduce((s, l) => s + Number(l.miles ?? 0), 0);
        return [
          {
            key: "perf",
            text: "Performance",
            body: (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ["Loads", mine.length],
                    ["Miles", miles.toLocaleString()],
                    ["Revenue", money(rev)],
                    ["Driver pay", money(pay)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
                      <div className="font-mono text-[10px] text-mut uppercase">{k}</div>
                      <div className="num mt-1 text-base text-fg">{v}</div>
                    </div>
                  ))}
                </div>
                {mine.map((l) => (
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
              </div>
            ),
          },
          {
            key: "docs",
            text: "Documents",
            body: (
              <DocumentsPanel
                entityType="driver"
                entityId={d.id}
                docTypes={["cdl", "medical_card", "mvr", "drug_test", "application", "other"]}
              />
            ),
          },
          {
            key: "checkin",
            text: "Phone check-in",
            body: <CheckinLinkPanel driverId={d.id} driverName={d.full_name} phone={d.phone} />,
          },
        ];
      }}
    />
  );
}
