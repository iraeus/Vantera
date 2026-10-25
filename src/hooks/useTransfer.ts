import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tbl } from "./useShifts";
import { progressIndex, type TOption, type TProgress, type TRow, type TShop, type TStep } from "@/lib/transfer";

export type TTemplate = {
  id: string;
  kind: "file" | "text";
  title: string;
  description: string | null;
  category: string | null;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime: string | null;
  version: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
export type THistory = { id: string; row_id: string; step_label: string | null; text: string; changed_by: string | null; created_at: string };

async function load<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

const POLL = 15_000; // other people's changes appear within 15 seconds

export function useTransferData() {
  const steps = useQuery({ queryKey: ["tr-steps"], refetchInterval: POLL, retry: 1, queryFn: () => load<TStep>(tbl("transfer_steps").select("*").order("sort_order")) });
  const options = useQuery({ queryKey: ["tr-options"], refetchInterval: POLL, retry: 1, queryFn: () => load<TOption>(tbl("transfer_options").select("*").order("sort_order")) });
  const rows = useQuery({ queryKey: ["tr-rows"], refetchInterval: POLL, retry: 1, queryFn: () => load<TRow>(tbl("transfer_rows").select("*").order("created_at", { ascending: true }).limit(2000)) });
  const progress = useQuery({ queryKey: ["tr-progress"], refetchInterval: POLL, retry: 1, queryFn: () => load<TProgress>(tbl("transfer_progress").select("*").limit(20000)) });
  const shops = useQuery({ queryKey: ["tr-shops"], retry: 1, queryFn: () => load<TShop>(tbl("transfer_shops").select("*").order("name")) });
  const templates = useQuery({ queryKey: ["tr-templates"], retry: 1, queryFn: () => load<TTemplate>(tbl("transfer_templates").select("*").order("sort_order").order("created_at")) });
  const idx = useMemo(() => progressIndex(progress.data ?? []), [progress.data]);
  return {
    steps: steps.data ?? [],
    options: options.data ?? [],
    rows: rows.data ?? [],
    progress: progress.data ?? [],
    shops: shops.data ?? [],
    templates: templates.data ?? [],
    idx,
    loading: steps.isLoading || rows.isLoading,
    missingTables: steps.isError || rows.isError,
  };
}

export function useTransferHistory(rowId: string | null) {
  return useQuery({
    queryKey: ["tr-history", rowId],
    enabled: !!rowId,
    refetchInterval: POLL,
    queryFn: () => load<THistory>(tbl("transfer_history").select("*").eq("row_id", rowId).order("created_at", { ascending: false }).limit(100)),
  });
}

export function useTransferActions() {
  const qc = useQueryClient();
  const refresh = (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ...keys: string[]): Promise<boolean> {
    const { error } = await p;
    if (error) {
      toast.error(error.message);
      return false;
    }
    await refresh(...keys);
    return true;
  }

  return {
    /** Choose a status for a driver and step. Shows instantly, then saves. */
    async setOption(rowId: string, stepId: string, optionId: string): Promise<boolean> {
      qc.setQueryData<TProgress[]>(["tr-progress"], (old = []) => [
        ...old.filter((p) => !(p.row_id === rowId && p.step_id === stepId)),
        { row_id: rowId, step_id: stepId, option_id: optionId, updated_by: null, updated_at: new Date().toISOString() },
      ]);
      const ok = await run(tbl("transfer_progress").upsert({ row_id: rowId, step_id: stepId, option_id: optionId }, { onConflict: "row_id,step_id" }), "tr-progress", "tr-history");
      if (!ok) await refresh("tr-progress");
      return ok;
    },
    addRows: (rows: { driver_id: string | null; driver_name: string; truck_label: string | null; driver_phone?: string | null; driver_email?: string | null }[]) =>
      run(tbl("transfer_rows").insert(rows), "tr-rows"),
    /** Creates a plain record in the Drivers list for a driver that was only typed on the board, and links it. */
    async createInDrivers(row: TRow): Promise<boolean> {
      const { data: found } = await supabase.from("drivers").select("id").ilike("full_name", row.driver_name).limit(1);
      let driverId = found?.[0]?.id as string | undefined;
      if (!driverId) {
        const { data, error } = await supabase
          .from("drivers")
          .insert({ full_name: row.driver_name, phone: row.driver_phone ?? null, email: row.driver_email ?? null })
          .select("id")
          .single();
        if (error) {
          toast.error(error.message);
          return false;
        }
        driverId = data.id;
      }
      const ok = await run(tbl("transfer_rows").update({ driver_id: driverId }).eq("id", row.id), "tr-rows");
      if (ok) await qc.invalidateQueries({ queryKey: ["drivers"] });
      return ok;
    },
    updateRow: (id: string, patch: Partial<TRow>) => run(tbl("transfer_rows").update(patch).eq("id", id), "tr-rows", "tr-history"),
    deleteRow: (id: string) => run(tbl("transfer_rows").delete().eq("id", id), "tr-rows"),
    saveShop: (shop: { name: string; email: string | null; location: string | null; phone: string | null }) => run(tbl("transfer_shops").insert(shop), "tr-shops"),
    deleteShop: (id: string) => run(tbl("transfer_shops").delete().eq("id", id), "tr-shops"),

    // setup (steps and choices)
    addStep: async (label: string, sort: number) => {
      const { data, error } = await tbl("transfer_steps").insert({ label, sort_order: sort }).select().single();
      if (error) return void toast.error(error.message);
      await tbl("transfer_options").insert([
        { step_id: data.id, label: "Not started", tone: "neutral", is_default: true, sort_order: 1 },
        { step_id: data.id, label: "Done", tone: "good", is_done: true, sort_order: 2 },
      ]);
      await refresh("tr-steps", "tr-options");
    },
    updateStep: (id: string, patch: Partial<TStep>) => run(tbl("transfer_steps").update(patch).eq("id", id), "tr-steps"),
    deleteStep: (id: string) => run(tbl("transfer_steps").delete().eq("id", id), "tr-steps", "tr-options", "tr-progress"),
    addOption: (stepId: string, sort: number) => run(tbl("transfer_options").insert({ step_id: stepId, label: "New choice", tone: "neutral", sort_order: sort }), "tr-options"),
    updateOption: (id: string, patch: Partial<TOption>) => run(tbl("transfer_options").update(patch).eq("id", id), "tr-options"),
    /** Only one default per step. */
    async makeDefault(stepId: string, optionId: string) {
      await tbl("transfer_options").update({ is_default: false }).eq("step_id", stepId);
      return run(tbl("transfer_options").update({ is_default: true }).eq("id", optionId), "tr-options");
    },
    deleteOption: (id: string) => run(tbl("transfer_options").delete().eq("id", id), "tr-options", "tr-progress"),

    // templates
    saveTemplate: (id: string | null, values: Partial<TTemplate>) =>
      id ? run(tbl("transfer_templates").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id), "tr-templates") : run(tbl("transfer_templates").insert(values), "tr-templates"),
    async deleteTemplate(t: TTemplate) {
      if (t.file_path) await supabase.storage.from("documents").remove([t.file_path]);
      return run(tbl("transfer_templates").delete().eq("id", t.id), "tr-templates");
    },
  };
}
