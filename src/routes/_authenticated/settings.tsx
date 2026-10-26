import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useBusinessSettings, useSaveSetting } from "@/hooks/useSettings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DEFAULT_UPDATE_HOURS, INTERVAL_STATUSES } from "@/lib/intervals";
import { downloadBackup } from "@/lib/backup";
import { label } from "@/lib/tms";
import { alertChannelStatus, sendTestAlert } from "@/lib/alerts.functions";
import { useQuery } from "@tanstack/react-query";
import { GhostButton, Panel, PrimaryButton, TextInput } from "@/components/ui-kit";
import type { DispatchStatusConfig } from "@/lib/dispatch-statuses";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Vantera TMS" },
      { name: "description", content: "Detention, update reminders, alerts and backups." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: me } = useCurrentUser();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Detention />
      {me?.isAdmin && <DispatchStatuses />}
      <Intervals />
      <Alerts />
      <AppDownloads />
      <Backup canBackup={!!me?.isAdmin} />
    </div>
  );
}

function DispatchStatuses() {
  const { dispatchStatuses } = useBusinessSettings();
  const save = useSaveSetting();
  const [statuses, setStatuses] = useState<DispatchStatusConfig[]>(dispatchStatuses);
  const [saving, setSaving] = useState(false);

  useEffect(() => setStatuses(dispatchStatuses), [dispatchStatuses]);

  function updateStatus(
    value: DispatchStatusConfig["value"],
    patch: Partial<DispatchStatusConfig>,
  ) {
    setStatuses((current) =>
      current.map((status) => (status.value === value ? { ...status, ...patch } : status)),
    );
  }

  return (
    <Panel className="space-y-3 p-4">
      <div className="font-display text-sm font-semibold">Dispatch driver statuses</div>
      <p className="text-xs text-mut">
        Change each status name, color, and priority. Lower priority numbers appear first. Ready
        starts first and red.
      </p>
      <div className="space-y-2">
        {statuses.map((status) => (
          <div
            key={status.value}
            className="grid grid-cols-[minmax(0,1fr)_86px_54px] items-end gap-2"
          >
            <TextInput
              label={`${status.value.replaceAll("_", " ")} name`}
              value={status.name}
              onChange={(name) => updateStatus(status.value, { name })}
            />
            <TextInput
              label="Priority"
              type="number"
              value={String(status.priority)}
              onChange={(value) => updateStatus(status.value, { priority: Number(value) })}
            />
            <label className="block">
              <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
                Color
              </span>
              <input
                type="color"
                value={status.color}
                aria-label={`${status.name} color`}
                onChange={(event) => updateStatus(status.value, { color: event.target.value })}
                className="mt-1 h-9 w-full cursor-pointer rounded-lg bg-ink p-1 ring-1 ring-line"
              />
            </label>
          </div>
        ))}
      </div>
      <PrimaryButton
        disabled={saving}
        onClick={async () => {
          const priorities = statuses.map((status) => status.priority);
          if (
            statuses.some(
              (status) =>
                !status.name.trim() || !Number.isInteger(status.priority) || status.priority < 1,
            ) ||
            new Set(priorities).size !== priorities.length
          ) {
            toast.error(
              "Enter a name and a unique positive whole-number priority for every status.",
            );
            return;
          }
          setSaving(true);
          try {
            await save("dispatch_status_config", JSON.stringify(statuses));
            toast.success("Dispatch statuses saved");
          } catch (error) {
            toast.error((error as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save dispatch statuses"}
      </PrimaryButton>
    </Panel>
  );
}

function Detention() {
  const s = useBusinessSettings();
  const save = useSaveSetting();
  const [free, setFree] = useState("");
  const [rate, setRate] = useState("");
  useEffect(() => {
    setFree(String(s.detentionFreeHours));
    setRate(s.detentionRate ? String(s.detentionRate) : "");
  }, [s.detentionFreeHours, s.detentionRate]);
  return (
    <Panel className="space-y-3 p-4">
      <div className="font-display text-sm font-semibold">Detention</div>
      <p className="text-xs text-mut">
        Time waiting at a stop beyond the free hours is billable. The Billing page lists loads where
        it applies.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Free hours per stop" type="number" value={free} onChange={setFree} />
        <TextInput
          label="Rate per hour ($)"
          type="number"
          value={rate}
          onChange={setRate}
          placeholder="e.g. 50"
        />
      </div>
      <PrimaryButton
        onClick={async () => {
          try {
            await save("detention_free_hours", String(Number(free) >= 0 ? Number(free) : 2));
            await save("detention_rate", rate ? String(Number(rate)) : "");
            toast.success("Detention settings saved");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        Save
      </PrimaryButton>
    </Panel>
  );
}

function Intervals() {
  const s = useBusinessSettings();
  const save = useSaveSetting();
  const [hours, setHours] = useState<Record<string, string>>({});
  useEffect(() => {
    setHours(
      Object.fromEntries(
        INTERVAL_STATUSES.map((k) => [k, String(s.updateHours[k] ?? DEFAULT_UPDATE_HOURS[k])]),
      ),
    );
  }, [s.updateHours]);
  return (
    <Panel className="space-y-3 p-4">
      <div className="font-display text-sm font-semibold">Update reminders</div>
      <p className="text-xs text-mut">
        When a load changes status, the next check call is due after this many hours. It is set
        automatically.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {INTERVAL_STATUSES.map((k) => (
          <TextInput
            key={k}
            label={label(k)}
            type="number"
            value={hours[k] ?? ""}
            onChange={(v) => setHours({ ...hours, [k]: v })}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <PrimaryButton
          onClick={async () => {
            const out: Record<string, number> = {};
            for (const k of INTERVAL_STATUSES) {
              const n = Number(hours[k]);
              if (Number.isFinite(n) && n > 0 && n <= 72) out[k] = n;
            }
            try {
              await save("update_intervals", JSON.stringify(out));
              toast.success("Update reminders saved");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Save
        </PrimaryButton>
        <GhostButton
          onClick={() =>
            setHours(
              Object.fromEntries(
                INTERVAL_STATUSES.map((k) => [k, String(DEFAULT_UPDATE_HOURS[k])]),
              ),
            )
          }
        >
          Reset to defaults
        </GhostButton>
      </div>
    </Panel>
  );
}

function Alerts() {
  const status = useServerFn(alertChannelStatus);
  const test = useServerFn(sendTestAlert);
  const { data } = useQuery({ queryKey: ["alert-channels"], queryFn: () => status() });
  const [busy, setBusy] = useState(false);
  const row = (ok: boolean | undefined, name: string, detail: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${ok ? "bg-delivered/12 text-delivered" : "bg-panel2 text-mut"}`}
      >
        {ok ? "ON" : "OFF"}
      </span>
      <span className="text-fg">{name}</span>
      <span className="text-mut">{detail}</span>
    </div>
  );
  return (
    <Panel className="space-y-3 p-4 xl:col-span-2">
      <div className="font-display text-sm font-semibold">Alerts to Telegram and email</div>
      <p className="text-xs text-mut">
        Every 15 minutes the server checks for problem loads, late updates, loads with no driver,
        expiring documents, overdue service and overdue payments, and sends anything new as one
        message. Every Monday it sends the weekly summary. Each alert is sent once, then repeats
        only after a cool-down.
      </p>
      <div className="space-y-1.5">
        {row(
          data?.telegram,
          "Telegram",
          data?.telegram
            ? "bot token and chat are configured"
            : "add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
        )}
        {row(
          data?.email,
          "Email",
          data?.email
            ? "Resend key and recipients are configured"
            : "add RESEND_API_KEY, ALERT_EMAIL_FROM and ALERT_EMAIL_TO",
        )}
        {row(
          data?.schedule,
          "Scheduler",
          data?.schedule
            ? "ALERTS_SECRET is set"
            : "add ALERTS_SECRET so the 15-minute check can run",
        )}
      </div>
      <div className="flex items-center gap-2">
        <GhostButton
          onClick={async () => {
            setBusy(true);
            try {
              const r = await test();
              if (r.error) toast.error(r.error);
              else
                toast.success(
                  `Test sent to: ${r.sent.join(", ") || "nowhere (no channel configured)"}`,
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Send a test alert"}
        </GhostButton>
        <span className="text-[11px] text-mut">
          Setup steps are in the update pack's README (Telegram bot, Resend, environment variables).
        </span>
      </div>
    </Panel>
  );
}

function Backup({ canBackup }: { canBackup: boolean }) {
  const [busy, setBusy] = useState("");
  return (
    <Panel className="space-y-3 p-4 xl:col-span-2">
      <div className="font-display text-sm font-semibold">Backup</div>
      <p className="text-xs text-mut">
        Download a copy of your data (loads, drivers, trucks, brokers, shifts, settings and more) as
        one file. Uploaded documents and photos are not inside it. For automatic daily backups, use
        a paid Supabase plan.
      </p>
      <div>
        <PrimaryButton
          disabled={!canBackup || !!busy}
          onClick={async () => {
            try {
              const r = await downloadBackup((t) => setBusy(t));
              toast.success(
                `Backup saved: ${r.rows.toLocaleString()} records from ${r.tables} tables${r.skipped.length ? ` (skipped: ${r.skipped.join(", ")})` : ""}`,
              );
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy("");
            }
          }}
        >
          {busy ? `Reading ${busy}…` : "Download backup now"}
        </PrimaryButton>
        {!canBackup && (
          <span className="ml-3 text-[11px] text-mut">
            Only Admin and Super Admin can download a backup.
          </span>
        )}
      </div>
    </Panel>
  );
}

function AppDownloads() {
  const { raw } = useBusinessSettings();
  const save = useSaveSetting();
  const [win, setWin] = useState("");
  const [apk, setApk] = useState("");
  const [links, setLinks] = useState("");
  useEffect(() => {
    setWin(raw["download_windows_url"] ?? "");
    setApk(raw["download_android_url"] ?? "");
    setLinks(raw["assetlinks_json"] ?? "");
  }, [raw]);
  return (
    <Panel className="space-y-3 p-4 xl:col-span-2">
      <div className="font-display text-sm font-semibold">App downloads (Windows and Android)</div>
      <p className="text-xs text-mut">
        Your staff download the apps from <span className="font-mono text-fg">/download</span> on
        your website. Leave a link empty to use the default (
        <span className="font-mono">/downloads/Vantera-Setup.exe</span> and{" "}
        <span className="font-mono">/downloads/Vantera.apk</span> inside your website files). Large
        files are better hosted elsewhere (for example GitHub Releases); paste the direct link here.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput
          label="Windows installer link (.exe)"
          value={win}
          onChange={setWin}
          placeholder="https://…/Vantera-Setup.exe"
        />
        <TextInput
          label="Android app link (.apk)"
          value={apk}
          onChange={setApk}
          placeholder="https://…/Vantera.apk"
        />
      </div>
      <label className="block">
        <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
          Android link file (assetlinks.json from PWABuilder)
        </span>
        <textarea
          rows={5}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          placeholder='[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.vantera.tms","sha256_cert_fingerprints":["…"]}}]'
          className="mt-1 w-full rounded-lg bg-ink px-3 py-2 font-mono text-[11px] text-fg ring-1 ring-line placeholder:text-mut focus:outline-none"
        />
      </label>
      <p className="text-[11px] text-mut">
        The link file hides the address bar inside the Android app. It is served at
        /.well-known/assetlinks.json.
      </p>
      <PrimaryButton
        onClick={async () => {
          if (links.trim()) {
            try {
              JSON.parse(links);
            } catch {
              return void toast.error(
                "The Android link file is not valid JSON. Paste it exactly as PWABuilder gave it.",
              );
            }
          }
          try {
            await save("download_windows_url", win.trim());
            await save("download_android_url", apk.trim());
            await save("assetlinks_json", links.trim());
            toast.success("Saved");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        Save
      </PrimaryButton>
    </Panel>
  );
}
