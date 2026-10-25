import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { homeFor } from "@/lib/tms";
import { BootScreen } from "@/components/boot-screen";

/** Sends each person to the page they use most: Dispatch, Updates, Safety, Fleet, Billing or the Command Center. */
export const Route = createFileRoute("/")({
  ssr: false,
  pendingComponent: () => <BootScreen label="Signing you in…" />,
  pendingMs: 0,
  pendingMinMs: 300,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: rows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    throw redirect({ to: homeFor((rows ?? []).map((r) => r.role)) });
  },
  component: () => null,
});
