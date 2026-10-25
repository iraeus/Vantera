import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/tms";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      const roleList = (roles ?? []).map((r) => r.role as AppRole);
      return {
        id: user.id,
        email: user.email ?? "",
        profile,
        roles: roleList,
        isAdmin: roleList.some((r) => r === "super_admin" || r === "admin"),
        isSuperAdmin: roleList.includes("super_admin"),
        /** Super Admin, Admin or Supervisor: may control shifts. */
        isSupervisor: roleList.some((r) => r === "super_admin" || r === "admin" || r === "supervisor"),
        canWrite: roleList.some((r) => r !== "viewer"),
      };
    },
  });
}
