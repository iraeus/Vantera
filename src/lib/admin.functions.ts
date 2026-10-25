import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APP_ROLES } from "@/lib/tms";

const roleEnum = z.enum(APP_ROLES);

/** True when no staff account exists yet — enables one-time first-admin setup. */
export const needsBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return { needsBootstrap: (count ?? 0) === 0 };
});

/** One-time creation of the first Super Admin. Refuses once any account exists. */
export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string; fullName: string }) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        fullName: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0)
      throw new Error("Setup already completed. Ask an administrator for access.");

    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Super Admin only (the main owner of the system). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isSuperAdmin(context: { supabase: any; userId: string }) {
  const { data: ok } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "super_admin",
  });
  return !!ok;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  if (!(await isSuperAdmin(context))) throw new Error("Only the Super Admin can change roles.");
}
/** Regular admins may not edit, disable or reset the password of a Super Admin account. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanManageTarget(context: { supabase: any; userId: string }, targetId: string) {
  if (targetId === context.userId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", targetId)
    .eq("role", "super_admin");
  if (data && data.length > 0 && !(await isSuperAdmin(context))) {
    throw new Error("Only the Super Admin can change a Super Admin account.");
  }
}

/** Admin-only: create a staff account with a role. No public registration exists. */
export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      username: string;
      email?: string;
      password: string;
      fullName: string;
      jobTitle?: string;
      role: string;
    }) =>
      z
        .object({
          username: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9._-]{3,32}$/),
          email: z.string().trim().email().or(z.literal("")).optional(),
          password: z.string().min(8),
          fullName: z.string().min(1),
          jobTitle: z.string().optional(),
          role: roleEnum,
        })
        .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Only administrators can create accounts.");
    if (data.role === "super_admin" || data.role === "admin") await assertSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingUsername, error: usernameError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username.trim().toLowerCase())
      .maybeSingle();
    if (usernameError) throw new Error(usernameError.message);
    if (existingUsername) throw new Error("That username is already in use.");
    const username = data.username.trim().toLowerCase();
    const accountEmail = data.email?.trim() || `${username}@login.vantera.invalid`;
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: accountEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, username },
    });
    if (error) throw new Error(error.message);

    const userId = created.user.id;
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ username, job_title: data.jobTitle ?? null })
      .eq("id", userId);
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(profileError.message);
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role });
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(roleError.message);
    }
    return { ok: true };
  });

/** Super Admin only: change a staff member's role. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; role: string }) =>
    z.object({ userId: z.string().uuid(), role: roleEnum }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot change your own role.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: activate or deactivate a staff member. */
export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; isActive: boolean }) =>
    z.object({ userId: z.string().uuid(), isActive: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Only administrators can change accounts.");
    if (data.userId === context.userId && !data.isActive)
      throw new Error("You cannot disable your own account.");
    await assertCanManageTarget(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: data.isActive })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.isActive ? "none" : "876000h",
    });
    if (banErr) throw new Error(banErr.message);
    return { ok: true };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
  if (!isAdmin) throw new Error("Only administrators can manage staff.");
}

/** Admin-only: staff list with real last sign-in times from the auth system. */
export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    return data.users.map((u) => ({ id: u.id, last_sign_in_at: u.last_sign_in_at ?? null }));
  });

/** Admin-only: edit a staff member's details. */
export const updateStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      userId: string;
      username: string;
      fullName: string;
      email: string;
      phone?: string;
      jobTitle?: string;
      department?: string;
    }) =>
      z
        .object({
          userId: z.string().uuid(),
          username: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9._-]{3,32}$/),
          fullName: z.string().min(1),
          email: z.string().trim().email().or(z.literal("")),
          phone: z.string().optional(),
          jobTitle: z.string().optional(),
          department: z.string().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await assertCanManageTarget(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingUsername, error: usernameError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username.trim().toLowerCase())
      .neq("id", data.userId)
      .maybeSingle();
    if (usernameError) throw new Error(usernameError.message);
    if (existingUsername) throw new Error("That username is already in use.");
    const username = data.username.trim().toLowerCase();
    const accountEmail = data.email.trim() || `${username}@login.vantera.invalid`;
    const { error: e1 } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email: accountEmail,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, username },
    });
    if (e1) throw new Error(e1.message);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.fullName,
        email: accountEmail,
        username,
        phone: data.phone || null,
        job_title: data.jobTitle || null,
        department: data.department || null,
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: set a new password for a staff member. */
export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; password: string }) =>
    z.object({ userId: z.string().uuid(), password: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await assertCanManageTarget(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
