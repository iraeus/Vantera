import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfiles, type Profile } from "@/hooks/useTms";
import { ACTIONS, MODULES, usePermissions, useRolePermissions } from "@/hooks/usePermissions";
import { APP_ROLES, label } from "@/lib/tms";
import {
  EmptyRow,
  GhostButton,
  Modal,
  Panel,
  PanelHeader,
  PrimaryButton,
  SelectInput,
  TextInput,
} from "@/components/ui-kit";
import { MiniSelect, SearchBox, exportCsv, fmtTime } from "@/components/entity-kit";
import {
  createStaffUser,
  listStaff,
  resetStaffPassword,
  setUserActive,
  setUserRole,
  updateStaff,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({
    meta: [
      { title: "Staff & Roles — Vantera TMS" },
      { name: "description", content: "Manage staff accounts, roles and permissions." },
      { property: "og:title", content: "Staff & Roles — Vantera TMS" },
      { property: "og:description", content: "Manage staff accounts, roles and permissions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StaffPage,
});

const roleOpts = APP_ROLES.map((r) => ({ value: r, text: label(r) }));
const staffEmail = (email: string | null, missing = "—") =>
  email?.endsWith("@login.vantera.invalid") ? missing : email || missing;

function StaffPage() {
  const [tab, setTab] = useState<"staff" | "perms">("staff");
  const { me } = usePermissions();
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <GhostButton active={tab === "staff"} onClick={() => setTab("staff")}>
          Staff
        </GhostButton>
        {me?.isSuperAdmin && (
          <GhostButton active={tab === "perms"} onClick={() => setTab("perms")}>
            Role permissions
          </GhostButton>
        )}
      </div>
      {tab === "staff" || !me?.isSuperAdmin ? <StaffList /> : <PermMatrix />}
    </div>
  );
}

function useRoles() {
  return useQuery({
    queryKey: ["user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

function StaffList() {
  const { can, me } = usePermissions();
  const isAdmin = !!me?.isAdmin;
  const isSuperAdmin = !!me?.isSuperAdmin;
  const qc = useQueryClient();
  const { data: profiles = [], isLoading } = useProfiles();
  const { data: roles = [] } = useRoles();
  const listFn = useServerFn(listStaff);
  const { data: logins = [] } = useQuery({
    queryKey: ["staff-logins"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });
  const setRoleFn = useServerFn(setUserRole);
  const setActiveFn = useServerFn(setUserActive);
  const [search, setSearch] = useState("");
  const [roleF, setRoleF] = useState("");
  const [activeF, setActiveF] = useState("");
  const [modal, setModal] = useState<{ kind: "new" } | { kind: "edit" | "pw"; p: Profile } | null>(
    null,
  );

  const roleOf = (id: string) => roles.find((r) => r.user_id === id)?.role ?? "";
  const lastLogin = (id: string) => logins.find((l) => l.id === id)?.last_sign_in_at ?? null;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter(
      (p) =>
        (!roleF || roleOf(p.id) === roleF) &&
        (!activeF || String(p.is_active) === activeF) &&
        (!q ||
          [p.full_name, p.username, p.email, p.phone, p.job_title, p.department].some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(q),
          )),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, roles, search, roleF, activeF]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["profiles"] });
    qc.invalidateQueries({ queryKey: ["user-roles"] });
    qc.invalidateQueries({ queryKey: ["staff-logins"] });
    qc.invalidateQueries({ queryKey: ["current-user"] });
  };

  async function changeRole(p: Profile, role: string) {
    try {
      await setRoleFn({ data: { userId: p.id, role } });
      toast.success("Role updated");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function toggleActive(p: Profile) {
    try {
      await setActiveFn({ data: { userId: p.id, isActive: !p.is_active } });
      toast.success(p.is_active ? "Account disabled" : "Account enabled");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <Panel>
        <PanelHeader title="Staff" count={`${shown.length} / ${profiles.length}`}>
          <SearchBox value={search} onChange={setSearch} placeholder="Name, email, title…" />
          <MiniSelect
            value={roleF}
            onChange={setRoleF}
            options={[{ value: "", text: "All roles" }, ...roleOpts]}
          />
          <MiniSelect
            value={activeF}
            onChange={setActiveF}
            options={[
              { value: "", text: "All" },
              { value: "true", text: "Active" },
              { value: "false", text: "Disabled" },
            ]}
          />
          {can("users", "export") && (
            <GhostButton
              onClick={() =>
                exportCsv(
                  "staff.csv",
                  shown.map((p) => ({
                    Name: p.full_name,
                    Username: p.username,
                    Email: staffEmail(p.email, ""),
                    Phone: p.phone,
                    Title: p.job_title,
                    Department: p.department,
                    Role: label(roleOf(p.id)),
                    Active: p.is_active ? "Yes" : "No",
                    "Last login": lastLogin(p.id) ?? "",
                  })),
                )
              }
            >
              Export CSV
            </GhostButton>
          )}
          {isAdmin && (
            <PrimaryButton onClick={() => setModal({ kind: "new" })}>+ New staff</PrimaryButton>
          )}
        </PanelHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                {[
                  "Name",
                  "Username",
                  "Email",
                  "Phone",
                  "Title",
                  "Department",
                  "Role",
                  "Status",
                  "Last login",
                  "",
                ].map((h) => (
                  <th key={h} className="px-4 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b border-line/50">
                  <td className="px-4 py-2.5">
                    {p.full_name ?? "—"}
                    {p.id === me?.id && <span className="ml-1 text-mut">(you)</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono">{p.username ?? "—"}</td>
                  <td className="px-4 py-2.5">{staffEmail(p.email, "Not provided")}</td>
                  <td className="px-4 py-2.5">{p.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">{p.job_title ?? "—"}</td>
                  <td className="px-4 py-2.5">{p.department ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {isSuperAdmin && p.id !== me?.id ? (
                      <MiniSelect
                        value={roleOf(p.id)}
                        onChange={(v) => changeRole(p, v)}
                        options={
                          roleOf(p.id) ? roleOpts : [{ value: "", text: "No role" }, ...roleOpts]
                        }
                      />
                    ) : (
                      label(roleOf(p.id))
                    )}
                  </td>
                  <td className={`px-4 py-2.5 ${p.is_active ? "text-delivered" : "text-problem"}`}>
                    {p.is_active ? "Active" : "Disabled"}
                  </td>
                  <td className="px-4 py-2.5">
                    {isAdmin ? (lastLogin(p.id) ? fmtTime(lastLogin(p.id)) : "Never") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {isAdmin && (
                      <div className="flex gap-1">
                        <GhostButton onClick={() => setModal({ kind: "edit", p })}>
                          Edit
                        </GhostButton>
                        <GhostButton onClick={() => setModal({ kind: "pw", p })}>
                          Reset password
                        </GhostButton>
                        {p.id !== me?.id && (
                          <GhostButton onClick={() => toggleActive(p)}>
                            {p.is_active ? "Disable" : "Enable"}
                          </GhostButton>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isLoading && <EmptyRow text="Loading…" />}
          {!isLoading && shown.length === 0 && <EmptyRow text="No staff match." />}
        </div>
      </Panel>
      {modal?.kind === "new" && <NewStaff onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === "edit" && (
        <EditStaff p={modal.p} onClose={() => setModal(null)} onDone={refresh} />
      )}
      {modal?.kind === "pw" && <ResetPw p={modal.p} onClose={() => setModal(null)} />}
    </>
  );
}

function NewStaff({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(createStaffUser);
  const { me } = usePermissions();
  const pickable = me?.isSuperAdmin
    ? roleOpts
    : roleOpts.filter((o) => o.value !== "super_admin" && o.value !== "admin");
  const [f, setF] = useState({
    fullName: "",
    username: "",
    email: "",
    password: "",
    jobTitle: "",
    role: "dispatcher",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="New staff account" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await fn({ data: f });
            toast.success("Account created");
            onDone();
            onClose();
          } catch (err) {
            toast.error((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <TextInput label="Full name *" value={f.fullName} onChange={set("fullName")} required />
        <TextInput
          label="Username * · 3–32 letters, numbers, . _ -"
          value={f.username}
          onChange={set("username")}
          required
        />
        <TextInput label="Email (optional)" type="email" value={f.email} onChange={set("email")} />
        <p className="-mt-2 text-[11px] text-mut">
          Leave blank for username-only sign-in. An admin can reset the password if needed.
        </p>
        <TextInput
          label="Temporary password * (min 8)"
          type="password"
          value={f.password}
          onChange={set("password")}
          required
        />
        <TextInput label="Job title" value={f.jobTitle} onChange={set("jobTitle")} />
        <SelectInput label="Role" value={f.role} onChange={set("role")} options={pickable} />
        <div className="flex justify-end">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function EditStaff({
  p,
  onClose,
  onDone,
}: {
  p: Profile;
  onClose: () => void;
  onDone: () => void;
}) {
  const fn = useServerFn(updateStaff);
  const [f, setF] = useState({
    fullName: p.full_name ?? "",
    username: p.username ?? "",
    email: p.email?.endsWith("@login.vantera.invalid") ? "" : (p.email ?? ""),
    phone: p.phone ?? "",
    jobTitle: p.job_title ?? "",
    department: p.department ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title={`Edit ${p.full_name ?? p.username ?? "staff member"}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await fn({ data: { userId: p.id, ...f } });
            toast.success("Saved");
            onDone();
            onClose();
          } catch (err) {
            toast.error((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <TextInput label="Full name *" value={f.fullName} onChange={set("fullName")} required />
        <TextInput
          label="Username * · 3–32 letters, numbers, . _ -"
          value={f.username}
          onChange={set("username")}
          required
        />
        <TextInput label="Email (optional)" type="email" value={f.email} onChange={set("email")} />
        <p className="-mt-2 text-[11px] text-mut">
          Leave blank to remove email sign-in and use the username only.
        </p>
        <TextInput label="Phone" value={f.phone} onChange={set("phone")} />
        <TextInput label="Job title" value={f.jobTitle} onChange={set("jobTitle")} />
        <TextInput label="Department" value={f.department} onChange={set("department")} />
        <div className="flex justify-end">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ResetPw({ p, onClose }: { p: Profile; onClose: () => void }) {
  const fn = useServerFn(resetStaffPassword);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Reset password — ${p.full_name ?? p.username ?? "staff member"}`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await fn({ data: { userId: p.id, password: pw } });
            toast.success("Password updated");
            onClose();
          } catch (err) {
            toast.error((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <TextInput
          label="New password (min 8)"
          type="password"
          value={pw}
          onChange={setPw}
          required
        />
        <div className="flex justify-end">
          <PrimaryButton type="submit" disabled={busy || pw.length < 8}>
            {busy ? "Saving…" : "Set password"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function PermMatrix() {
  const { me } = usePermissions();
  const isAdmin = !!me?.isSuperAdmin; // only the Super Admin may edit permissions
  const qc = useQueryClient();
  const { data: perms = [] } = useRolePermissions();
  const [role, setRole] = useState<string>("dispatcher");
  const row = (m: string) => perms.find((p) => p.role === role && p.module === m);

  async function toggle(m: string, a: string) {
    const cur = row(m);
    const key = `can_${a}` as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next = { role, module: m, ...(cur ?? {}), [key]: !(cur as any)?.[key] } as any;
    delete next.updated_at;
    const { error } = await supabase
      .from("role_permissions")
      .upsert(next, { onConflict: "role,module" });
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["role-permissions"] });
  }

  return (
    <Panel>
      <PanelHeader title="Role permissions">
        <MiniSelect value={role} onChange={setRole} options={roleOpts} />
      </PanelHeader>
      {role === "super_admin" ? (
        <EmptyRow text="Super Admin always has full access to every module." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                <th className="px-4 py-2 font-normal">Module</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="px-4 py-2 text-center font-normal">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m} className="border-b border-line/50">
                  <td className="px-4 py-2">{label(m)}</td>
                  {ACTIONS.map((a) => (
                    <td key={a} className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        disabled={!isAdmin}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        checked={Boolean((row(m) as any)?.[`can_${a}`])}
                        onChange={() => toggle(m, a)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!isAdmin && <EmptyRow text="Only the Super Admin can change permissions." />}
        </div>
      )}
    </Panel>
  );
}
