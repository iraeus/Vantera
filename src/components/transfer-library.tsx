import { useState } from "react";
import { toast } from "sonner";
import { FileImage, FileSpreadsheet, FileText, File as FileIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTransferActions, useTransferData, type TTemplate } from "@/hooks/useTransfer";
import { PLACEHOLDERS, formatBytes, safeFileName } from "@/lib/transfer";
import { EmptyRow, GhostButton, Modal, Panel, PanelHeader, PrimaryButton, SelectInput, TextInput } from "./ui-kit";
import { DocViewer } from "./entity-kit";
import { TextArea } from "./shifts-kit";
import { UseTemplateModal } from "./transfer-kit";

const MAX_BYTES = 25 * 1024 * 1024;
const extOf = (name: string | null) => (name?.split(".").pop() ?? "").toLowerCase();
export const canPreview = (t: TTemplate) => ["pdf", "png", "jpg", "jpeg", "gif", "webp"].includes(extOf(t.file_name));

/** Temporary link to a template file (preview in the page, or download). */
export async function fileUrl(t: TTemplate, download: boolean): Promise<string | null> {
  if (!t.file_path) return null;
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(t.file_path, 300, download ? { download: t.file_name ?? true } : {});
  if (error || !data) {
    toast.error(error?.message ?? "Could not open the file");
    return null;
  }
  return data.signedUrl;
}

export async function downloadFile(t: TTemplate) {
  const url = await fileUrl(t, true);
  if (url) window.location.assign(url);
}

