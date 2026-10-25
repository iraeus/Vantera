import { supabase } from "@/integrations/supabase/client";

/** Tables included in the manual backup. Files themselves (PDFs, photos) are not included, only their records. */
export const BACKUP_TABLES = [
  "loads", "load_events", "load_documents", "load_templates", "brokers", "broker_contacts", "drivers", "trucks", "trailers",
  "fuel_records", "maintenance_records", "maintenance_plans", "entity_documents", "activity_log",
  "shifts", "shift_times", "shift_overrides", "shift_members", "shift_cover", "shift_handoffs", "shift_handoff_reads",
  "app_settings", "profiles", "user_roles", "role_permissions",
] as const;

async function fetchAll(table: string): Promise<unknown[]> {
  const out: unknown[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from(table).select("*").range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

/** Reads every table and downloads one JSON file. Tables that do not exist yet are skipped and listed. */
export async function downloadBackup(onProgress?: (table: string) => void): Promise<{ tables: number; rows: number; skipped: string[] }> {
  const dump: Record<string, unknown[]> = {};
  const skipped: string[] = [];
  let rows = 0;
  for (const t of BACKUP_TABLES) {
    onProgress?.(t);
    try {
      dump[t] = await fetchAll(t);
      rows += dump[t]!.length;
    } catch {
      skipped.push(t);
    }
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), tables: dump }, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vantera-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { tables: Object.keys(dump).length, rows, skipped };
}
