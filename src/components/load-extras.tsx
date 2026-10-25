import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logLoadEvent, type Load } from "@/hooks/useTms";
import { useBusinessSettings } from "@/hooks/useSettings";
import { tbl } from "@/hooks/useShifts";
import { detentionFor, fmtHours } from "@/lib/detention";
import { money } from "@/lib/tms";
import { GhostButton, SelectInput } from "./ui-kit";
import { DocViewer, fmtTime } from "./entity-kit";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{title}</div>
      {children}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 text-xs">
    <span className="text-mut">{k}</span>
    <span className="num text-right text-fg">{v}</span>
  </div>
);

const DOC_KINDS = [
  { value: "pod", text: "Signed POD" },
  { value: "bol", text: "BOL" },
  { value: "rate_confirmation", text: "Rate confirmation" },
  { value: "other", text: "Other" },
];

/** Extra sections in the load drawer: time at stops (detention), billing dates, photos/documents, save as template. */
export function LoadExtras({ load, canWrite }: { load: Load; canWrite: boolean }) {
  const { detentionFreeHours, detentionRate } = useBusinessSettings();
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<{ name: string; url: string } | null>(null);
  const [kind, setKind] = useState("pod");
  const [busy, setBusy] = useState(false);
  const d = detentionFor(load, detentionFreeHours, detentionRate);

  const { data: docs = [] } = useQuery({
    queryKey: ["load-docs", load.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("load_documents").select("*").eq("load_id", load.id).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  async function addDetention() {
    if (d.amount === null) return;
    const { error } = await supabase.from("loads").update({ detention: d.amount }).eq("id", load.id);
    if (error) return void toast.error(error.message);
    await logLoadEvent(load.id, "detention", `Detention added: ${money(d.amount)} (${d.billableHours} billable hours)`);
    qc.invalidateQueries({ queryKey: ["loads"] });
    qc.invalidateQueries({ queryKey: ["load-events", load.id] });
    toast.success("Detention added to the load");
  }

  async function upload(file: File) {
    setBusy(true);
    const path = `loads/${load.id}/${kind}-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const up = await supabase.storage.from("documents").upload(path, file, file.type ? { contentType: file.type } : {});
    if (up.error) {
      setBusy(false);
      return void toast.error(up.error.message);
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("load_documents").insert({ load_id: load.id, doc_type: kind, file_name: file.name, file_path: path, uploaded_by: u.user?.id ?? null });
    setBusy(false);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["load-docs", load.id] });
    toast.success("Document added");
  }

  async function preview(path: string, name: string) {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 600);
    if (error || !data) return void toast.error(error?.message ?? "Could not open file");
    setViewing({ name, url: data.signedUrl });
  }

  async function saveTemplate() {
    const name = prompt("Name this repeat lane", `${load.pickup_location ?? "?"} to ${load.delivery_location ?? "?"}`);
    if (!name) return;
    const { error } = await tbl("load_templates").insert({
      name,
      broker_id: load.broker_id,
      customer_name: load.customer_name,
      shipper: load.shipper,
      consignee: load.consignee,
      pickup_location: load.pickup_location,
      delivery_location: load.delivery_location,
      commodity: load.commodity,
      weight: load.weight,
      equipment_type: load.equipment_type,
      miles: load.miles,
      rate: load.rate,
      driver_pay: load.driver_pay,
      notes: load.notes,
    });
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["load-templates"] });
    toast.success("Template saved. Use it from the Templates button on the Load Board.");
  }

  return (
    <>
      <Block title="Time at stops">
        <div className="space-y-1.5 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <Row k="Arrived at pickup" v={fmtTime(load.pickup_arrived_at)} />
          <Row k="Left pickup" v={fmtTime(load.pickup_departed_at)} />
          <Row k="Arrived at delivery" v={fmtTime(load.delivery_arrived_at)} />
          <Row k="Left delivery" v={fmtTime(load.delivery_departed_at)} />
          <div className="my-1 border-t border-line" />
          <Row k="Time at pickup" v={fmtHours(d.pickupHours)} />
          <Row k="Time at delivery" v={fmtHours(d.deliveryHours)} />
          <Row k={`Billable (over ${detentionFreeHours}h free)`} v={`${d.billableHours} h`} />
          {d.amount !== null && <Row k="Suggested detention" v={money(d.amount)} />}
          {d.amount === null && d.billableHours > 0 && <p className="text-[11px] text-mut">Set an hourly detention rate in Settings to see the amount.</p>}
        </div>
        {canWrite && d.amount !== null && d.amount > 0 && Number(load.detention ?? 0) === 0 && (
          <div className="mt-2"><GhostButton onClick={addDetention}>Add {money(d.amount)} detention to this load</GhostButton></div>
        )}
        <p className="mt-1.5 text-[11px] text-mut">Times are recorded automatically when the status changes.</p>
      </Block>

      <Block title="Billing">
        <div className="space-y-1.5 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <Row k="Delivered" v={fmtTime(load.delivered_at)} />
          <Row k="Invoice number" v={load.invoice_number ?? "—"} />
          <Row k="Invoice date" v={load.invoice_date ?? "—"} />
          <Row k="Paid on" v={load.paid_date ?? "—"} />
        </div>
      </Block>

      <Block title="Photos & documents">
        <div className="space-y-1.5">
          {docs.length === 0 && <p className="text-xs text-mut">Nothing uploaded yet. Drivers can send photos from their check-in link.</p>}
          {docs.map((x) => (
            <div key={x.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
              <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-mut">{x.doc_type.toUpperCase()}</span>
              <span className="truncate text-fg">{x.file_name}</span>
              <span className="ml-auto"><GhostButton onClick={() => preview(x.file_path, x.file_name)}>View</GhostButton></span>
            </div>
          ))}
        </div>
        {canWrite && (
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1"><SelectInput label="Add a file" value={kind} onChange={setKind} options={DOC_KINDS} /></div>
            <label className={`flex h-9 cursor-pointer items-center rounded-lg bg-accent/12 px-3 text-xs font-medium text-accent ring-1 ring-accent/30 ${busy ? "opacity-50" : ""}`}>
              {busy ? "Uploading…" : "Choose file"}
              <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            </label>
          </div>
        )}
      </Block>

      {canWrite && <div><GhostButton onClick={saveTemplate}>Save this lane as a template</GhostButton></div>}
      {viewing && <DocViewer name={viewing.name} url={viewing.url} onClose={() => setViewing(null)} />}
    </>
  );
}
