// Runs every 15 minutes on Netlify and asks the app to check for new alerts.
// Needs the environment variable ALERTS_SECRET (and Netlify provides URL automatically).
export default async () => {
  const base = process.env.URL;
  const secret = process.env.ALERTS_SECRET;
  if (!base || !secret) return new Response("ALERTS_SECRET or URL missing", { status: 200 });
  const res = await fetch(`${base}/api/public/alerts-run?type=alerts`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  return new Response(`alerts-run: ${res.status}`, { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
