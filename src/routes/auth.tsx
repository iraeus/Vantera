import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapFirstAdmin, needsBootstrap } from "@/lib/admin.functions";
import { signInWithUsername } from "@/lib/username-auth.functions";
import { ThemeDots } from "@/components/display-menu";
import { BootScreen } from "@/components/boot-screen";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Vantera TMS" },
      { name: "description", content: "Private staff sign-in for the Vantera dispatch system." },
      { property: "og:title", content: "Sign in · Vantera TMS" },
      {
        property: "og:description",
        content: "Private staff sign-in for the Vantera dispatch system.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "forgot" | "setup" | "mfa";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [entering, setEntering] = useState(false);

  const checkBootstrap = useServerFn(needsBootstrap);
  const runBootstrap = useServerFn(bootstrapFirstAdmin);
  const runUsernameSignIn = useServerFn(signInWithUsername);
  const { data: bootstrap } = useQuery({
    queryKey: ["needs-bootstrap"],
    queryFn: () => checkBootstrap(),
  });

  /** After the password step: go to the app, or ask for the 6-digit code when two-step login is on. */
  async function afterSignIn() {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: f } = await supabase.auth.mfa.listFactors();
      const factor = f?.totp?.[0];
      if (!factor)
        throw new Error(
          "Two-step login is on for this account, but no authenticator was found. Ask an administrator.",
        );
      setFactorId(factor.id);
      setCode("");
      setMode("mfa");
      return;
    }
    setEntering(true);
    navigate({ to: "/", replace: true });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void afterSignIn().catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const result = await runUsernameSignIn({ data: { username, password } });
        const { error } = await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });
        if (error) throw error;
        await afterSignIn();
      } else if (mode === "mfa") {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code: code.trim(),
        });
        if (error) throw error;
        setEntering(true);
        navigate({ to: "/", replace: true });
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Reset link sent. Check your inbox.");
        setMode("signin");
      } else {
        await runBootstrap({ data: { email, password, fullName } });
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Administrator account created.");
        setEntering(true);
        navigate({ to: "/", replace: true });
      }
    } catch (err) {
      setEntering(false);
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const isSetup = mode === "setup";

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      {entering && <BootScreen label="Signing you in…" />}
      <div className="fixed right-4 top-4">
        <ThemeDots />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="overflow-hidden rounded-2xl ring-1 ring-line">
            <img src="/logo-lockup.png" alt="Vantera TMS" className="block w-full" />
          </div>
          <div className="mt-3 text-center font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
            Private dispatch system
          </div>
        </div>

        <form onSubmit={onSubmit} className="rounded-xl bg-panel p-5 ring-1 ring-line">
          <h1 className="font-display text-lg font-semibold tracking-tight text-fg">
            {mode === "signin" && "Sign in"}
            {mode === "mfa" && "Two-step verification"}
            {mode === "forgot" && "Reset password"}
            {mode === "setup" && "Create administrator"}
          </h1>
          <p className="mt-1 text-xs text-mut">
            {mode === "signin" && "Sign in with your username and password."}
            {mode === "mfa" && "Open your authenticator app and enter the 6-digit code."}
            {mode === "forgot" && "We'll email you a link to set a new password."}
            {mode === "setup" && "First-time setup: this becomes the Super Admin account."}
          </p>

          <div className="mt-4 space-y-3">
            {isSetup && (
              <Field
                label="Full name"
                value={fullName}
                onChange={setFullName}
                type="text"
                placeholder="Jane Dispatcher"
              />
            )}
            {mode === "mfa" && (
              <Field
                label="6-digit code"
                value={code}
                onChange={setCode}
                type="text"
                placeholder="123456"
              />
            )}
            {mode === "signin" && (
              <Field
                label="Username"
                value={username}
                onChange={setUsername}
                type="text"
                placeholder="your.username"
              />
            )}
            {mode !== "mfa" && mode !== "signin" && (
              <Field
                label="Work email"
                value={email}
                onChange={setEmail}
                type="email"
                placeholder="you@company.com"
              />
            )}
            {mode !== "forgot" && mode !== "mfa" && (
              <Field
                label="Password"
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="••••••••"
              />
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-5 h-9 w-full rounded-lg bg-accent text-xs font-medium text-ink disabled:opacity-60"
          >
            {busy
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : mode === "mfa"
                  ? "Verify"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Create account"}
          </button>

          <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-mut">
            {mode === "signin" ? (
              <button type="button" onClick={() => setMode("forgot")} className="hover:text-fg">
                Forgot password
              </button>
            ) : mode === "mfa" ? (
              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  setMode("signin");
                }}
                className="hover:text-fg"
              >
                Use a different account
              </button>
            ) : (
              <button type="button" onClick={() => setMode("signin")} className="hover:text-fg">
                Back to sign in
              </button>
            )}
            {bootstrap?.needsBootstrap && mode !== "setup" && (
              <button type="button" onClick={() => setMode("setup")} className="text-accent">
                First-time setup
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label: text,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{text}</span>
      <input
        required
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
      />
    </label>
  );
}
