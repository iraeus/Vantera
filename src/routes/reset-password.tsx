import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password · Vantera TMS" },
      { name: "description", content: "Choose a new password for your Vantera TMS staff account." },
      { property: "og:title", content: "Set a new password · Vantera TMS" },
      {
        property: "og:description",
        content: "Choose a new password for your Vantera TMS staff account.",
      },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl bg-panel p-5 ring-1 ring-line">
        <h1 className="font-display text-lg font-semibold tracking-tight text-fg">
          Set a new password
        </h1>
        <p className="mt-1 text-xs text-mut">Use at least 8 characters.</p>
        <div className="mt-4 space-y-3">
          <input
            required
            type="password"
            minLength={8}
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
          />
          <input
            required
            type="password"
            minLength={8}
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-5 h-9 w-full rounded-lg bg-accent text-xs font-medium text-ink disabled:opacity-60"
        >
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
