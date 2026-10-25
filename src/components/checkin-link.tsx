import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { tbl } from "@/hooks/useShifts";
import { GhostButton, PrimaryButton } from "./ui-kit";

type TokenRow = { id: string; token: string; is_active: boolean; created_at: string; last_used_at: string | null };

/** Random link secret: 24 random bytes as URL-safe text (32 characters). */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Drivers tab: create, copy, text, regenerate or switch off the driver's phone check-in link. */
export function CheckinLinkPanel({ driverId, driverName, phone }: { driverId: string; driverName: string; phone?: string | null }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: row, isError } = useQuery({
    queryKey: ["checkin-token", driverId],
    queryFn: async () => {
      const { data, error } = await tbl("driver_checkin_tokens").select("*").eq("driver_id", driverId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as TokenRow | null;
    },
  });
  const url = row ? `${window.location.origin}/checkin/${row.token}` : "";

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    const { error } = await p;
    setBusy(false);
    if (error) return void toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["checkin-token", driverId] });
    toast.success(ok);
  }

  if (isError) return <p className="text-xs text-mut">Check-in links are not set up yet. Run the third SQL file (3-performance-features.sql).</p>;

  return (
    <div className="space-y-3 text-xs">
      <p className="text-mut">
        A private link the driver opens on a phone. No app and no login: they tap the status, send their location, a note, a problem or a photo of the POD.
        The load updates automatically.
      </p>
      {!row && <PrimaryButton disabled={busy} onClick={() => run(tbl("driver_checkin_tokens").insert({ driver_id: driverId, token: newToken() }), "Link created")}>Create check-in link</PrimaryButton>}
      {row && (
        <>
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${row.is_active ? "bg-delivered/12 text-delivered" : "bg-problem/12 text-problem"}`}>{row.is_active ? "ACTIVE" : "OFF"}</span>
            <span className="text-mut">{row.last_used_at ? `Last used ${new Date(row.last_used_at).toLocaleString()}` : "Never used"}</span>
          </div>
          <div className="break-all rounded-lg bg-panel2 p-3 font-mono text-[11px] text-fg ring-1 ring-line">{url}</div>
          <div className="flex flex-wrap gap-2">
            <GhostButton onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copied"))}>Copy link</GhostButton>
            {phone && (
              <a
                href={`sms:${phone}?&body=${encodeURIComponent(`${driverName}, use this link to send your updates and photos: ${url}`)}`}
                className="inline-flex h-8 items-center rounded-lg bg-panel2 px-3 text-xs text-mut ring-1 ring-line hover:text-fg"
              >
                Text it to the driver
              </a>
            )}
            <GhostButton onClick={() => run(tbl("driver_checkin_tokens").update({ is_active: !row.is_active }).eq("id", row.id), row.is_active ? "Link turned off" : "Link turned on")}>
              {row.is_active ? "Turn off" : "Turn on"}
            </GhostButton>
            <GhostButton
              onClick={() => {
                if (confirm("Create a new link? The old one stops working.")) void run(tbl("driver_checkin_tokens").update({ token: newToken(), is_active: true }).eq("id", row.id), "New link created");
              }}
            >
              New link
            </GhostButton>
          </div>
          <p className="text-[11px] text-mut">Anyone with this link can update this driver's active load, so send it only to the driver.</p>
        </>
      )}
    </div>
  );
}
