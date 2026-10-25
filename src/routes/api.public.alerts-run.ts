import { createFileRoute } from "@tanstack/react-router";

/**
 * Called by the scheduler (see netlify/functions) with "Authorization: Bearer <ALERTS_SECRET>".
 *   POST /api/public/alerts-run?type=alerts   -> check and send new alerts
 *   POST /api/public/alerts-run?type=weekly   -> send last week's summary
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env["ALERTS_SECRET"];
  const header = request.headers.get("authorization") ?? "";
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  const type = new URL(request.url).searchParams.get("type") ?? "alerts";
  try {
    const engine = await import("@/lib/alert-engine.server");
    const result = type === "weekly" ? await engine.runWeekly() : await engine.runAlerts();
    return Response.json({ ok: true, type, result });
  } catch (e) {
    console.error("alerts-run failed", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/alerts-run")({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
});
