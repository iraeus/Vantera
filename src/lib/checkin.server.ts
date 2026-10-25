/** Server-only logic for the driver check-in link (no login: the secret token in the link identifies the driver). */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ACTIVE_STATUSES } from "./tms";
import { minutesLate, nextUpdateAt, parseIntervals } from "./intervals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as any;

/** Statuses a driver may set from the phone, in the order a normal load goes. */
export const DRIVER_STEPS = ["at_pickup", "loading", "picked_up", "in_transit", "at_delivery", "unloading", "delivered"] as const;

export type CheckinView =
  | { ok: false; error: string }
  | {
      ok: true;
      driverName: string;
      load: null | {
        number: string;
        status: string;
        pickup: string | null;
        pickupDate: string | null;
        delivery: string | null;
        deliveryDate: string | null;
        location: string | null;
      };
    };

async function driverForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await admin.from("driver_checkin_tokens").select("id,driver_id,is_active").eq("token", token).maybeSingle();
  if (!data || !data.is_active) return null;
  const { data: driver } = await admin.from("drivers").select("id,full_name,status").eq("id", data.driver_id).maybeSingle();
  if (!driver || driver.status === "inactive") return null;
  return { tokenId: data.id as string, driver: driver as { id: string; full_name: string } };
}

type LoadRow = {
  id: string;
  load_number: string;
  status: string;
  pickup_location: string | null;
  pickup_date: string | null;
  delivery_location: string | null;
  delivery_date: string | null;
  current_location: string | null;
  truck_id: string | null;
  notes: string | null;
  next_update_at: string | null;
};

async function activeLoad(driverId: string): Promise<LoadRow | null> {
  const { data } = await admin
    .from("loads")
    .select("*")
    .eq("driver_id", driverId)
    .is("deleted_at", null)
    .in("status", ACTIVE_STATUSES)
    .order("pickup_date", { ascending: true, nullsFirst: false })
    .limit(1);
  return (data?.[0] ?? null) as LoadRow | null;
}

export async function getCheckin(token: string): Promise<CheckinView> {
  const found = await driverForToken(token);
  if (!found) return { ok: false, error: "This link is not valid. Ask your dispatcher for a new one." };
  const l = await activeLoad(found.driver.id);
  return {
    ok: true,
    driverName: found.driver.full_name,
    load: l
      ? { number: l.load_number, status: l.status, pickup: l.pickup_location, pickupDate: l.pickup_date, delivery: l.delivery_location, deliveryDate: l.delivery_date, location: l.current_location }
      : null,
  };
}

/** City, State from coordinates (OpenStreetMap). Falls back to the raw coordinates if the lookup fails. */
async function placeName(lat: number, lon: number): Promise<string> {
  const raw = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`, {
      headers: { "User-Agent": "VanteraTMS-checkin/1.0" },
    });
    if (!res.ok) return raw;
    const j = (await res.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    const city = a["city"] ?? a["town"] ?? a["village"] ?? a["hamlet"] ?? a["county"];
    const state = a["ISO3166-2-lvl4"]?.split("-")[1] ?? a["state"];
    return city && state ? `${city}, ${state}` : city ?? raw;
  } catch {
    return raw;
  }
}

export type CheckinInput = {
  token: string;
  status?: string | undefined;
  location?: string | undefined;
  lat?: number | undefined;
  lon?: number | undefined;
  note?: string | undefined;
  problem?: boolean | undefined;
  photo?: { dataUrl: string; name: string; kind: string } | undefined;
};

export async function submitCheckin(i: CheckinInput): Promise<{ ok: boolean; message: string; location?: string | undefined }> {
  const found = await driverForToken(i.token);
  if (!found) return { ok: false, message: "This link is not valid. Ask your dispatcher for a new one." };
  const load = await activeLoad(found.driver.id);
  if (!load) return { ok: false, message: "You have no active load right now." };

  // Basic abuse limit: at most 40 check-ins per load per hour.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("load_events").select("id", { count: "exact", head: true }).eq("load_id", load.id).eq("event_type", "driver_checkin").gte("created_at", since);
  if ((count ?? 0) >= 40) return { ok: false, message: "Too many updates in the last hour. Please call dispatch." };

  const now = new Date();
  const values: Record<string, unknown> = { last_location_update: now.toISOString() };
  const parts: string[] = [];

  let location = (i.location ?? "").trim().slice(0, 120);
  if (!location && typeof i.lat === "number" && typeof i.lon === "number" && Math.abs(i.lat) <= 90 && Math.abs(i.lon) <= 180) {
    location = await placeName(i.lat, i.lon);
  }
  if (location) {
    values["current_location"] = location;
    parts.push(`location ${location}`);
  }

  const { data: setting } = await admin.from("app_settings").select("value").eq("key", "update_intervals").maybeSingle();
  const hours = parseIntervals(setting?.value);

  if (i.status) {
    if (!(DRIVER_STEPS as readonly string[]).includes(i.status)) return { ok: false, message: "That status is not allowed from this page." };
    values["status"] = i.status;
    values["next_update_at"] = nextUpdateAt(i.status, hours, now);
    parts.push(`status ${i.status.replace(/_/g, " ")}`);
  } else if (location) {
    // A plain location ping restarts the timer for the current status.
    values["next_update_at"] = nextUpdateAt(load.status, hours, now);
  }

  const note = (i.note ?? "").trim().slice(0, 500);
  if (i.problem) {
    if (!note) return { ok: false, message: "Please describe the problem." };
    values["is_problem"] = true;
    values["problem_note"] = note;
    parts.push(`PROBLEM: ${note}`);
  } else if (note) {
    values["notes"] = [load.notes, `Driver: ${note}`].filter(Boolean).join("\n").slice(0, 2000);
    parts.push(`note "${note}"`);
  }

  if (i.photo) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(i.photo.dataUrl);
    if (!m || i.photo.dataUrl.length > 3_500_000) return { ok: false, message: "The photo is too large or not a valid image." };
    const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
    const kind = ["pod", "bol", "other"].includes(i.photo.kind) ? i.photo.kind : "other";
    const path = `loads/${load.id}/${kind}-${Date.now()}.${ext}`;
    const up = await admin.storage.from("documents").upload(path, Buffer.from(m[2] as string, "base64"), { contentType: m[1], upsert: false });
    if (up.error) return { ok: false, message: `Photo upload failed: ${up.error.message}` };
    await admin.from("load_documents").insert({ load_id: load.id, doc_type: kind, file_name: `${kind.toUpperCase()} photo from driver.${ext}`, file_path: path, uploaded_by: null });
    parts.push(`${kind.toUpperCase()} photo`);
  }

  if (parts.length === 0) return { ok: false, message: "Nothing to send." };

  const { error } = await admin.from("loads").update(values).eq("id", load.id);
  if (error) return { ok: false, message: error.message };
  if (location) {
    await admin.from("drivers").update({ current_location: location, last_location_update: now.toISOString() }).eq("id", found.driver.id);
    if (load.truck_id) await admin.from("trucks").update({ current_location: location }).eq("id", load.truck_id);
  }
  await admin.from("load_events").insert({
    load_id: load.id,
    event_type: "driver_checkin",
    description: `Driver check-in (${found.driver.full_name}): ${parts.join(" · ")}`,
    actor_id: null,
    late_minutes: minutesLate(load.next_update_at, now),
    shift_id: null,
  });
  await admin.from("driver_checkin_tokens").update({ last_used_at: now.toISOString() }).eq("id", found.tokenId);
  return { ok: true, message: "Sent. Dispatch can see it now.", location: location || undefined };
}
