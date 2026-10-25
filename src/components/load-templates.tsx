import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { tbl } from "@/hooks/useShifts";
import { useBrokers } from "@/hooks/useTms";
import { money } from "@/lib/tms";
import { EmptyRow, GhostButton, Modal } from "./ui-kit";

export type LoadTemplate = {
  id: string;
  name: string;
  broker_id: string | null;
  customer_name: string | null;
  shipper: string | null;
  consignee: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  commodity: string | null;
  weight: number | null;
  equipment_type: string | null;
  miles: number | null;
  rate: number | null;
  driver_pay: number | null;
  notes: string | null;
};

const s = (v: unknown) => (v == null ? "" : String(v));

/** Template -> the fields the New Load form understands (dates and load number are left for the dispatcher). */
export function templateToForm(t: LoadTemplate) {
  return {
    broker_id: s(t.broker_id),
    customer_name: s(t.customer_name),
    shipper: s(t.shipper),
    consignee: s(t.consignee),
    pickup_location: s(t.pickup_location),
    delivery_location: s(t.delivery_location),
    commodity: s(t.commodity),
    weight: s(t.weight),
    equipment_type: s(t.equipment_type),
    miles: s(t.miles),
    rate: s(t.rate),
    driver_pay: s(t.driver_pay),
    notes: s(t.notes),
  };
}

/** Pick a saved repeat lane to start a new load. */
export function TemplatesModal({
  canWrite,
  onUse,
  onClose,
}: {
  canWrite: boolean;
  onUse: (t: LoadTemplate) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: brokers = [] } = useBrokers();
  const { data: templates = [], isError } = useQuery({
    queryKey: ["load-templates"],
    queryFn: async () => {
      const { data, error } = await tbl("load_templates").select("*").order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as LoadTemplate[];
    },
  });

  async function remove(id: string) {
    if (!confirm("Delete this template?")) return;
    const { error } = await tbl("load_templates").delete().eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["load-templates"] });
  }

  return (
    <Modal wide title="Repeat-lane templates" onClose={onClose}>
      <p className="mb-3 text-xs text-mut">Pick a lane to start a new load with the broker, route, equipment and rates already filled in. Add templates from any load: open it and choose "Save this lane as a template".</p>
      {isError && <EmptyRow text="Templates are not set up yet. Run the third SQL file (3-performance-features.sql)." />}
      {!isError && templates.length === 0 && <EmptyRow text="No templates yet." />}
      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-panel2 px-3 py-2.5 ring-1 ring-line">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{t.name}</div>
              <div className="truncate text-[11px] text-mut">
                {t.pickup_location ?? "—"} → {t.delivery_location ?? "—"} · {brokers.find((b) => b.id === t.broker_id)?.name ?? t.customer_name ?? "No broker"} · {money(t.rate ?? 0)}
              </div>
            </div>
            {canWrite && <GhostButton onClick={() => onUse(t)}>Use</GhostButton>}
            {canWrite && <GhostButton onClick={() => remove(t.id)}>Delete</GhostButton>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
