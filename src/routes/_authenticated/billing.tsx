import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { logLoadEvent, useAllLoads, useBrokers, useDrivers, type Driver } from "@/hooks/useTms";
import { usePermissions } from "@/hooks/usePermissions";
import { useBusinessSettings } from "@/hooks/useSettings";
import { billingBuckets, invoiceCsvRows, sumAmount, type BillRow } from "@/lib/billing";
import { detentionFor, fmtHours } from "@/lib/detention";
import { money } from "@/lib/tms";
import { localDate } from "@/lib/maintenance";
import { EmptyRow, GhostButton, Modal, Panel, PanelHeader, PrimaryButton, SelectInput, TextInput } from "@/components/ui-kit";
import { exportCsv, fmtTime } from "@/components/entity-kit";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Billing — Vantera TMS" },
      { name: "description", content: "POD, invoicing, unpaid and overdue loads, detention to bill." },
    ],
  }),
  component: BillingPage,
});

type LoadUpdate = Database["public"]["Tables"]["loads"]["Update"];
type Action = { kind: "invoice" | "paid"; row: BillRow } | null;

function BillingPage() {
  const { data: loads = [], isLoading } = useAllLoads();
  const { data: brokers = [] } = useBrokers();
  const { data: drivers = [] } = useDrivers();
  const { can } = usePermissions();
  const { detentionFreeHours, detentionRate } = useBusinessSettings();
  const qc = useQueryClient();
  const canEdit = can("accounting", "edit");
  const [action, setAction] = useState<Action>(null);

  const live = useMemo(() => loads.filter((l) => !l.deleted_at), [loads]);
  const b = useMemo(() => billingBuckets(live, brokers), [live, brokers]);

  const detention = useMemo(
    () =>
      live
        .filter((l) => l.status !== "cancelled" && Number(l.detention ?? 0) === 0)
        .map((l) => ({ l, d: detentionFor(l, detentionFreeHours, detentionRate) }))
        .filter((x) => x.d.billableHours > 0)
        .sort((a, c) => c.d.billableHours - a.d.billableHours),
    [live, detentionFreeHours, detentionRate],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["loads"] });

  async function setStatus(row: BillRow, values: LoadUpdate, eventText: string) {
    const { error } = await supabase.from("loads").update(values).eq("id", row.load.id);
    if (error) return void toast.error(error.message);
    await logLoadEvent(row.load.id, "status_change", eventText);
    refresh();
    toast.success(`${row.load.load_number}: ${eventText}`);
  }

  async function addDetention(id: string, number: string, amount: number) {
    const { error } = await supabase.from("loads").update({ detention: amount }).eq("id", id);
    if (error) return void toast.error(error.message);
    await logLoadEvent(id, "detention", `Detention added: ${money(amount)}`);
    refresh();
    toast.success(`${number}: detention ${money(amount)} added`);
  }

  const tiles = [
    { text: "Waiting for POD", rows: b.waitingPod, tone: "text-transit" },
    { text: "Ready to invoice", rows: b.toInvoice, tone: "text-fg" },
    { text: "Unpaid invoices", rows: b.unpaid, tone: "text-fg" },
    { text: "Overdue", rows: b.overdue, tone: "text-problem" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.text} className="rounded-xl bg-panel p-4 ring-1 ring-line">
            <div className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{t.text}</div>
            <div className={`num mt-1 font-display text-2xl font-semibold ${t.rows.length ? t.tone : ""}`}>{t.rows.length}</div>
            <div className="num text-xs text-mut">{money(sumAmount(t.rows))}</div>
          </div>
        ))}
      </div>

      {canEdit && <DriverPayPanel drivers={drivers} />}

      {isLoading && <EmptyRow text="Loading…" />}

      <Section
        title="Waiting for POD"
        hint="Delivered more than a day ago but the proof of delivery is not marked as received."
        rows={b.waitingPod}
        empty="No missing PODs."
        columns={["Load", "Broker", "Delivered", "Amount", ""]}
        render={(r) => [
          r.load.load_number,
          r.broker,
          `${fmtTime(r.load.delivered_at)} (${r.ageDays}d ago)`,
          money(r.amount),
          canEdit ? <GhostButton key="a" onClick={() => setStatus(r, { status: "pod_received" }, "POD received")}>POD received</GhostButton> : null,
        ]}
      />

      <Section
        title="Ready to invoice"
        hint="POD received, no invoice yet."
        rows={b.toInvoice}
        empty="Nothing waiting to be invoiced."
        columns={["Load", "Broker", "Delivered", "Amount", ""]}
        actions={
          <GhostButton onClick={() => exportCsv("ready-to-invoice.csv", invoiceCsvRows(b.toInvoice))}>Export CSV</GhostButton>
        }
        render={(r) => [
          r.load.load_number,
          r.broker,
          `${fmtTime(r.load.delivered_at)} (${r.ageDays}d ago)`,
          money(r.amount),
          canEdit ? <GhostButton key="a" onClick={() => setAction({ kind: "invoice", row: r })}>Mark invoiced</GhostButton> : null,
        ]}
      />

      <Section
        title="Unpaid invoices"
        hint="Due date = invoice date + the broker's payment terms (set on the Broker CRM page)."
        rows={b.unpaid}
        empty="No unpaid invoices."
        columns={["Load", "Broker", "Invoice", "Due", "Amount", ""]}
        actions={
          <GhostButton onClick={() => exportCsv("unpaid-invoices.csv", invoiceCsvRows(b.unpaid))}>Export CSV</GhostButton>
        }
        render={(r) => [
          r.load.load_number,
          r.broker,
          `${r.load.invoice_number ?? "—"} · ${r.load.invoice_date ?? "—"}`,
          r.daysOverdue > 0 ? <span key="d" className="text-problem">{r.dueDate} ({r.daysOverdue}d late)</span> : r.dueDate,
          money(r.amount),
          canEdit ? <GhostButton key="a" onClick={() => setAction({ kind: "paid", row: r })}>Mark paid</GhostButton> : null,
        ]}
      />

      <Panel>
        <PanelHeader title="Detention to bill" count={`${detention.length}`}>
          <Link to="/settings" className="text-xs text-accent">Free time & rate</Link>
        </PanelHeader>
        <p className="px-4 pt-3 text-[11px] text-mut">
          Time at pickup or delivery beyond {detentionFreeHours} free hours, measured from the status changes (arrived, picked up, delivered).
          {!detentionRate && " Set an hourly rate in Settings to see the dollar amount."}
        </p>
        {detention.length === 0 ? (
          <EmptyRow text="No detention found on loads without a detention charge." />
        ) : (
          <div className="divide-y divide-line/60">
            {detention.map(({ l, d }) => (
              <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs">
                <span className="font-mono text-fg">{l.load_number}</span>
                <span className="text-mut">pickup {fmtHours(d.pickupHours)} · delivery {fmtHours(d.deliveryHours)}</span>
                <span className="text-fg">{d.billableHours} billable h</span>
                {d.amount !== null && <span className="num text-fg">{money(d.amount)}</span>}
                {canEdit && d.amount !== null && (
                  <span className="ml-auto"><GhostButton onClick={() => addDetention(l.id, l.load_number, d.amount as number)}>Add to load</GhostButton></span>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {action && (
        <ActionModal
          action={action}
          onClose={() => setAction(null)}
          onSave={async (values, text) => {
            await setStatus(action.row, values, text);
            setAction(null);
          }}
        />
      )}
    </div>
  );
}

function DriverPayPanel({ drivers }: { drivers: Driver[] }) {
  return (
    <Panel>
      <PanelHeader title="Driver type and gross share" count={`${drivers.length} drivers`} />
      <p className="px-4 pt-3 text-[11px] text-mut">
        Choose company drivers or owner-operators. Set an owner-operator gross percentage to calculate driver share in the Dispatch Board and Gross Board.
      </p>
      <div className="divide-y divide-line/60">
        {drivers
          .slice()
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
          .map((driver) => (
            <DriverPayRow key={driver.id} driver={driver} />
          ))}
      </div>
    </Panel>
  );
}

function DriverPayRow({ driver }: { driver: Driver }) {
  const queryClient = useQueryClient();
  const [driverType, setDriverType] = useState(driver.driver_type ?? "owner_operator");
  const [percentage, setPercentage] = useState(
    driver.pay_type === "percentage" && Number(driver.pay_rate) > 0
      ? String(driver.pay_rate)
      : "",
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const pct = Number(percentage);
    if (driverType === "owner_operator" && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      toast.error("Enter an owner-operator share from 0 to 100 percent.");
      return;
    }
    setSaving(true);
    const values =
      driverType === "owner_operator"
        ? { driver_type: driverType, pay_type: "percentage", pay_rate: pct }
        : { driver_type: driverType };
    const { error } = await supabase.from("drivers").update(values).eq("id", driver.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    toast.success(`${driver.full_name} accounting settings saved`);
  }

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(150px,1fr)_180px_170px_100px] sm:items-end">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-fg">{driver.full_name}</div>
        <div className="mt-0.5 text-[10px] text-mut">{driver.driver_code ?? driver.unit_number ?? "Driver"}</div>
      </div>
      <SelectInput
        label="Driver type"
        value={driverType}
        onChange={setDriverType}
        options={[
          { value: "company_driver", text: "Company driver" },
          { value: "owner_operator", text: "Owner operator" },
        ]}
      />
      {driverType === "owner_operator" ? (
        <TextInput
          label="Gross share (%)"
          type="number"
          value={percentage}
          onChange={setPercentage}
          placeholder="e.g. 90"
        />
      ) : (
        <div className="pb-2 text-[11px] text-mut">Company pay is entered on each load.</div>
      )}
      <PrimaryButton disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save"}
      </PrimaryButton>
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
  empty,
  columns,
  render,
  actions,
}: {
  title: string;
  hint: string;
  rows: BillRow[];
  empty: string;
  columns: string[];
  render: (r: BillRow) => React.ReactNode[];
  actions?: React.ReactNode;
}) {
  return (
    <Panel>
      <PanelHeader title={title} count={`${rows.length}`}>{actions}</PanelHeader>
      <p className="px-4 pt-3 text-[11px] text-mut">{hint}</p>
      {rows.length === 0 ? (
        <EmptyRow text={empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                {columns.map((c, i) => <th key={i} className="px-4 py-2 font-normal">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.load.id} className="border-b border-line/50">
                  {render(r).map((cell, i) => <td key={i} className="px-4 py-2.5">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ActionModal({
  action,
  onClose,
  onSave,
}: {
  action: NonNullable<Action>;
  onClose: () => void;
  onSave: (values: LoadUpdate, text: string) => Promise<void>;
}) {
  const isInvoice = action.kind === "invoice";
  const [number, setNumber] = useState(action.row.load.invoice_number ?? action.row.load.load_number);
  const [date, setDate] = useState(localDate());
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`${isInvoice ? "Mark invoiced" : "Mark paid"} · ${action.row.load.load_number}`} onClose={onClose}>
      <div className="space-y-3">
        {isInvoice && <TextInput label="Invoice number" value={number} onChange={setNumber} />}
        <TextInput label={isInvoice ? "Invoice date" : "Payment date"} type="date" value={date} onChange={setDate} />
        <div className="flex justify-end">
          <PrimaryButton
            disabled={busy || !date}
            onClick={async () => {
              setBusy(true);
              await onSave(
                isInvoice
                  ? { status: "billing", invoice_number: number || null, invoice_date: date }
                  : { status: "paid", paid_date: date },
                isInvoice ? `Invoiced (${number || "no number"})` : "Marked paid",
              );
              setBusy(false);
            }}
          >
            {busy ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
