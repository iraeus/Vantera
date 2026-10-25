import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DENSITIES, THEMES, useDisplay } from "@/hooks/useDisplay";
import { label } from "@/lib/tms";
import { GhostButton, Panel, PrimaryButton, TextInput } from "@/components/ui-kit";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "My account — Vantera TMS" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { data: me } = useCurrentUser();
  const { theme, density, setTheme, setDensity } = useDisplay();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel className="space-y-2 p-4">
        <div className="font-display text-sm font-semibold">My account</div>
        <div className="text-xs text-fg">{me?.profile?.full_name ?? "—"}</div>
        <div className="text-xs text-mut">{me?.email}</div>
        <div className="font-mono text-[10px] text-mut">{me?.roles?.length ? me.roles.map(label).join(" · ") : "No role"}</div>
      </Panel>

      <Panel className="space-y-3 p-4">
        <div className="font-display text-sm font-semibold">Display</div>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <GhostButton key={t.value} active={theme === t.value} onClick={() => setTheme(t.value)}>{t.text}</GhostButton>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-mut">Text size</span>
          {DENSITIES.map((d) => (
            <GhostButton key={d.value} active={density === d.value} onClick={() => setDensity(d.value)}>{d.text}</GhostButton>
          ))}
        </div>
        <p className="text-[11px] text-mut">Saved on this computer only.</p>
      </Panel>

      <TwoStep />
      <Password />
    </div>
  );
}

type Factor = { id: string; friendly_name?: string | undefined; status: string };

function TwoStep() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.all ?? []).filter((f) => f.factor_type === "totp"));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const verified = factors.filter((f) => f.status === "verified");

  async function start() {
    setBusy(true);
    // Remove half-finished attempts first.
    for (const f of factors.filter((x) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Vantera ${new Date().toISOString().slice(0, 16)}` });
    setBusy(false);
    if (error || !data) return void toast.error(error?.message ?? "Could not start setup. Two-step login may be turned off in Supabase (Authentication > Sign In / Providers > Multi-Factor).");
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function verifyCode() {
    if (!enroll) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Two-step login is on");
    setEnroll(null);
    await load();
  }

  async function cancel() {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.id });
    setEnroll(null);
    await load();
  }

  async function turnOff(id: string) {
    if (!confirm("Turn off two-step login for your account?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return void toast.error(error.message);
    toast.success("Two-step login is off");
    await load();
  }

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="font-display text-sm font-semibold">Two-step login</div>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${verified.length ? "bg-delivered/12 text-delivered" : "bg-panel2 text-mut"}`}>{verified.length ? "ON" : "OFF"}</span>
      </div>
      <p className="text-xs text-mut">After your password, you also enter a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy…). Strongly recommended for Admin and Supervisor accounts.</p>

      {!enroll && verified.length === 0 && <PrimaryButton onClick={start} disabled={busy}>Turn on two-step login</PrimaryButton>}
      {!enroll && verified.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
          <span className="text-fg">Authenticator app</span>
          <span className="ml-auto"><GhostButton onClick={() => turnOff(f.id)}>Turn off</GhostButton></span>
        </div>
      ))}

      {enroll && (
        <div className="space-y-3 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <p className="text-xs text-fg">1. Open your authenticator app and scan this code (or type the key).</p>
          <img src={enroll.qr} alt="Scan with your authenticator app" className="mx-auto size-44 rounded-lg bg-white p-2" />
          <p className="break-all text-center font-mono text-[11px] text-mut">{enroll.secret}</p>
          <p className="text-xs text-fg">2. Enter the 6-digit code it shows:</p>
          <TextInput label="6-digit code" value={code} onChange={setCode} placeholder="123456" />
          <div className="flex gap-2">
            <PrimaryButton onClick={verifyCode} disabled={busy || code.trim().length < 6}>Confirm</PrimaryButton>
            <GhostButton onClick={cancel}>Cancel</GhostButton>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Password() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Panel className="space-y-3 p-4">
      <div className="font-display text-sm font-semibold">Change password</div>
      <TextInput label="New password (8+ characters)" type="password" value={pw} onChange={setPw} />
      <TextInput label="Repeat new password" type="password" value={pw2} onChange={setPw2} />
      <PrimaryButton
        disabled={busy || pw.length < 8 || pw !== pw2}
        onClick={async () => {
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password: pw });
          setBusy(false);
          if (error) return void toast.error(error.message);
          setPw("");
          setPw2("");
          toast.success("Password changed");
        }}
      >
        Change password
      </PrimaryButton>
    </Panel>
  );
}
