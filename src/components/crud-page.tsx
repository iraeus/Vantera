import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyRow, GhostButton, Panel, PanelHeader, PrimaryButton } from "./ui-kit";
import { DetailDrawer, MiniSelect, SearchBox, exportCsv, ActivityPanel } from "./entity-kit";
import { RecordForm, type FieldDef } from "./record-form";
import { usePermissions, type PermModule } from "@/hooks/usePermissions";
import { logActivity } from "@/hooks/useTms";
import { useUserPreference } from "@/hooks/useUserPreference";

type Row = { id: string } & Record<string, unknown>;

export type Column<T> = {
  key: string;
  text: string;
  render?: (r: T) => ReactNode;
  className?: string;
};

export function CrudPage<T extends Row>({
  title,
  table,
  entityType,
  module,
  queryKey,
  rows,
  loading,
  fields,
  columns,
  searchKeys,
  filters,
  titleOf,
  subtitleOf,
  tabs,
  extraActions,
  initialOpenId,
}: {
  title: string;
  table: string;
  entityType: string;
  module: PermModule;
  queryKey: string;
  rows: T[];
  loading?: boolean;
  fields: FieldDef[];
  columns: Column<T>[];
  searchKeys: string[];
  filters?: {
    key: string;
    label: string;
    options: { value: string; text: string }[];
    test: (r: T, v: string) => boolean;
  }[];
  titleOf: (r: T) => string;
  subtitleOf?: (r: T) => ReactNode;
  tabs?: (r: T) => { key: string; text: string; body: ReactNode }[];
  extraActions?: (r: T) => ReactNode;
  initialOpenId?: string | undefined;
}) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [preferences, setPreferences] = useUserPreference(`list:${table}`, {
    search: "",
    filters: {} as Record<string, string>,
  });
  const search = preferences.search;
  const fv = preferences.filters;
  const setSearch = (value: string) => setPreferences((current) => ({ ...current, search: value }));
  const setFv = (update: (current: Record<string, string>) => Record<string, string>) =>
    setPreferences((current) => ({ ...current, filters: update(current.filters) }));
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  useEffect(() => {
    if (initialOpenId && rows.some((row) => row.id === initialOpenId)) setOpenId(initialOpenId);
  }, [initialOpenId, rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      for (const f of filters ?? []) {
        const v = fv[f.key] ?? "";
        if (v && !f.test(r, v)) return false;
      }
      if (!q) return true;
      return searchKeys.some((k) =>
        String(r[k] ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [rows, search, fv, filters, searchKeys]);

  async function save(values: Record<string, unknown>) {
    const isNew = editing === "new";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (supabase.from as any)(table);
    const { data, error } = isNew
      ? await q.insert(values).select("id").single()
      : await q
          .update(values)
          .eq("id", (editing as T).id)
          .select("id")
          .single();
    if (error) {
      toast.error(error.message);
      return false;
    }
    await logActivity(
      entityType,
      data.id,
      isNew ? `${title.replace(/s$/, "")} created` : "Details updated",
    );
    qc.invalidateQueries({ queryKey: [queryKey] });
    qc.invalidateQueries({ queryKey: ["activity", entityType, data.id] });
    toast.success(isNew ? "Created" : "Saved");
    return true;
  }

  async function remove(r: T) {
    if (!confirm(`Delete ${titleOf(r)}? This cannot be undone.`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)(table).delete().eq("id", r.id);
    if (error) {
      toast.error(
        error.code === "23503"
          ? "It is still linked to loads or other records — set it inactive instead."
          : error.message,
      );
      return;
    }
    setOpenId(null);
    qc.invalidateQueries({ queryKey: [queryKey] });
    toast.success("Deleted");
  }

  const baseTabs = open
    ? [
        {
          key: "overview",
          text: "Overview",
          body: (
            <div className="grid grid-cols-2 gap-x-6">
              {fields.map((f) => (
                <div
                  key={f.key}
                  className="flex justify-between gap-3 border-b border-line/60 py-1.5 text-xs"
                >
                  <span className="font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                    {f.label}
                  </span>
                  <span className="text-right">
                    {f.type === "checkbox"
                      ? open[f.key]
                        ? "Yes"
                        : "No"
                      : f.type === "select"
                        ? (f.options?.find((o) => o.value === open[f.key])?.text ?? "—")
                        : String(open[f.key] ?? "—")}
                  </span>
                </div>
              ))}
            </div>
          ),
        },
        ...(tabs ? tabs(open) : []),
        {
          key: "activity",
          text: "Notes & activity",
          body: <ActivityPanel entityType={entityType} entityId={open.id} />,
        },
      ]
    : [];

  return (
    <>
      <Panel>
        <PanelHeader title={title} count={`${shown.length} / ${rows.length}`}>
          <SearchBox value={search} onChange={setSearch} placeholder="Search…" />
          {filters?.map((f) => (
            <MiniSelect
              key={f.key}
              value={fv[f.key] ?? ""}
              onChange={(v) => setFv((s) => ({ ...s, [f.key]: v }))}
              options={[{ value: "", text: `All ${f.label}` }, ...f.options]}
            />
          ))}
          {can(module, "export") && (
            <GhostButton
              onClick={() =>
                exportCsv(
                  `${table}.csv`,
                  shown.map((r) => Object.fromEntries(columns.map((c) => [c.text, r[c.key]]))),
                )
              }
            >
              Export CSV
            </GhostButton>
          )}
          {can(module, "create") && (
            <PrimaryButton onClick={() => setEditing("new")}>+ New</PrimaryButton>
          )}
        </PanelHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.12em] text-mut uppercase">
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2 font-normal">
                    {c.text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="cursor-pointer border-b border-line/50 hover:bg-panel2"
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2.5 ${c.className ?? ""}`}>
                      {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <EmptyRow text="Loading…" />}
          {!loading && shown.length === 0 && <EmptyRow text="No records match." />}
        </div>
      </Panel>

      {open && (
        <DetailDrawer
          key={open.id}
          title={titleOf(open)}
          subtitle={subtitleOf?.(open)}
          onClose={() => setOpenId(null)}
          tabs={baseTabs}
          actions={
            <>
              {can(module, "edit") && (
                <GhostButton onClick={() => setEditing(open)}>Edit</GhostButton>
              )}
              {extraActions?.(open)}
              {can(module, "delete") && (
                <GhostButton onClick={() => remove(open)}>Delete</GhostButton>
              )}
            </>
          }
        />
      )}

      {editing && (
        <RecordForm
          title={
            editing === "new"
              ? `New ${title.replace(/s$/, "").toLowerCase()}`
              : `Edit ${titleOf(editing)}`
          }
          fields={fields}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  );
}
