import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  logActivity,
  useActivity,
  useEntityDocs,
  useFuel,
  useMaintenance,
  useProfiles,
} from "@/hooks/useTms";
import { usePermissions, type PermModule } from "@/hooks/usePermissions";
import { EmptyRow, GhostButton, Modal, PrimaryButton, SelectInput, TextInput } from "./ui-kit";
import { money } from "@/lib/tms";
import { MaintenancePlans } from "./maintenance-kit";

/* ---------- access guard ---------- */
export function Guard({ module, children }: { module: PermModule; children: ReactNode }) {
  const { can, loading } = usePermissions();
  if (loading) return <div className="p-6 text-xs text-mut">Loading…</div>;
  if (!can(module, "view"))
    return (
      <div className="rounded-xl bg-panel p-8 ring-1 ring-line">
        <div className="font-display text-base font-semibold">No access</div>
        <p className="mt-1 text-xs text-mut">
          Your role doesn't have permission to view this section. Ask an administrator.
        </p>
      </div>
    );
  return <>{children}</>;
}

/* ---------- helpers ---------- */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

export function ExpiryBadge({ date }: { date?: string | null }) {
  const d = daysUntil(date);
  if (d === null) return <span className="text-mut">—</span>;
  const tone = d < 0 ? "text-problem" : d <= 30 ? "text-transit" : "text-fg";
  return (
    <span className={`num font-mono text-[11px] ${tone}`}>
      {date}
      {d < 0 ? " · expired" : d <= 30 ? ` · ${d}d` : ""}
    </span>
  );
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.error("Nothing to export");
    return;
  }
  const headers = Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function fmtTime(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Field({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-1.5 text-xs">
      <span className="font-mono text-[10px] tracking-[0.12em] text-mut uppercase">{k}</span>
      <span className="text-right text-fg">{v ?? "—"}</span>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-8 w-56 rounded-lg bg-ink px-3 text-xs text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
    />
  );
}

export function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; text: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg bg-ink px-2 text-xs text-fg ring-1 ring-line focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-ink">
          {o.text}
        </option>
      ))}
    </select>
  );
}

