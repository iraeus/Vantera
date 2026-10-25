import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

/** Resolve a staff username privately, then let Supabase Auth verify the password. */
export const signInWithUsername = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) =>
    z
      .object({
        username: z.string().trim().min(1).max(254),
        password: z.string().min(1).max(256),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = data.username.trim();
    let email = identifier.includes("@") ? identifier.toLowerCase() : "";

    if (!email) {
      const username = identifier.toLowerCase();
      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("username", username)
        .maybeSingle();
      if (error) throw new Error("Sign-in is temporarily unavailable. Please try again.");
      email = profile?.email?.trim().toLowerCase() ?? `unknown-${username}@invalid.vantera`;
    }

    const projectUrl = process.env["SUPABASE_URL"];
    const publishableKey =
      process.env["SUPABASE_PUBLISHABLE_KEY"] ??
      process.env["SUPABASE_ANON_KEY"] ??
      process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
    if (!projectUrl || !publishableKey) {
      throw new Error("Sign-in is temporarily unavailable. Please try again.");
    }

    const authClient = createClient<Database>(projectUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: result, error } = await authClient.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (error || !result.session) throw new Error("Username or password is incorrect.");

    return {
      accessToken: result.session.access_token,
      refreshToken: result.session.refresh_token,
    };
  });
