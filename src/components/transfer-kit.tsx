import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDrivers, useProfiles } from "@/hooks/useTms";
import { useTransferActions, type TTemplate } from "@/hooks/useTransfer";
import {
  PLACEHOLDERS,
  fillTemplate,
  mailtoUrl,
  mapsUrl,
  missingPlaceholders,
  smsUrl,
  telUrl,
  templateVars,
  type TOption,
  type TRow,
  type TShop,
  type Tone,
} from "@/lib/transfer";
import { EmptyRow, GhostButton, Modal, PrimaryButton, SelectInput, TextInput } from "./ui-kit";
import { TextArea } from "./shifts-kit";

export const toneCls: Record<Tone, string> = {
  neutral: "bg-panel2 text-fg ring-line",
  info: "bg-accent/12 text-accent ring-accent/30",
  warn: "bg-transit/15 text-transit ring-transit/30",
  good: "bg-delivered/12 text-delivered ring-delivered/30",
  bad: "bg-problem/12 text-problem ring-problem/30",
};

/** A dropdown that is colored by the chosen status. Works with a finger on a phone too. */
export function OptionSelect({
  options,
  value,
  onChange,
  disabled,
  big,
}: {
  options: TOption[];
  value: string | undefined;
  onChange: (optionId: string) => void;
  disabled?: boolean;
  big?: boolean;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full min-w-[150px] rounded-lg px-2 font-medium ring-1 focus:outline-none disabled:opacity-60 ${big ? "h-10 text-sm" : "h-8 text-xs"} ${toneCls[current?.tone ?? "neutral"]}`}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  return <GhostButton onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}>{label}</GhostButton>;
}

const link = "inline-flex h-8 items-center rounded-lg bg-panel2 px-3 text-xs text-mut ring-1 ring-line hover:text-fg";

/** The print shop details of a sticker order, with one-click copy, email, call and map. */
export function StickerInfo({ row, canEdit, onEdit }: { row: TRow; canEdit: boolean; onEdit: () => void }) {
  const { data: profiles = [] } = useProfiles();
  const has = row.sticker_shop_name || row.sticker_email || row.sticker_phone || row.sticker_location;
  if (!has) {
    return (
      <div className="rounded-lg bg-panel2 p-3 text-xs text-mut ring-1 ring-line">
        No print shop details yet.{" "}
        {canEdit && <button onClick={onEdit} className="text-accent underline">Add them</button>}
      </div>
    );
  }
  const by = profiles.find((p) => p.id === row.sticker_ordered_by)?.full_name;
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="w-20 shrink-0 text-mut">{k}</span>{children}</div>
  );
  return (
    <div className="space-y-2 rounded-lg bg-panel2 p-3 ring-1 ring-line">
      {row.sticker_shop_name && <Row k="Print shop"><span className="font-medium text-fg">{row.sticker_shop_name}</span></Row>}
      {row.sticker_email && (
        <Row k="Email">
          <span className="text-fg">{row.sticker_email}</span>
          <CopyBtn text={row.sticker_email} />
          <a className={link} href={mailtoUrl(row.sticker_email, `Stickers for ${row.driver_name}`, "")}>Email</a>
        </Row>
      )}
      {row.sticker_phone && (
        <Row k="Phone">
          <span className="text-fg">{row.sticker_phone}</span>
          <CopyBtn text={row.sticker_phone} />
          <a className={link} href={telUrl(row.sticker_phone)}>Call</a>
        </Row>
      )}
      {row.sticker_location && (
        <Row k="Location">
          <span className="text-fg">{row.sticker_location}</span>
          <CopyBtn text={row.sticker_location} />
          <a className={link} href={mapsUrl(row.sticker_location)} target="_blank" rel="noreferrer">Open map</a>
        </Row>
      )}
      {(row.sticker_ordered_on || by) && (
        <Row k="Ordered">
          <span className="text-fg">{row.sticker_ordered_on ?? ""}{by ? ` by ${by}` : ""}</span>
        </Row>
      )}
      {row.sticker_note && <Row k="Note"><span className="whitespace-pre-wrap text-fg">{row.sticker_note}</span></Row>}
      {canEdit && <GhostButton onClick={onEdit}>Edit details</GhostButton>}
    </div>
  );
}

/** Opens when Stickers is set to Ordered (or from "Edit details"). */
export function StickerOrderModal({ row, shops, onClose }: { row: TRow; shops: TShop[]; onClose: () => void }) {
  const { data: me } = useCurrentUser();
  const act = useTransferActions();
  const [shopId, setShopId] = useState(row.sticker_shop_id ?? "");
  const [name, setName] = useState(row.sticker_shop_name ?? "");
  const [email, setEmail] = useState(row.sticker_email ?? "");
  const [location, setLocation] = useState(row.sticker_location ?? "");
  const [phone, setPhone] = useState(row.sticker_phone ?? "");
  const [date, setDate] = useState(row.sticker_ordered_on ?? new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(row.sticker_note ?? "");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  function pickShop(id: string) {
    setShopId(id);
    const s = shops.find((x) => x.id === id);
    if (s) {
      setName(s.name);
      setEmail(s.email ?? "");
      setLocation(s.location ?? "");
      setPhone(s.phone ?? "");
    }
  }

  async function save() {
    if (!email.trim() && !phone.trim() && !location.trim()) return void toast.error("Add at least the email, the phone or the location of the print shop");
    setBusy(true);
    const ok = await act.updateRow(row.id, {
      sticker_shop_id: shopId || null,
      sticker_shop_name: name.trim() || null,
      sticker_email: email.trim() || null,
      sticker_location: location.trim() || null,
      sticker_phone: phone.trim() || null,
      sticker_ordered_on: date || null,
      sticker_note: note.trim() || null,
      sticker_ordered_by: me?.id ?? null,
    });
    if (ok && remember && name.trim() && !shops.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())) {
      await act.saveShop({ name: name.trim(), email: email.trim() || null, location: location.trim() || null, phone: phone.trim() || null });
    }
    setBusy(false);
    if (ok) {
      toast.success("Sticker order details saved");
      onClose();
    }
  }

  return (
    <Modal wide title={`Sticker order · ${row.driver_name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-mut">Where were the stickers ordered? Everyone will see this on the driver's row.</p>
        {shops.length > 0 && (
          <SelectInput label="Saved print shops" value={shopId} onChange={pickShop} options={[{ value: "", text: "New print shop…" }, ...shops.map((s) => ({ value: s.id, text: s.name }))]} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Print shop name" value={name} onChange={setName} placeholder="e.g. Print Pro" />
          <TextInput label="Order date" type="date" value={date} onChange={setDate} />
          <TextInput label="Email of the print shop" type="email" value={email} onChange={setEmail} placeholder="orders@printshop.com" />
          <TextInput label="Phone of the print shop" type="tel" value={phone} onChange={setPhone} placeholder="(555) 123-4567" />
        </div>
        <TextInput label="Location (address)" value={location} onChange={setLocation} placeholder="Street, city, state" />
        <TextArea label="Note (optional)" value={note} onChange={setNote} rows={2} placeholder="Order number, size, pick-up hours…" />
        <label className="flex items-center gap-2 text-xs text-fg">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Save this print shop for next time
        </label>
        <div className="flex justify-between gap-2">
          <GhostButton onClick={onClose}>Skip for now</GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? "Saving…" : "Save details"}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/** Pick a driver and a message template, see the filled-in text, then copy it, email it or text it. */
export function UseTemplateModal({
  templates,
  rows,
  initialRowId,
  initialTemplateId,
  onClose,
}: {
  templates: TTemplate[];
  rows: TRow[];
  initialRowId?: string;
  initialTemplateId?: string;
  onClose: () => void;
}) {
  const { data: drivers = [] } = useDrivers();
  const texts = templates.filter((t) => t.kind === "text");
  const [rowId, setRowId] = useState(initialRowId ?? rows[0]?.id ?? "");
  const [tplId, setTplId] = useState(initialTemplateId ?? texts[0]?.id ?? "");
  const row = rows.find((r) => r.id === rowId);
  const tpl = texts.find((t) => t.id === tplId);
  const vars = useMemo(() => (row ? templateVars(row) : {}), [row]);
  const base = tpl && row ? fillTemplate(tpl.body ?? "", vars) : "";
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? base;
  const missing = tpl && row ? missingPlaceholders(tpl.body ?? "", vars) : [];
  const found = drivers.find((d) => d.id === row?.driver_id);
  const driver = { phone: found?.phone ?? row?.driver_phone ?? null, email: found?.email ?? row?.driver_email ?? null };

  return (
    <Modal wide title="Use a message template" onClose={onClose}>
      {texts.length === 0 ? (
        <EmptyRow text="There are no text templates yet. An admin can add them in the Templates tab." />
      ) : rows.length === 0 ? (
        <EmptyRow text="Add a driver to the board first." />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput label="Driver" value={rowId} onChange={(v) => { setRowId(v); setEdited(null); }} options={rows.map((r) => ({ value: r.id, text: r.driver_name }))} />
            <SelectInput label="Template" value={tplId} onChange={(v) => { setTplId(v); setEdited(null); }} options={texts.map((t) => ({ value: t.id, text: t.title }))} />
          </div>
          {missing.length > 0 && (
            <p className="text-[11px] text-transit">
              Not filled in yet: {missing.map((m) => `{${m}}`).join(", ")}. You can type them in below or add the details to the driver's row.
            </p>
          )}
          <TextArea label="Message (you can edit it)" value={text} onChange={setEdited} rows={7} />
          <div className="flex flex-wrap gap-2">
            <PrimaryButton onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Message copied"))}>Copy message</PrimaryButton>
            {driver?.phone && <a className={link} href={smsUrl(driver.phone, text)}>Text {driver.phone}</a>}
            {driver?.email && <a className={link} href={mailtoUrl(driver.email, tpl?.title ?? "Message", text)}>Email {driver.email}</a>}
            {!driver?.phone && !driver?.email && <span className="self-center text-[11px] text-mut">No phone or email on file for this driver, so use Copy.</span>}
          </div>
          <details className="text-[11px] text-mut">
            <summary className="cursor-pointer">Blanks you can use in templates</summary>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => <span key={p.key} className="rounded bg-panel2 px-1.5 py-0.5 font-mono ring-1 ring-line">{`{${p.key}}`} = {p.text}</span>)}
            </div>
          </details>
        </div>
      )}
    </Modal>
  );
}
