import { createServerFn } from "@tanstack/react-start";

export const DEFAULT_WINDOWS_URL = "/downloads/Vantera-Setup.exe";
export const DEFAULT_ANDROID_URL = "/downloads/Vantera.apk";

/** Public (no login): where the Windows and Android downloads are. Set in Settings > App downloads. */
export const getDownloadLinks = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any).from("app_settings").select("key,value").in("key", ["download_windows_url", "download_android_url"]);
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value;
  return {
    windows: map["download_windows_url"]?.trim() || DEFAULT_WINDOWS_URL,
    android: map["download_android_url"]?.trim() || DEFAULT_ANDROID_URL,
  };
});
