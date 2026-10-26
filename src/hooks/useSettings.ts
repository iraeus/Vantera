import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { tbl } from "./useShifts";
import { DEFAULT_UPDATE_HOURS, parseIntervals } from "@/lib/intervals";
import { readDispatchStatusConfig } from "@/lib/dispatch-statuses";

/** Company settings (table app_settings): key -> text value. */
export function useAppSettings() {
  return useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data, error } = await tbl("app_settings").select("key,value");
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value;
      return map;
    },
  });
}

export function useSaveSetting() {
  const qc = useQueryClient();
  return async (key: string, value: string) => {
    const { error } = await tbl("app_settings").upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    await qc.invalidateQueries({ queryKey: ["app-settings"] });
    if (key === "company_timezone") await qc.invalidateQueries({ queryKey: ["company-tz"] });
  };
}

/** Parsed settings with safe defaults. */
export function useBusinessSettings() {
  const { data } = useAppSettings();
  return useMemo(() => {
    const free = Number(data?.["detention_free_hours"]);
    const rate = Number(data?.["detention_rate"]);
    return {
      raw: data ?? {},
      detentionFreeHours: Number.isFinite(free) && free >= 0 ? free : 2,
      detentionRate: Number.isFinite(rate) && rate > 0 ? rate : null,
      updateHours: parseIntervals(data?.["update_intervals"]) ?? DEFAULT_UPDATE_HOURS,
      dispatchStatuses: readDispatchStatusConfig(data?.["dispatch_status_config"]),
    };
  }, [data]);
}
