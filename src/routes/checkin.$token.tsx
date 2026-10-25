import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCheckinView, sendCheckin } from "@/lib/checkin.functions";
import { ThemeDots } from "@/components/display-menu";

export const Route = createFileRoute("/checkin/$token")({
  head: () => ({ meta: [{ title: "Driver check-in" }, { name: "robots", content: "noindex" }] }),
  component: CheckinPage,
});

const STEPS: { value: string; text: string }[] = [
  { value: "at_pickup", text: "Arrived at pickup" },
  { value: "loading", text: "Loading" },
  { value: "picked_up", text: "Loaded, leaving pickup" },
  { value: "in_transit", text: "On the road" },
  { value: "at_delivery", text: "Arrived at delivery" },
  { value: "unloading", text: "Unloading" },
  { value: "delivered", text: "Delivered" },
];

type View = Awaited<ReturnType<typeof getCheckinView>>;

/** Shrinks a phone photo so it uploads fast on mobile data (max 1600 px, JPEG). */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function CheckinPage() {
  const { token } = Route.useParams();
  const load = useServerFn(getCheckinView);
  const send = useServerFn(sendCheckin);
  const [view, setView] = useState<View | null>(null);
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("pod");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  const refresh = useCallback(async () => setView(await load({ data: { token } })), [load, token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  function gps() {
    if (!navigator.geolocation) return setMsg({ ok: false, text: "This phone cannot share its location." });
    setMsg({ ok: true, text: "Finding your location…" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lon: p.coords.longitude });
        setLocation("");
        setMsg({ ok: true, text: "Location found. Now tap a button below to send it." });
      },
      () => setMsg({ ok: false, text: "Could not get your location. Type the city instead." }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit(extra: { status?: string; problem?: boolean; photo?: File | null }) {
    setBusy(true);
    setMsg(null);
    try {
      const photo = extra.photo ? { dataUrl: await shrink(extra.photo), name: extra.photo.name, kind } : undefined;
      const r = await send({
        data: {
          token,
          status: extra.status,
          location: location || undefined,
          lat: !location && coords ? coords.lat : undefined,
          lon: !location && coords ? coords.lon : undefined,
          note: note || undefined,
          problem: extra.problem,
          photo,
        },
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        if (r.location) setLocation(r.location);
        setCoords(null);
        setNote("");
        await refresh();
      }
    } catch {
      setMsg({ ok: false, text: "Could not send. Check your signal and try again." });
    } finally {
      setBusy(false);
    }
  }

  const btn = "h-14 w-full rounded-xl text-base font-medium ring-1 disabled:opacity-50";
  const input = "w-full rounded-xl bg-panel px-4 py-3 text-base text-fg ring-1 ring-line placeholder:text-mut focus:outline-none focus:ring-accent/50";

  return (
    <div className="min-h-screen bg-ink px-4 py-5 text-fg">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-display text-lg font-semibold">Driver check-in</div>
          <ThemeDots />
        </div>

        {!view && <p className="text-mut">Loading…</p>}
        {view && !view.ok && <div className="rounded-xl bg-panel p-4 text-problem ring-1 ring-line">{view.error}</div>}

        {view && view.ok && (
          <>
            <div className="rounded-xl bg-panel p-4 ring-1 ring-line">
              <div className="text-sm text-mut">Hello,</div>
              <div className="font-display text-xl font-semibold">{view.driverName}</div>
              {view.load ? (
                <div className="mt-3 space-y-1 text-sm">
                  <div>Load <span className="font-mono font-semibold">{view.load.number}</span> · {view.load.status.replace(/_/g, " ")}</div>
                  <div className="text-mut">Pickup: {view.load.pickup ?? "—"} {view.load.pickupDate ? `(${view.load.pickupDate})` : ""}</div>
                  <div className="text-mut">Delivery: {view.load.delivery ?? "—"} {view.load.deliveryDate ? `(${view.load.deliveryDate})` : ""}</div>
                  {view.load.location && <div className="text-mut">Last location: {view.load.location}</div>}
                </div>
              ) : (
                <div className="mt-3 text-sm text-mut">You have no active load right now.</div>
              )}
            </div>

            {view.load && (
              <>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Where are you?</div>
                  <input className={input} placeholder="City, State" value={location} onChange={(e) => { setLocation(e.target.value); setCoords(null); }} />
                  <button onClick={gps} disabled={busy} className={`${btn} bg-panel2 text-fg ring-line`}>
                    {coords ? "Location found ✓" : "Use my GPS location"}
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">What is happening?</div>
                  {STEPS.map((s) => (
                    <button
                      key={s.value}
                      disabled={busy}
                      onClick={() => submit({ status: s.value })}
                      className={`${btn} ${view.load?.status === s.value ? "bg-accent text-ink ring-accent" : "bg-panel text-fg ring-line"}`}
                    >
                      {s.text}
                    </button>
                  ))}
                  <button disabled={busy || (!location && !coords)} onClick={() => submit({})} className={`${btn} bg-panel2 text-fg ring-line`}>
                    Just send my location
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Photo (POD, BOL…)</div>
                  <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
                    <option value="pod">Signed POD</option>
                    <option value="bol">BOL</option>
                    <option value="other">Other</option>
                  </select>
                  <label className={`${btn} flex cursor-pointer items-center justify-center bg-panel text-fg ring-line`}>
                    Take or choose a photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void submit({ photo: f });
                      }}
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Note or problem</div>
                  <textarea rows={3} className={input} placeholder="Delay, breakdown, anything dispatch should know" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="grid grid-cols-2 gap-2">
                    <button disabled={busy || !note.trim()} onClick={() => submit({})} className={`${btn} bg-panel text-fg ring-line`}>Send note</button>
                    <button disabled={busy || !note.trim()} onClick={() => submit({ problem: true })} className={`${btn} bg-problem text-ink ring-problem`}>Report problem</button>
                  </div>
                </div>
              </>
            )}

            {msg && (
              <div className={`rounded-xl p-4 text-base ring-1 ring-line ${msg.ok ? "bg-panel text-delivered" : "bg-panel text-problem"}`}>{msg.text}</div>
            )}
            <p className="pb-6 text-center text-xs text-mut">Keep this link private. It works like your password.</p>
          </>
        )}
      </div>
    </div>
  );
}
