import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { useLoads, type Load } from "@/hooks/useTms";
import { normalizeLoadStops, type LoadStop, DEFAULT_STOP_TIMEZONE } from "@/lib/load-stops";

const SOUND_KEY = "vantera:load-time-alert-sound";
const REMINDER_PREFIX = "vantera:load-time-reminder:";
const UPCOMING = new Set(["booked", "upcoming"]);
const ACTIVE = new Set([
  "booked", "upcoming", "assigned", "dispatched", "at_pickup", "loading",
  "picked_up", "in_transit", "at_delivery", "unloading",
]);

function appointmentInstant(date: string, time: string, timezone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const target = Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2]),
  );
  let instant = target;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone || DEFAULT_STOP_TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(instant));
      const part = (kind: string) => Number(parts.find((item) => item.type === kind)?.value ?? 0);
      const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
      const correction = target - represented;
      instant += correction;
      if (correction === 0) break;
    }
  } catch {
    return null;
  }
  return new Date(instant);
}

function remindersForLoad(load: Load) {
  const events: { key: string; kind: "pickup" | "drop"; name: string; date: string; time: string; timezone: string }[] = [];
  const stops = normalizeLoadStops(load.stops);
  const add = (stop: LoadStop, kind: "pickup" | "drop") => {
    if (!stop.appointment_date || !stop.appointment_time) return;
    events.push({
      key: `${load.id}:${kind}:${stop.id}:${stop.appointment_date}T${stop.appointment_time}:${stop.timezone}`,
      kind,
      name: stop.facility_name || [stop.city, stop.state].filter(Boolean).join(", ") || load.load_number,
      date: stop.appointment_date,
      time: stop.appointment_time,
      timezone: stop.timezone || DEFAULT_STOP_TIMEZONE,
    });
  };

  if (stops.length) {
    for (const stop of stops) {
      if (stop.stop_type === "pickup") add(stop, "pickup");
      if (stop.stop_type === "delivery") add(stop, "drop");
    }
  } else {
    const fallback = (id: string, kind: "pickup" | "drop", date: string | null, time: string | null, name: string | null) => {
      if (!date || !time) return;
      events.push({
        key: `${load.id}:${kind}:${id}:${date}T${time}:${DEFAULT_STOP_TIMEZONE}`,
        kind,
        name: name || load.load_number,
        date,
        time,
        timezone: DEFAULT_STOP_TIMEZONE,
      });
    };
    fallback("legacy-pickup", "pickup", load.pickup_date, load.pickup_time, load.shipper);
    fallback("legacy-drop", "drop", load.delivery_date, load.delivery_time, load.consignee);
  }
  return events;
}

function playWarningSound(context: AudioContext) {
  if (context.state === "suspended") void context.resume();
  const start = context.currentTime;
  [880, 660, 880].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.22;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.19);
  });
}

export function LoadTimeAlerts() {
  const { data: loads = [] } = useLoads();
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem(SOUND_KEY) !== "false");
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      if (!audio.current) audio.current = new AudioContext();
      if (audio.current.state === "suspended") void audio.current.resume();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const load of loads) {
        const canNotifyPickup = UPCOMING.has(load.status);
        const canNotifyDrop = ACTIVE.has(load.status);
        if (!canNotifyPickup && !canNotifyDrop) continue;
        for (const event of remindersForLoad(load)) {
          if (event.kind === "pickup" && !canNotifyPickup) continue;
          if (event.kind === "drop" && !canNotifyDrop) continue;
          const due = appointmentInstant(event.date, event.time, event.timezone);
          if (!due) continue;
          const remaining = due.getTime() - now;
          if (remaining <= 0 || remaining > 2 * 60 * 60 * 1000) continue;
          const storageKey = REMINDER_PREFIX + event.key;
          if (localStorage.getItem(storageKey)) continue;
          localStorage.setItem(storageKey, new Date().toISOString());

          const kind = event.kind === "pickup" ? "Pickup" : "Drop-off";
          const timeZoneLabel = new Intl.DateTimeFormat("en-US", {
            timeZone: event.timezone,
            timeZoneName: "short",
          }).format(due).split(" ").at(-1) ?? "local time";
          const message = `${kind} for load ${load.load_number} at ${event.name} is within 2 hours (${event.time} ${timeZoneLabel}).`;
          toast.warning(message, { duration: 12_000 });

          if (soundEnabled) {
            if (!audio.current) audio.current = new AudioContext();
            playWarningSound(audio.current);
          }
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification(`Load ${kind} reminder`, { body: message, tag: storageKey });
            } catch {
              // The in-app alert and sound still work if the browser blocks desktop notifications.
            }
          }
        }
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [loads, soundEnabled]);

  async function configureAlerts() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") toast.success("Desktop load notifications enabled");
        else toast("In-app load alerts remain on; desktop notifications were not enabled.");
      } catch {
        toast("In-app load alerts remain on; desktop notifications are unavailable.");
      }
      if (soundEnabled) {
        if (!audio.current) audio.current = new AudioContext();
        await audio.current.resume();
        playWarningSound(audio.current);
      }
      return;
    }
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem(SOUND_KEY, String(next));
    if (next) {
      if (!audio.current) audio.current = new AudioContext();
      await audio.current.resume();
      playWarningSound(audio.current);
      toast.success("Load warning sound is on");
    } else toast("Load warning sound is off");
  }

  return (
    <button
      type="button"
      onClick={() => void configureAlerts()}
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel2 text-mut ring-1 ring-line hover:text-fg"
      title={`${soundEnabled ? "Sound alerts on" : "Sound alerts off"}. Click to configure desktop notifications.`}
      aria-label={`${soundEnabled ? "Turn off" : "Turn on"} load warning sounds`}
    >
      {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
    </button>
  );
}
