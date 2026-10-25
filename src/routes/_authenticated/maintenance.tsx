import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMaintenancePlans, useTrailers, useTrucks, type MaintenancePlan } from "@/hooks/useTms";
import { usePermissions } from "@/hooks/usePermissions";
import { planRank, STANDARD_PLANS } from "@/lib/maintenance";
import { EmptyRow, GhostButton, Panel, PanelHeader } from "@/components/ui-kit";
import { MiniSelect } from "@/components/entity-kit";
import { PlanStatusChip, RecordServiceModal, usePlanRows } from "@/components/maintenance-kit";
import { ExpiryAlerts } from "@/components/expiry-alerts";

export const Route = createFileRoute("/_authenticated/maintenance")({
  head: () => ({
    meta: [
      { title: "Maintenance — Vantera TMS" },
      { name: "description", content: "Service schedule for trucks and trailers: what is overdue and what is coming up." },
    ],
  }),
  component: MaintenancePage,
});

function MaintenancePage() {
  const rows = usePlanRows();
  const { data: plans = [], isError } = useMaintenancePlans();
  const { data: trucks = [] } = useTrucks();
  const { data: trailers = [] } = useTrailers();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const canEdit = can("maintenance", "edit");
  const [type, setType] = useState("");
  const [show, setShow] = useState("attention");
  const [recording, setRecording] = useState<(typeof rows)[number] | null>(null);

  const sorted = useMemo(
    () =>
      rows
        .filter((r) => !type || r.plan.asset_type === type)
        .filter((r) => show === "all" || r.status.state !== "ok")
        .sort((a, b) => planRank(a.status.state) - planRank(b.status.state) || (a.status.daysLeft ?? 9999) - (b.status.daysLeft ?? 9999)),
    [rows, type, show],
  );
  const count = (s: string) => rows.filter((r) => r.status.state === s).length;

  const planned = new Set(plans.map((p) => `${p.asset_type}:${p.asset_id}`));
  const noPlan = [
    ...trucks.filter((t) => !["sold", "inactive"].includes(t.status) && !planned.has(`truck:${t.id}`)).map((t) => ({ type: "truck" as const, id: t.id, label: `Truck ${t.truck_number}` })),
    ...trailers.filter((t) => !["sold", "inactive"].includes(t.status) && !planned.has(`trailer:${t.id}`)).map((t) => ({ type: "trailer" as const, id: t.id, label: `Trailer ${t.trailer_number}` })),
  ];

  async function addStandardToAll() {
    if (!confirm(`Add the standard service plans to ${noPlan.length} units? You can edit or remove them afterwards.`)) return;
    const insert = noPlan.flatMap((a) => STANDARD_PLANS[a.type].map((p) => ({ asset_type: a.type, asset_id: a.id, ...p })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("maintenance_plans").insert(insert);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["maintenance-plans"] });
    toast.success("Standard plans added. Record each unit's last service to start tracking.");
  }

  if (isError) return <EmptyRow text="The maintenance schedule table is not in the database yet. Run the two SQL files from the update pack." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Overdue" value={count("overdue")} tone="text-problem" />
        <Stat label="Due soon" value={count("due_soon")} tone="text-transit" />
        <Stat label="Need a baseline" value={count("no_baseline")} tone="text-mut" />
        <Stat label="On schedule" value={count("ok")} tone="text-delivered" />
      </div>

      <Panel>
        <PanelHeader title="Service schedule" count={`${sorted.length} shown`}>
          <MiniSelect value={type} onChange={setType} options={[{ value: "", text: "Trucks & trailers" }, { value: "truck", text: "Trucks" }, { value: "trailer", text: "Trailers" }]} />
          <MiniSelect value={show} onChange={setShow} options={[{ value: "attention", text: "Needs attention" }, { value: "all", text: "Everything" }]} />
        </PanelHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                {["Unit", "Service", "Status", "Detail", "Last service", "Next due", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.plan.id} className="border-b border-line/50">
                  <td className="px-3 py-2.5 font-medium text-fg">{r.label}</td>
                  <td className="px-3 py-2.5">{r.plan.name}</td>
                  <td className="px-3 py-2.5"><PlanStatusChip status={r.status} /></td>
                  <td className="px-3 py-2.5 text-mut">{r.status.text}</td>
                  <td className="px-3 py-2.5 text-mut">
                    {r.plan.last_service_date ?? "—"}
                    {r.plan.last_service_miles != null && <div>{r.plan.last_service_miles.toLocaleString()} mi</div>}
                  </td>
                  <td className="px-3 py-2.5 text-mut">
                    {r.status.dueDate ?? ""}
                    {r.status.dueMiles != null && <div>{r.status.dueMiles.toLocaleString()} mi</div>}
                    {!r.status.dueDate && r.status.dueMiles == null && "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit && <GhostButton onClick={() => setRecording(r)}>Record service</GhostButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <EmptyRow text={rows.length === 0 ? "No service plans yet. Add plans below, or open a truck and use its Maintenance tab." : "Nothing needs attention."} />}
        </div>
      </Panel>

      {noPlan.length > 0 && (
        <Panel>
          <PanelHeader title="Units with no service plan" count={`${noPlan.length}`}>
            {canEdit && <GhostButton onClick={addStandardToAll}>Add standard plans to all</GhostButton>}
          </PanelHeader>
          <div className="flex flex-wrap gap-1.5 p-4">
            {noPlan.map((a) => (
              <span key={`${a.type}${a.id}`} className="rounded bg-panel2 px-2 py-1 font-mono text-[11px] text-fg ring-1 ring-line">{a.label}</span>
            ))}
          </div>
        </Panel>
      )}

      <ExpiryAlerts kinds={["truck", "trailer"]} title="Truck & trailer expiries (insurance, registration, inspection)" />

      {recording && (
        <RecordServiceModal
          plan={recording.plan as MaintenancePlan}
          assetLabel={recording.label}
          assetMileage={recording.asset.mileage ?? null}
          currentMiles={recording.miles}
          onClose={() => setRecording(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-panel p-4 ring-1 ring-line">
      <div className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{label}</div>
      <div className={`num mt-1 font-display text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
