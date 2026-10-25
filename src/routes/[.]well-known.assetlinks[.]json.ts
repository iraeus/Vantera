import { createFileRoute } from "@tanstack/react-router";

/**
 * Android "Digital Asset Links" file. It lets the Android app open this site full screen (no address bar).
 * Paste the JSON from PWABuilder in Settings > App downloads. Until then this returns an empty list.
 */
async function handle(): Promise<Response> {
  let body = "[]";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabaseAdmin as any).from("app_settings").select("value").eq("key", "assetlinks_json").maybeSingle();
    const text = String(data?.value ?? "").trim();
    if (text) {
      JSON.parse(text); // only serve valid JSON
      body = text;
    }
  } catch {
    body = "[]";
  }
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
}

export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: { handlers: { GET: () => handle() } },
});
