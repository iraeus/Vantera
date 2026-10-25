import { useState } from "react";
import { Modal, PrimaryButton, SelectInput, TextInput } from "./ui-kit";

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "checkbox" | "textarea";
  options?: { value: string; text: string }[];
  required?: boolean;
};

type Row = Record<string, unknown>;

/** Converts a DB row into string form values. */
function toForm(fields: FieldDef[], row?: Row | null) {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = row?.[f.key];
    if (f.type === "checkbox") out[f.key] = v ? "true" : "false";
    else if (f.type === "select") out[f.key] = v == null ? (f.options?.[0]?.value ?? "") : String(v);
    else out[f.key] = v == null ? "" : String(v);
  }
  return out;
}

/** Converts form strings back into DB values (empty → null, numbers parsed). */
function toRow(fields: FieldDef[], form: Record<string, string>): Row {
  const out: Row = {};
  for (const f of fields) {
    const v = form[f.key] ?? "";
    if (f.type === "checkbox") out[f.key] = v === "true";
    else if (f.type === "number") out[f.key] = v === "" ? null : Number(v);
    else out[f.key] = v === "" ? null : v;
  }
  return out;
}

export function RecordForm({
  title,
  fields,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  fields: FieldDef[];
  initial?: Row | null;
  onClose: () => void;
  onSave: (row: Row) => Promise<boolean>;
}) {
  const [form, setForm] = useState(() => toForm(fields, initial));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(toRow(fields, form));
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {fields.map((f) => {
          if (f.type === "select")
            return (
              <SelectInput key={f.key} label={f.label} value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} options={f.options ?? []} />
            );
          if (f.type === "checkbox")
            return (
              <label key={f.key} className="flex items-end gap-2 pb-2 text-xs text-fg">
                <input type="checkbox" checked={form[f.key] === "true"} onChange={(e) => set(f.key, e.target.checked ? "true" : "false")} className="accent-accent" />
                {f.label}
              </label>
            );
          if (f.type === "textarea")
            return (
              <label key={f.key} className="col-span-full block">
                <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{f.label}</span>
                <textarea value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} rows={3} className="mt-1 w-full rounded-lg bg-ink p-3 text-sm text-fg ring-1 ring-line focus:outline-none" />
              </label>
            );
          return (
            <TextInput key={f.key} label={f.label + (f.required ? " *" : "")} type={f.type ?? "text"} required={f.required ?? false} value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          );
        })}
        <div className="col-span-full flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-xs text-mut ring-1 ring-line hover:text-fg">Cancel</button>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function opts(values: readonly string[], blank?: string) {
  const o = values.map((v) => ({ value: v, text: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
  return blank ? [{ value: "", text: blank }, ...o] : o;
}
