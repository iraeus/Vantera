import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  logActivity,
  useFuel,
  useMaintenance,
  useMaintenancePlans,
  useTrailers,
  useTrucks,
  type Fuel,
  type Maintenance,
  type MaintenancePlan,
  type Trailer,
  type Truck,
} from "@/hooks/useTms";
import { usePermissions } from "@/hooks/usePermissions";
import { assetMiles, buildPlanRows, localDate, planStatus, STANDARD_PLANS, type PlanStatus } from "@/lib/maintenance";
import { EmptyRow, GhostButton, Modal, PrimaryButton, TextInput } from "./ui-kit";
import { money } from "@/lib/tms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plansTable = () => (supabase as any).from("maintenance_plans");

export function PlanStatusChip({ status }: { status: PlanStatus }) {
  const map = {
    overdue: ["bg-problem/12 text-problem", "OVERDUE"],
    due_soon: ["bg-transit/15 text-transit", "DUE SOON"],
    ok: ["bg-delivered/12 text-delivered", "OK"],
    no_baseline: ["bg-panel2 text-mut", "NO BASELINE"],
  } as const;
  const [cls, text] = map[status.state];
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{text}</span>;
}

/** Current mileage of a truck or trailer: the best known odometer. */
export function milesFor(
  assetType: "truck" | "trailer",
  asset: Truck | Trailer | undefined,
  records: Maintenance[],
  fuel: Fuel[],
): number | null {
  if (!asset) return null;
  const odos = [
    ...records.filter((r) => r.asset_type === assetType && r.asset_id === asset.id).map((r) => r.odometer),
    ...(assetType === "truck" ? fuel.filter((f) => f.truck_id === asset.id).map((f) => f.odometer) : []),
  ];
  return assetMiles(asset.mileage, odos);
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    ["maintenance", "maintenance-plans", "trucks", "trailers", "activity"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

/** Record that a planned service was done: logs a maintenance record and resets the plan's baseline. */
export function RecordServiceModal({
  plan,
  assetLabel,
  assetMileage,
  currentMiles,
  onClose,
}: {
  plan: MaintenancePlan;
  assetLabel: string;
  assetMileage: number | null;
  currentMiles: number | null;
  onClose: () => void;
}) {
  const refresh = useInvalidate();
  const [date, setDate] = useState(localDate());
  const [odo, setOdo] = useState(currentMiles ? String(currentMiles) : "");
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const odometer = odo ? Number(odo) : null;
    const { error } = await supabase.from("maintenance_records").insert({
      asset_type: plan.asset_type,
      asset_id: plan.asset_id,
      service_date: date,
      description: plan.name,
      cost: Number(cost || 0),
      odometer,
      vendor: vendor || null,
    });
    if (error) {
      setBusy(false);
      return void toast.error(error.message);
    }
    const { error: e2 } = await plansTable()
      .update({ last_service_date: date, last_service_miles: odometer ?? plan.last_service_miles })
      .eq("id", plan.id);
    if (e2) toast.error(e2.message);
    if (odometer && odometer > (assetMileage ?? 0)) {
      if (plan.asset_type === "truck") await supabase.from("trucks").update({ mileage: odometer }).eq("id", plan.asset_id);
      else await supabase.from("trailers").update({ mileage: odometer }).eq("id", plan.asset_id);
    }
    await logActivity(plan.asset_type, plan.asset_id, `Service done: ${plan.name}${cost ? ` (${money(Number(cost))})` : ""}`);
    setBusy(false);
    refresh();
    toast.success(`${plan.name} recorded for ${assetLabel}`);
    onClose();
  }

  return (
    <Modal title={`${plan.name} · ${assetLabel}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Date done" type="date" value={date} onChange={setDate} />
        <TextInput label="Odometer (miles)" type="number" value={odo} onChange={setOdo} />
        <TextInput label="Cost (optional)" type="number" value={cost} onChange={setCost} />
        <TextInput label="Vendor (optional)" value={vendor} onChange={setVendor} />
      </div>
      <p className="mt-3 text-[11px] text-mut">This adds a maintenance record and restarts the schedule from today.</p>
      <div className="mt-3 flex justify-end">
        <PrimaryButton onClick={save} disabled={busy || !date}>{busy ? "Saving…" : "Save service"}</PrimaryButton>
      </div>
    </Modal>
  );
}

/** Schedule section shown at the top of a truck's or trailer's Maintenance tab. */
export function MaintenancePlans({ assetType, assetId }: { assetType: "truck" | "trailer"; assetId: string }) {
  const { data: plans = [] } = useMaintenancePlans();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { data: records = [] } = useMaintenance();
  const { data: fuel = [] } = useFuel();
  const { can } = usePermissions();
  const refresh = useInvalidate();
  const canEdit = can("maintenance", "edit");
  const [recording, setRecording] = useState<MaintenancePlan | null>(null);
  const [f, setF] = useState({ name: "", miles: "", days: "", date: "", odo: "" });

  const mine = plans.filter((p) => p.asset_type === assetType && p.asset_id === assetId);
  const asset = assetType === "truck" ? trucks.find((t) => t.id === assetId) : trailers.find((t) => t.id === assetId);
  const miles = milesFor(assetType, asset, records, fuel);

  async function add() {
    if (!f.name.trim()) return void toast.error("Give the service a name");
    if (!f.miles && !f.days) return void toast.error("Set how often: miles, days, or both");
    const { error } = await plansTable().insert({
      asset_type: assetType,
      asset_id: assetId,
      name: f.name.trim(),
      interval_miles: f.miles ? Number(f.miles) : null,
      interval_days: f.days ? Number(f.days) : null,
      last_service_date: f.date || null,
      last_service_miles: f.odo ? Number(f.odo) : null,
    });
    if (error) return void toast.error(error.message);
    setF({ name: "", miles: "", days: "", date: "", odo: "" });
    refresh();
    toast.success("Service plan added");
  }

  async function addStandard() {
    const names = new Set(mine.map((p) => p.name));
    const rows = STANDARD_PLANS[assetType]
      .filter((p) => !names.has(p.name))
      .map((p) => ({ asset_type: assetType, asset_id: assetId, ...p }));
    if (rows.length === 0) return void toast.message("Standard plans are already added");
    const { error } = await plansTable().insert(rows);
    if (error) return void toast.error(error.message);
    refresh();
    toast.success("Standard plans added. Record each last service to start tracking.");
  }

  async function remove(id: string) {
    if (!confirm("Remove this service plan?")) return;
    const { error } = await plansTable().delete().eq("id", id);
    if (error) return void toast.error(error.message);
    refresh();
  }

  return (
    <div className="mb-5 space-y-3 border-b border-line pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-semibold">Service schedule</span>
        <span className="text-[11px] text-mut">Current mileage: {miles ? miles.toLocaleString() : "unknown"}</span>
        {canEdit && <span className="ml-auto"><GhostButton onClick={addStandard}>Add standard plans</GhostButton></span>}
      </div>
      {mine.length === 0 && <EmptyRow text="No service plans yet. Add the standard plans or create your own." />}
      {mine.map((p) => {
        const st = planStatus(p, miles);
        return (
          <div key={p.id} className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-fg">{p.name}</span>
              <PlanStatusChip status={st} />
              <span className="text-[11px] text-mut">{st.text}</span>
              {canEdit && (
                <span className="ml-auto flex gap-1.5">
                  <GhostButton onClick={() => setRecording(p)}>Record service</GhostButton>
                  <GhostButton onClick={() => remove(p.id)}>Remove</GhostButton>
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-mut">
              every {[p.interval_miles ? `${p.interval_miles.toLocaleString()} mi` : null, p.interval_days ? `${p.interval_days} days` : null].filter(Boolean).join(" or ")}
              {p.last_service_date || p.last_service_miles != null
                ? ` · last ${p.last_service_date ?? "—"}${p.last_service_miles != null ? ` at ${p.last_service_miles.toLocaleString()} mi` : ""}`
                : ""}
            </div>
          </div>
        );
      })}
      {canEdit && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <div className="col-span-2"><TextInput label="New service plan" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="e.g. Transmission fluid" /></div>
          <TextInput label="Every (miles)" type="number" value={f.miles} onChange={(v) => setF({ ...f, miles: v })} />
          <TextInput label="Every (days)" type="number" value={f.days} onChange={(v) => setF({ ...f, days: v })} />
          <TextInput label="Last done (date)" type="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          <TextInput label="Last done (miles)" type="number" value={f.odo} onChange={(v) => setF({ ...f, odo: v })} />
          <div className="col-span-2"><PrimaryButton onClick={add} className="w-full">Add plan</PrimaryButton></div>
        </div>
      )}
      {recording && (
        <RecordServiceModal
          plan={recording}
          assetLabel={assetType === "truck" ? `Truck ${(asset as Truck | undefined)?.truck_number ?? ""}` : `Trailer ${(asset as Trailer | undefined)?.trailer_number ?? ""}`}
          assetMileage={asset?.mileage ?? null}
          currentMiles={miles}
          onClose={() => setRecording(null)}
        />
      )}
    </div>
  );
}

/** One row per plan with its computed status (used by the Maintenance page, dispatch and the command center). */
export function usePlanRows() {
  const { data: plans = [] } = useMaintenancePlans();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { data: records = [] } = useMaintenance();
  const { data: fuel = [] } = useFuel();
  return useMemo(() => buildPlanRows({ plans, trucks, trailers, records, fuel }), [plans, trucks, trailers, records, fuel]);
}