/* ---------- right-side detail drawer with tabs ---------- */
export function DetailDrawer({
  title,
  subtitle,
  tabs,
  onClose,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  tabs: { key: string; text: string; body: ReactNode }[];
  onClose: () => void;
  actions?: ReactNode;
}) {
  const [tab, setTab] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/60" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="drawer-in flex h-full w-full max-w-2xl flex-col bg-panel ring-1 ring-line"
      >
        <div className="flex items-start gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold tracking-tight">{title}</div>
            {subtitle && <div className="mt-1 text-xs text-mut">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="ml-auto font-mono text-xs text-mut hover:text-fg">
            CLOSE
          </button>
        </div>
        {actions && <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2">{actions}</div>}
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
          {tabs.map((t) => (
            <GhostButton key={t.key} active={t.key === current?.key} onClick={() => setTab(t.key)}>
              {t.text}
            </GhostButton>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">{current?.body}</div>
      </aside>
    </div>
  );
}

/* ---------- activity + notes ---------- */
export function ActivityPanel({ entityType, entityId, notesOnly }: { entityType: string; entityId: string; notesOnly?: boolean }) {
  const { data = [] } = useActivity(entityType, entityId);
  const { data: profiles = [] } = useProfiles();
  const { me } = usePermissions();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const rows = notesOnly ? data.filter((a) => a.kind === "note") : data;
  const who = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? "System";

  async function addNote() {
    if (!note.trim()) return;
    await logActivity(entityType, entityId, note.trim(), "note");
    setNote("");
    qc.invalidateQueries({ queryKey: ["activity", entityType, entityId] });
    toast.success("Note added");
  }

  return (
    <div className="space-y-3">
      {me?.canWrite && (
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
            placeholder="Add a note…"
            className="h-9 flex-1 rounded-lg bg-ink px-3 text-sm ring-1 ring-line focus:outline-none"
          />
          <PrimaryButton onClick={addNote}>Add note</PrimaryButton>
        </div>
      )}
      {rows.length === 0 && <EmptyRow text="No activity yet." />}
      {rows.map((a) => (
        <div key={a.id} className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <div className="text-xs text-fg">{a.description}</div>
          <div className="mt-1 font-mono text-[10px] text-mut">
            {a.kind === "note" ? "NOTE" : "ACTIVITY"} · {who(a.actor_id)} · {fmtTime(a.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- documents ---------- */
export function DocumentsPanel({ entityType, entityId, docTypes }: { entityType: string; entityId: string; docTypes: string[] }) {
  const { data = [] } = useEntityDocs(entityType, entityId);
  const { me, can } = usePermissions();
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<{ name: string; url: string } | null>(null);
  const [docType, setDocType] = useState(docTypes[0] ?? "other");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    const path = `${entityType}/${entityId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    const { error: e2 } = await supabase.from("entity_documents").insert({
      entity_type: entityType,
      entity_id: entityId,
      doc_type: docType,
      file_name: file.name,
      file_path: path,
      expires_on: expires || null,
    });
    setBusy(false);
    if (e2) return void toast.error(e2.message);
    await logActivity(entityType, entityId, `Uploaded ${docType.replace(/_/g, " ")}: ${file.name}`);
    qc.invalidateQueries({ queryKey: ["docs"] });
    qc.invalidateQueries({ queryKey: ["activity", entityType, entityId] });
    toast.success("Document uploaded");
  }

  async function open(path: string) {
    const { data: s, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
    if (error || !s) return void toast.error(error?.message ?? "Could not open file");
    window.open(s.signedUrl, "_blank");
  }

  /** View a document inside the page (no download, no new tab). */
  async function preview(path: string, name: string) {
    const { data: s, error } = await supabase.storage.from("documents").createSignedUrl(path, 600);
    if (error || !s) return void toast.error(error?.message ?? "Could not open file");
    setViewing({ name, url: s.signedUrl });
  }

  async function remove(id: string, path: string) {
    await supabase.storage.from("documents").remove([path]);
    const { error } = await supabase.from("entity_documents").delete().eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["docs"] });
    toast.success("Document removed");
  }

  return (
    <div className="space-y-3">
      {me?.canWrite && (
        <div className="grid grid-cols-3 items-end gap-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <SelectInput
            label="Type"
            value={docType}
            onChange={setDocType}
            options={docTypes.map((d) => ({ value: d, text: d.replace(/_/g, " ") }))}
          />
          <TextInput label="Expires (optional)" type="date" value={expires} onChange={setExpires} />
          <label className="flex h-9 cursor-pointer items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-ink">
            {busy ? "Uploading…" : "Upload file"}
            <input
              type="file"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      {data.length === 0 && <EmptyRow text="No documents uploaded." />}
      {data.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-lg bg-panel2 px-3 py-2 ring-1 ring-line">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-fg">{d.file_name}</div>
            <div className="font-mono text-[10px] text-mut uppercase">
              {d.doc_type.replace(/_/g, " ")} · {fmtTime(d.created_at)}
              {d.expires_on && <> · expires <ExpiryBadge date={d.expires_on} /></>}
            </div>
          </div>
          <GhostButton onClick={() => preview(d.file_path, d.file_name)}>Preview</GhostButton>
          {can("documents", "export") && <GhostButton onClick={() => open(d.file_path)}>Download</GhostButton>}
          {me?.canWrite && <GhostButton onClick={() => remove(d.id, d.file_path)}>Remove</GhostButton>}
        </div>
      ))}
      {viewing && <DocViewer name={viewing.name} url={viewing.url} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ---------- in-page document viewer ---------- */
export function DocViewer({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf";
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);
  return (
    <Modal wide title={name} onClose={onClose}>
      {isPdf && <iframe title={name} src={`${url}#toolbar=0&navpanes=0`} className="h-[75vh] w-full rounded-lg bg-ink ring-1 ring-line" />}
      {isImage && (
        <div className="max-h-[75vh] overflow-auto rounded-lg bg-ink p-2 ring-1 ring-line">
          <img src={url} alt={name} className="mx-auto max-w-full" draggable={false} onContextMenu={(e) => e.preventDefault()} />
        </div>
      )}
      {!isPdf && !isImage && (
        <p className="text-xs text-mut">This file type can't be previewed in the page. Ask someone with download permission to open it.</p>
      )}
    </Modal>
  );
}

/* ---------- maintenance ---------- */
export function MaintenancePanel({ assetType, assetId }: { assetType: "truck" | "trailer"; assetId: string }) {
  const { data = [] } = useMaintenance();
  const { me } = usePermissions();
  const qc = useQueryClient();
  const rows = data.filter((m) => m.asset_type === assetType && m.asset_id === assetId);
  const [f, setF] = useState({ service_date: new Date().toISOString().slice(0, 10), description: "", cost: "", odometer: "", vendor: "" });
  const total = rows.reduce((s, r) => s + Number(r.cost), 0);

  async function add() {
    if (!f.description.trim()) return void toast.error("Description required");
    const { error } = await supabase.from("maintenance_records").insert({
      asset_type: assetType,
      asset_id: assetId,
      service_date: f.service_date,
      description: f.description,
      cost: Number(f.cost || 0),
      odometer: f.odometer ? Number(f.odometer) : null,
      vendor: f.vendor || null,
    });
    if (error) return void toast.error(error.message);
    await logActivity(assetType, assetId, `Maintenance: ${f.description} (${money(Number(f.cost || 0))})`);
    setF({ ...f, description: "", cost: "", odometer: "", vendor: "" });
    qc.invalidateQueries({ queryKey: ["maintenance"] });
    qc.invalidateQueries({ queryKey: ["activity", assetType, assetId] });
    toast.success("Maintenance recorded");
  }

  return (
    <div className="space-y-3">
      <MaintenancePlans assetType={assetType} assetId={assetId} />
      <div className="text-xs text-mut">
        Total spent: <span className="num text-fg">{money(total)}</span> · {rows.length} records
      </div>
      {me?.canWrite && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <TextInput label="Date" type="date" value={f.service_date} onChange={(v) => setF({ ...f, service_date: v })} />
          <TextInput label="Description" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
          <TextInput label="Cost" type="number" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
          <TextInput label="Odometer" type="number" value={f.odometer} onChange={(v) => setF({ ...f, odometer: v })} />
          <TextInput label="Vendor" value={f.vendor} onChange={(v) => setF({ ...f, vendor: v })} />
          <div className="flex items-end">
            <PrimaryButton onClick={add} className="w-full">Add maintenance</PrimaryButton>
          </div>
        </div>
      )}
      {rows.length === 0 && <EmptyRow text="No maintenance records." />}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
          <div>
            <div className="text-fg">{r.description}</div>
            <div className="font-mono text-[10px] text-mut">
              {r.service_date} {r.vendor && `· ${r.vendor}`} {r.odometer && `· ${r.odometer.toLocaleString()} mi`}
            </div>
          </div>
          <span className="num">{money(Number(r.cost))}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- fuel ---------- */
export function FuelPanel({ truckId, driverId }: { truckId: string; driverId?: string | null }) {
  const { data = [] } = useFuel();
  const { me } = usePermissions();
  const qc = useQueryClient();
  const rows = data.filter((r) => r.truck_id === truckId);
  const [f, setF] = useState({ fuel_date: new Date().toISOString().slice(0, 10), gallons: "", cost: "", odometer: "", state: "", location: "" });
  const gal = rows.reduce((s, r) => s + Number(r.gallons), 0);
  const cost = rows.reduce((s, r) => s + Number(r.cost), 0);

  async function add() {
    if (!f.gallons || !f.cost) return void toast.error("Gallons and cost required");
    const { error } = await supabase.from("fuel_records").insert({
      truck_id: truckId,
      driver_id: driverId ?? null,
      fuel_date: f.fuel_date,
      gallons: Number(f.gallons),
      cost: Number(f.cost),
      odometer: f.odometer ? Number(f.odometer) : null,
      state: f.state || null,
      location: f.location || null,
    });
    if (error) return void toast.error(error.message);
    await logActivity("truck", truckId, `Fuel: ${f.gallons} gal for ${money(Number(f.cost))}`);
    setF({ ...f, gallons: "", cost: "", odometer: "", location: "" });
    qc.invalidateQueries({ queryKey: ["fuel"] });
    toast.success("Fuel purchase recorded");
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-mut">
        {gal.toFixed(0)} gal · <span className="num text-fg">{money(cost)}</span> ·{" "}
        {gal ? `$${(cost / gal).toFixed(2)}/gal` : "—"}
      </div>
      {me?.canWrite && (
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
          <TextInput label="Date" type="date" value={f.fuel_date} onChange={(v) => setF({ ...f, fuel_date: v })} />
          <TextInput label="Gallons" type="number" value={f.gallons} onChange={(v) => setF({ ...f, gallons: v })} />
          <TextInput label="Cost" type="number" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
          <TextInput label="Odometer" type="number" value={f.odometer} onChange={(v) => setF({ ...f, odometer: v })} />
          <TextInput label="State" value={f.state} onChange={(v) => setF({ ...f, state: v })} />
          <div className="flex items-end">
            <PrimaryButton onClick={add} className="w-full">Add fuel</PrimaryButton>
          </div>
        </div>
      )}
      {rows.length === 0 && <EmptyRow text="No fuel purchases." />}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-xs ring-1 ring-line">
          <span className="font-mono text-[11px] text-mut">
            {r.fuel_date} {r.state && `· ${r.state}`} {r.odometer && `· ${r.odometer.toLocaleString()} mi`}
          </span>
          <span className="num">
            {Number(r.gallons).toFixed(1)} gal · {money(Number(r.cost))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function useStaffName() {
  const { data: profiles = [] } = useProfiles();
  return (id?: string | null) => profiles.find((p) => p.id === id)?.full_name ?? "—";
}
