import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-panel ring-1 ring-line ${className}`}>{children}</div>;
}

export function PanelHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
      <span className="font-display text-sm font-semibold tracking-tight">{title}</span>
      {count && <span className="num font-mono text-[11px] text-mut">{count}</span>}
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-lg bg-ink px-3 text-sm text-fg ring-1 ring-line placeholder:text-mut focus:ring-accent/40 focus:outline-none"
      />
    </label>
  );
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; text: string }[];
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-mut uppercase">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-lg bg-ink px-2 text-sm text-fg ring-1 ring-line focus:ring-accent/40 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink">
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/80 p-3 sm:p-6">
      <div
        className={`modal-dialog-enter my-auto flex max-h-[calc(100dvh-1.5rem)] w-full ${wide ? "max-w-3xl" : "max-w-md"} flex-col overflow-hidden rounded-xl bg-panel ring-1 ring-line shadow-2xl shadow-black/20`}
      >
        <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
          <span className="font-display text-sm font-semibold tracking-tight">{title}</span>
          <button onClick={onClose} className="ml-auto font-mono text-xs text-mut hover:text-fg">
            ESC
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">{children}</div>
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`h-9 rounded-lg bg-accent px-3 text-xs font-medium text-ink disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  active,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`h-8 rounded-lg px-2.5 text-xs ring-1 ring-line ${
        active ? "bg-accent/12 text-accent" : "bg-panel2 text-mut hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return <div className="px-4 py-6 text-xs text-mut">{text}</div>;
}
