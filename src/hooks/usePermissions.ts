import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "./useCurrentUser";

export const MODULES = [
  "dashboard", "loads", "updates", "dispatch", "map", "drivers", "trucks", "trailers",
  "brokers", "customers", "accounting", "invoices", "payments", "settlements", "fuel",
  "maintenance", "documents", "compliance", "safety", "reports", "tasks", "users",
  "roles", "settings", "shifts", "command", "transfer",
] as const;
export const ACTIONS = ["view", "create", "edit", "delete", "export", "approve"] as const;
export type PermModule = (typeof MODULES)[number];
export type PermAction = (typeof ACTIONS)[number];

export const useRolePermissions = () =>
  useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("*");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

/** Merges permissions across all of the signed-in user's roles. */
export function usePermissions() {
  const { data: me, isLoading: l1 } = useCurrentUser();
  const { data: perms = [], isLoading: l2 } = useRolePermissions();
  const can = (module: PermModule, action: PermAction = "view") => {
    if (!me) return false;
    if (me.roles.includes("super_admin")) return true;
    return perms.some(
      (p) => me.roles.includes(p.role) && p.module === module && p[`can_${action}` as const],
    );
  };
  return { can, loading: l1 || l2, me };
}
