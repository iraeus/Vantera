import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "./useCurrentUser";
import {
  addDays,
  browserTz,
  clockIn,
  currentOccurrences,
  nextOccurrence,
  validTz,
  type Shift,
  type ShiftCover,
  type ShiftMember,
  type ShiftOverride,
  type ShiftTime,
} from "@/lib/shifts";

// The shift tables are created by the SQL file, so they are not in the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tbl = (name: string): any => (supabase as any).from(name);

export type Handoff = {
  id: string;
  shift_id: string | null;
  shift_date: string | null;
  author_id: string;
  summary: string;
  open_items: string | null;
  flagged_load_ids: string[];
  created_at: string;
};
export type HandoffRead = { handoff_id: string; user_id: string; read_at: string };

async function all<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

const recent = (days: number) => addDays(new Date().toISOString().slice(0, 10), -days);

export const useShifts = () =>
  useQuery({ queryKey: ["shifts"], retry: 1, queryFn: () => all<Shift>(tbl("shifts").select("*").order("sort_order")) });
export const useShiftTimes = () =>
  useQuery({ queryKey: ["shift-times"], retry: 1, queryFn: () => all<ShiftTime>(tbl("shift_times").select("*")) });
export const useShiftOverrides = () =>
  useQuery({
    queryKey: ["shift-overrides"],
    queryFn: () => all<ShiftOverride>(tbl("shift_overrides").select("*").gte("on_date", recent(35))),
  });
export const useShiftMembers = () =>
  useQuery({ queryKey: ["shift-members"], queryFn: () => all<ShiftMember>(tbl("shift_members").select("*")) });
export const useShiftCovers = () =>
  useQuery({
    queryKey: ["shift-covers"],
    queryFn: () => all<ShiftCover>(tbl("shift_cover").select("*").gte("on_date", recent(3))),
  });
export const useHandoffs = () =>
  useQuery({
    queryKey: ["handoffs"],
    queryFn: () => all<Handoff>(tbl("shift_handoffs").select("*").order("created_at", { ascending: false }).limit(200)),
  });
export const useHandoffReads = () =>
  useQuery({ queryKey: ["handoff-reads"], queryFn: () => all<HandoffRead>(tbl("shift_handoff_reads").select("*").limit(5000)) });

export const useCompanyTz = () =>
  useQuery({
    queryKey: ["company-tz"],
    queryFn: async () => {
      const { data, error } = await tbl("app_settings").select("value").eq("key", "company_timezone").maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.value as string | undefined) ?? null;
    },
  });

/** Everything the shift screens need, with "now" refreshed every 30 seconds. */
export function useShiftClock() {
  const shiftsQ = useShifts();
  const timesQ = useShiftTimes();
  const overridesQ = useShiftOverrides();
  const membersQ = useShiftMembers();
  const coversQ = useShiftCovers();
  const tzQ = useCompanyTz();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const shifts = shiftsQ.data;
  const times = timesQ.data;
  const overrides = overridesQ.data;
  const members = membersQ.data;
  const covers = coversQ.data;
  const tzSetting = tzQ.data ?? null;
  const missingTables = [shiftsQ, timesQ].some((q) => q.isError);

  return useMemo(() => {
    const s = shifts ?? [];
    const t = times ?? [];
    const o = overrides ?? [];
    const tzValid = validTz(tzSetting);
    const tz = tzValid ?? browserTz();
    const clock = clockIn(tz, now);
    return {
      tz,
      tzIsSet: !!tzValid,
      clock,
      shifts: s,
      times: t,
      overrides: o,
      members: members ?? [],
      covers: covers ?? [],
      current: currentOccurrences(s, t, o, clock),
      next: nextOccurrence(s, t, o, clock),
      loading: shiftsQ.isLoading || timesQ.isLoading,
      missingTables,
    };
  }, [shifts, times, overrides, members, covers, tzSetting, now, shiftsQ.isLoading, timesQ.isLoading, missingTables]);
}

/** The shift folder the signed-in person belongs to. */
export function useMyShiftId(): string | null {
  const { data: me } = useCurrentUser();
  const { data: members = [] } = useShiftMembers();
  return members.find((m) => m.user_id === me?.id)?.shift_id ?? null;
}

/** Handoffs written by other shifts in the last 36 hours that this person has not marked as read. */
export function useUnreadHandoffs() {
  const { data: me } = useCurrentUser();
  const { data: handoffs = [] } = useHandoffs();
  const { data: reads = [] } = useHandoffReads();
  const myShift = useMyShiftId();
  return useMemo(() => {
    if (!me) return [];
    const since = Date.now() - 36 * 3600_000;
    const mine = new Set(reads.filter((r) => r.user_id === me.id).map((r) => r.handoff_id));
    return handoffs.filter(
      (h) => new Date(h.created_at).getTime() >= since && h.author_id !== me.id && !(myShift && h.shift_id === myShift) && !mine.has(h.id),
    );
  }, [me, handoffs, reads, myShift]);
}

/** Updates that were made while something was due (for shift performance). */
export const useUpdateEvents = () =>
  useQuery({
    queryKey: ["update-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("load_events")
        .select("shift_id,late_minutes,created_at")
        .not("late_minutes", "is", null)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

/** Turns a timestamp into the company-timezone calendar date ("YYYY-MM-DD"), plus today's date there. */
export function useLocalDate() {
  const c = useShiftClock();
  const tz = c.tz;
  return {
    today: c.clock.date,
    tz,
    localDate: useMemo(() => (iso: string) => clockIn(tz, new Date(iso)).date, [tz]),
  };
}
