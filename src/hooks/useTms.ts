import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Load = Tables<"loads">;
export type Driver = Tables<"drivers">;
export type Truck = Tables<"trucks">;
export type Trailer = Tables<"trailers">;
export type Broker = Tables<"brokers">;
export type LoadEvent = Tables<"load_events">;
export type Profile = Tables<"profiles">;
export type Activity = Tables<"activity_log">;
export type EntityDoc = Tables<"entity_documents">;
export type Maintenance = Tables<"maintenance_records">;
export type Fuel = Tables<"fuel_records">;
export type BrokerContact = Tables<"broker_contacts">;
export type { MaintenancePlan } from "@/lib/maintenance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listTable<T>(table: string, orderBy: string): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from as any)(table).select("*").order(orderBy, { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

// Active loads only (soft-deleted loads are hidden everywhere except the load board "Deleted" tab).
export const useLoads = () =>
  useQuery({
    queryKey: ["loads"],
    queryFn: async () => (await listTable<Load>("loads", "created_at")).filter((l) => !l.deleted_at),
  });
export const useAllLoads = () =>
  useQuery({ queryKey: ["loads", "all"], queryFn: () => listTable<Load>("loads", "created_at") });
export const useDrivers = () =>
  useQuery({ queryKey: ["drivers"], queryFn: () => listTable<Driver>("drivers", "created_at") });
export const useTrucks = () =>
  useQuery({ queryKey: ["trucks"], queryFn: () => listTable<Truck>("trucks", "created_at") });
export const useTrailers = () =>
  useQuery({ queryKey: ["trailers"], queryFn: () => listTable<Trailer>("trailers", "created_at") });
export const useBrokers = () =>
  useQuery({ queryKey: ["brokers"], queryFn: () => listTable<Broker>("brokers", "created_at") });
export const useProfiles = () =>
  useQuery({ queryKey: ["profiles"], queryFn: () => listTable<Profile>("profiles", "created_at") });
export const useMaintenance = () =>
  useQuery({
    queryKey: ["maintenance"],
    queryFn: () => listTable<Maintenance>("maintenance_records", "service_date"),
  });
export const useFuel = () =>
  useQuery({ queryKey: ["fuel"], queryFn: () => listTable<Fuel>("fuel_records", "fuel_date") });

export const useLoadEvents = (loadId?: string) =>
  useQuery({
    queryKey: ["load-events", loadId],
    enabled: Boolean(loadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("load_events")
        .select("*")
        .eq("load_id", loadId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as LoadEvent[];
    },
  });

export const useRecentLoadEvents = () =>
  useQuery({
    queryKey: ["load-events", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("load_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw new Error(error.message);
      return (data ?? []) as LoadEvent[];
    },
  });

export const useActivity = (entityType: string, entityId?: string) =>
  useQuery({
    queryKey: ["activity", entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export const useEntityDocs = (entityType: string, entityId?: string) =>
  useQuery({
    queryKey: ["docs", entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_documents")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export const useAllDocCounts = () =>
  useQuery({
    queryKey: ["docs", "counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("entity_documents").select("entity_id");
      if (error) throw new Error(error.message);
      const m: Record<string, number> = {};
      for (const d of data ?? []) m[d.entity_id] = (m[d.entity_id] ?? 0) + 1;
      return m;
    },
  });

export const useBrokerContacts = (brokerId?: string) =>
  useQuery({
    queryKey: ["broker-contacts", brokerId],
    enabled: Boolean(brokerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broker_contacts")
        .select("*")
        .eq("broker_id", brokerId!)
        .order("created_at");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export async function logLoadEvent(
  loadId: string,
  eventType: string,
  description?: string,
  meta?: { late_minutes?: number | null; shift_id?: string | null },
) {
  const { data } = await supabase.auth.getUser();
  await supabase.from("load_events").insert({
    load_id: loadId,
    event_type: eventType,
    description: description ?? null,
    actor_id: data.user?.id ?? null,
    late_minutes: meta?.late_minutes ?? null,
    shift_id: meta?.shift_id ?? null,
  });
}

export async function logActivity(
  entityType: string,
  entityId: string,
  description: string,
  kind: "activity" | "note" = "activity",
) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("activity_log").insert({
    entity_type: entityType,
    entity_id: entityId,
    description,
    kind,
    actor_id: data.user.id,
  });
}

/** Every uploaded document (used for expiry alerts and missing-document checks). */
export const useAllEntityDocs = () =>
  useQuery({
    queryKey: ["docs", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("entity_documents").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

/** Maintenance schedule plans (table added by the shifts/maintenance SQL, so it is not in the generated types). */
export const useMaintenancePlans = () =>
  useQuery({
    queryKey: ["maintenance-plans"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("maintenance_plans").select("*").order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/maintenance").MaintenancePlan[];
    },
  });
