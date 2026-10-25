import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Which alert channels are configured on the server (never returns the secrets themselves). */
export const alertChannelStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { channelStatus } = await import("@/lib/alert-engine.server");
    return channelStatus();
  });

/** Admin-only: send a test message to every configured channel. */
export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ok } = await context.supabase.rpc("is_supervisor", { _user_id: context.userId });
    if (!ok) return { sent: [] as string[], error: "Only administrators and supervisors can send test alerts." };
    const { sendTest } = await import("@/lib/alert-engine.server");
    return await sendTest();
  });
