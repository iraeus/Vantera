// Every Monday at 13:00 UTC: send last week's summary.
export default async () => {
  const base = process.env.URL;
  const secret = process.env.ALERTS_SECRET;
  if (!base || !secret) return new Response("ALERTS_SECRET or URL missing", { status: 200 });
  const res = await fetch(`${base}/api/public/alerts-run?type=weekly`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  return new Response(`weekly: ${res.status}`, { status: 200 });
};

export const config = { schedule: "0 13 * * 1" };