function Icon({ t }: { t: TTemplate }) {
  const e = extOf(t.file_name);
  const cls = "size-8 text-accent";
  if (["xls", "xlsx", "csv"].includes(e)) return <FileSpreadsheet className={cls} />;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return <FileImage className={cls} />;
  if (["pdf", "doc", "docx", "txt", "rtf"].includes(e)) return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

/** Buttons to look at a template file: used on the Templates tab and inside a driver's drawer. */
export function FileActions({ t }: { t: TTemplate }) {
  const [viewing, setViewing] = useState<{ name: string; url: string } | null>(null);
  return (
    <>
      {canPreview(t) && (
        <GhostButton
          onClick={async () => {
            const url = await fileUrl(t, false);
            if (url) setViewing({ name: t.file_name ?? t.title, url });
          }}
        >
          Preview
        </GhostButton>
      )}
      <GhostButton onClick={() => downloadFile(t)}>Download</GhostButton>
      {viewing && <DocViewer name={viewing.name} url={viewing.url} onClose={() => setViewing(null)} />}
    </>
  );
}

function Dropzone({ onFiles, busy }: { onFiles: (f: File[]) => void; busy: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) onFiles([...e.dataTransfer.files]); }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm ${over ? "border-accent bg-accent/10 text-fg" : "border-line text-mut hover:border-accent/50"} ${busy ? "opacity-60" : ""}`}
    >
      <span className="font-medium text-fg">{busy ? "Uploading…" : "Drag files here, or click to choose"}</span>
      <span className="text-xs">PDF, Word, Excel or images · up to 25 MB each</span>
      <input type="file" multiple className="hidden" disabled={busy} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) onFiles(f); }} />
    </label>
  );
}

function FileMetaModal({ t, categories, onClose }: { t: TTemplate; categories: string[]; onClose: () => void }) {
  const act = useTransferActions();
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description ?? "");
  const [category, setCategory] = useState(t.category ?? "General");
  return (
    <Modal title="Edit file details" onClose={onClose}>
      <div className="space-y-3">
        <TextInput label="Title" value={title} onChange={setTitle} />
        <SelectInput label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, text: c }))} />
        <TextArea label="Description (optional)" value={description} onChange={setDescription} rows={2} />
        <div className="flex justify-end">
          <PrimaryButton
            disabled={!title.trim()}
            onClick={async () => {
              if (await act.saveTemplate(t.id, { title: title.trim(), description: description.trim() || null, category })) onClose();
            }}
          >
            Save
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function TextTemplateModal({ t, categories, onClose }: { t: TTemplate | null; categories: string[]; onClose: () => void }) {
  const act = useTransferActions();
  const [title, setTitle] = useState(t?.title ?? "");
  const [category, setCategory] = useState(t?.category ?? "General");
  const [body, setBody] = useState(t?.body ?? "");
  const insert = (key: string) => setBody((b) => `${b}${b && !b.endsWith(" ") && !b.endsWith("\n") ? " " : ""}{${key}}`);
  return (
    <Modal wide title={t ? "Edit text template" : "New text template"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Title" value={title} onChange={setTitle} placeholder="e.g. Stickers: ready for pick up" />
          <SelectInput label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, text: c }))} />
        </div>
        <TextArea label="Message" value={body} onChange={setBody} rows={7} placeholder="Hi {driver_name}, …" />
        <div>
          <div className="mb-1 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Tap to add a blank (it is filled in with the driver's details)</div>
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <button key={p.key} onClick={() => insert(p.key)} className="rounded-md bg-panel2 px-2 py-1 text-[11px] text-fg ring-1 ring-line hover:ring-accent/40">{p.text}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <PrimaryButton
            disabled={!title.trim() || !body.trim()}
            onClick={async () => {
              const ok = await act.saveTemplate(t?.id ?? null, { kind: "text", title: title.trim(), category, body });
              if (ok) onClose();
            }}
          >
            Save template
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/** Templates tab: admins upload files and write messages; everyone can use them. */
export function TransferLibrary() {
  const { templates, steps, rows } = useTransferData();
  const { data: me } = useCurrentUser();
  const act = useTransferActions();
  const isAdmin = !!me?.isAdmin;
  const categories = ["General", ...steps.filter((s) => s.is_active).map((s) => s.label)];
  const [category, setCategory] = useState("General");
  const [busy, setBusy] = useState(false);
  const [editFile, setEditFile] = useState<TTemplate | null>(null);
  const [editText, setEditText] = useState<TTemplate | null | "new">(null);
  const [using, setUsing] = useState<string | null>(null);
  const files = templates.filter((t) => t.kind === "file");
  const texts = templates.filter((t) => t.kind === "text");

  async function upload(list: File[]) {
    setBusy(true);
    let ok = 0;
    for (const f of list) {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 25 MB`);
        continue;
      }
      const path = `templates/${crypto.randomUUID()}/${safeFileName(f.name)}`;
      const up = await supabase.storage.from("documents").upload(path, f, f.type ? { contentType: f.type } : {});
      if (up.error) {
        toast.error(`${f.name}: ${up.error.message}`);
        continue;
      }
      const saved = await act.saveTemplate(null, {
        kind: "file",
        title: f.name.replace(/\.[^.]+$/, ""),
        category,
        file_path: path,
        file_name: f.name,
        file_size: f.size,
        mime: f.type || null,
      });
      if (saved) ok++;
    }
    setBusy(false);
    if (ok) toast.success(ok === 1 ? "File added" : `${ok} files added`);
  }

  async function replace(t: TTemplate, f: File) {
    if (f.size > MAX_BYTES) return void toast.error("That file is larger than 25 MB");
    setBusy(true);
    const path = `templates/${crypto.randomUUID()}/${safeFileName(f.name)}`;
    const up = await supabase.storage.from("documents").upload(path, f, f.type ? { contentType: f.type } : {});
    if (up.error) {
      setBusy(false);
      return void toast.error(up.error.message);
    }
    const ok = await act.saveTemplate(t.id, { file_path: path, file_name: f.name, file_size: f.size, mime: f.type || null, version: t.version + 1 });
    if (ok && t.file_path) await supabase.storage.from("documents").remove([t.file_path]);
    setBusy(false);
    if (ok) toast.success("File replaced with the new version");
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Files" count={`${files.length}`} />
        {isAdmin && (
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_220px]">
            <Dropzone onFiles={upload} busy={busy} />
            <div className="space-y-1">
              <SelectInput label="Category for new files" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, text: c }))} />
              <p className="text-[11px] text-mut">Only admins can add, replace or delete files. Everyone can open them.</p>
            </div>
          </div>
        )}
        {files.length === 0 && <EmptyRow text={isAdmin ? "No files yet. Drag your documents into the box above." : "No files yet. An admin can upload them here."} />}
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-xl bg-panel2 p-3 ring-1 ring-line">
              <div className="flex items-start gap-3">
                <Icon t={t} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">{t.title}</div>
                  <div className="text-[11px] text-mut">{[t.category, formatBytes(t.file_size), `v${t.version}`, new Date(t.updated_at).toLocaleDateString()].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              {t.description && <p className="text-xs text-mut">{t.description}</p>}
              <div className="mt-auto flex flex-wrap gap-1.5">
                <FileActions t={t} />
                {isAdmin && (
                  <>
                    <GhostButton onClick={() => setEditFile(t)}>Edit</GhostButton>
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-panel px-3 text-xs text-mut ring-1 ring-line hover:text-fg">
                      Replace file
                      <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void replace(t, f); }} />
                    </label>
                    <GhostButton onClick={() => confirm(`Delete "${t.title}"?`) && act.deleteTemplate(t)}>Delete</GhostButton>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Message templates" count={`${texts.length}`}>
          {isAdmin && <PrimaryButton onClick={() => setEditText("new")}>+ New template</PrimaryButton>}
        </PanelHeader>
        {texts.length === 0 && <EmptyRow text="No message templates yet." />}
        <div className="divide-y divide-line/60">
          {texts.map((t) => (
            <div key={t.id} className="space-y-1.5 px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg">{t.title}</span>
                {t.category && <span className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-mut">{t.category}</span>}
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <PrimaryButton onClick={() => setUsing(t.id)}>Use for a driver</PrimaryButton>
                  <GhostButton onClick={() => navigator.clipboard.writeText(t.body ?? "").then(() => toast.success("Copied"))}>Copy text</GhostButton>
                  {isAdmin && <GhostButton onClick={() => setEditText(t)}>Edit</GhostButton>}
                  {isAdmin && <GhostButton onClick={() => confirm(`Delete "${t.title}"?`) && act.deleteTemplate(t)}>Delete</GhostButton>}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-mut">{t.body}</p>
            </div>
          ))}
        </div>
      </Panel>

      {editFile && <FileMetaModal t={editFile} categories={categories} onClose={() => setEditFile(null)} />}
      {editText && <TextTemplateModal t={editText === "new" ? null : editText} categories={categories} onClose={() => setEditText(null)} />}
      {using && <UseTemplateModal templates={templates} rows={rows.filter((r) => !r.is_archived)} initialTemplateId={using} onClose={() => setUsing(null)} />}
    </div>
  );
}
