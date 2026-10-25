import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CrudPage } from "@/components/crud-page";
import { StatusPill } from "@/components/StatusPill";
import { DocumentsPanel } from "@/components/entity-kit";
import { GhostButton, PrimaryButton, TextInput } from "@/components/ui-kit";
import { useBrokerContacts, useBrokers, useLoads, type Broker } from "@/hooks/useTms";
import { usePermissions } from "@/hooks/usePermissions";
import { loadRevenue, money } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated/brokers")({
  validateSearch: (search: Record<string, unknown>): { open?: string } => {
    const open = search["open"];
    return typeof open === "string" ? { open } : {};
  },
  head: () => ({
    meta: [
      { title: "Broker CRM · Vantera TMS" },
      {
        name: "description",
        content: "Brokers and customers, contacts, payment terms and load history.",
      },
      { property: "og:title", content: "Broker CRM · Vantera TMS" },
      {
        property: "og:description",
        content: "Brokers and customers, contacts, payment terms and load history.",
      },
    ],
  }),
  component: BrokersPage,
});

function BrokersPage() {
  const { open } = Route.useSearch();
  const { data: brokers = [], isLoading } = useBrokers();
  const { data: loads = [] } = useLoads();
  const stats = (id: string) => {
    const mine = loads.filter((l) => l.broker_id === id);
    return { count: mine.length, rev: mine.reduce((s, l) => s + loadRevenue(l), 0), mine };
  };

  return (
    <CrudPage<Broker>
      title="Brokers"
      table="brokers"
      entityType="broker"
      module="brokers"
      queryKey="brokers"
      rows={brokers}
      initialOpenId={open}
      loading={isLoading}
      titleOf={(b) => b.name}
      subtitleOf={(b) =>
        `MC ${b.mc_number ?? "—"} · ${b.payment_terms ?? "no terms"} · ${b.is_active ? "Active" : "Inactive"}`
      }
      searchKeys={["name", "contact_name", "phone", "email", "mc_number", "dot_number"]}
      filters={[
        {
          key: "kind",
          label: "types",
          options: [
            { value: "broker", text: "Brokers" },
            { value: "customer", text: "Direct customers" },
          ],
          test: (r, v) => (v === "customer" ? r.is_customer : !r.is_customer),
        },
        {
          key: "active",
          label: "states",
          options: [
            { value: "yes", text: "Active" },
            { value: "no", text: "Inactive" },
          ],
          test: (r, v) => r.is_active === (v === "yes"),
        },
      ]}
      fields={[
        { key: "name", label: "Company name", required: true },
        { key: "contact_name", label: "Main contact" },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Email" },
        { key: "mc_number", label: "MC #" },
        { key: "dot_number", label: "DOT #" },
        { key: "address", label: "Address" },
        { key: "payment_terms", label: "Payment terms (text)" },
        { key: "payment_terms_days", label: "Pays within (days)", type: "number" },
        { key: "credit_rating", label: "Credit rating" },
        { key: "is_customer", label: "Direct customer", type: "checkbox" },
        { key: "is_active", label: "Active", type: "checkbox" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        { key: "name", text: "Company", className: "text-fg" },
        { key: "contact_name", text: "Contact" },
        { key: "phone", text: "Phone" },
        { key: "mc_number", text: "MC", className: "font-mono" },
        { key: "payment_terms", text: "Terms" },
        { key: "credit_rating", text: "Credit" },
        { key: "loads", text: "Loads", render: (b) => stats(b.id).count },
        {
          key: "revenue",
          text: "Revenue",
          render: (b) => <span className="num">{money(stats(b.id).rev)}</span>,
        },
      ]}
      tabs={(b) => [
        { key: "contacts", text: "Contacts", body: <Contacts brokerId={b.id} /> },
        {
          key: "loads",
          text: "Loads",
          body: (
            <div className="space-y-1 text-xs">
              {stats(b.id).mine.map((l) => (
                <div
                  key={l.id}
                  className="flex justify-between rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line"
                >
                  <span className="font-mono">{l.load_number}</span>
                  <span className="text-mut">
                    {l.pickup_location} → {l.delivery_location}
                  </span>
                  <span className="num">{money(loadRevenue(l))}</span>
                  <StatusPill status={l.status} />
                </div>
              ))}
              {stats(b.id).count === 0 && <div className="text-mut">No loads yet.</div>}
            </div>
          ),
        },
        {
          key: "docs",
          text: "Documents",
          body: (
            <DocumentsPanel
              entityType="broker"
              entityId={b.id}
              docTypes={["broker_agreement", "w9", "insurance", "credit_app", "other"]}
            />
          ),
        },
      ]}
    />
  );
}

function Contacts({ brokerId }: { brokerId: string }) {
  const { data = [] } = useBrokerContacts(brokerId);
  const { can } = usePermissions();
  const qc = useQueryClient();
  const empty = { name: "", title: "", phone: "", email: "" };
  const [f, setF] = useState(empty);

  async function add() {
    if (!f.name.trim()) return void toast.error("Name required");
    const { error } = await supabase.from("broker_contacts").insert({
      broker_id: brokerId,
      name: f.name,
      title: f.title || null,
      phone: f.phone || null,
      email: f.email || null,
    });
    if (error) return void toast.error(error.message);
    setF(empty);
    qc.invalidateQueries({ queryKey: ["broker-contacts", brokerId] });
    toast.success("Contact added");
  }
  async function remove(id: string) {
    const { error } = await supabase.from("broker_contacts").delete().eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["broker-contacts", brokerId] });
  }

  return (
    <div className="space-y-3">
      {can("brokers", "edit") && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <TextInput label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <TextInput label="Title" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
          <TextInput label="Phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
          <TextInput label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
          <PrimaryButton onClick={add} className="col-span-2">
            Add contact
          </PrimaryButton>
        </div>
      )}
      {data.length === 0 && <div className="text-xs text-mut">No contacts yet.</div>}
      {data.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-3 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line"
        >
          <div className="flex-1">
            <div className="text-fg">
              {c.name} {c.title && <span className="text-mut">· {c.title}</span>}
            </div>
            <div className="font-mono text-[10px] text-mut">
              {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          {can("brokers", "edit") && <GhostButton onClick={() => remove(c.id)}>Remove</GhostButton>}
        </div>
      ))}
    </div>
  );
}
