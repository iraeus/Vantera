import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useAttention } from "@/hooks/useAttention";
import { useBootReady } from "@/hooks/useBoot";

/** Bell in the header. It starts loading after the loading screen is gone, so the first screen shows up sooner. */
export function AlertsBell() {
  const ready = useBootReady();
  return ready ? (
    <BellInner />
  ) : (
    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel2 text-mut ring-1 ring-line" aria-hidden>
      <Bell className="size-4 opacity-50" />
    </div>
  );
}

/** What needs attention for this person's role (late updates, expiring documents, overdue service, billing…). */
function BellInner() {
  const { mine } = useAttention();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const urgent = mine.filter((a) => a.tone === "problem").length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-8 place-items-center rounded-lg bg-panel2 text-mut ring-1 ring-line hover:text-fg"
        aria-label={`Alerts (${mine.length})`}
        aria-expanded={open}
      >
        <Bell className="size-4" />
        {mine.length > 0 && (
          <span className={`absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full px-1 font-mono text-[9px] font-semibold text-ink ${urgent > 0 ? "bg-problem" : "bg-transit"}`}>
            {mine.length > 99 ? "99+" : mine.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,90vw)] rounded-xl bg-panel shadow-lg ring-1 ring-line">
          <div className="border-b border-line px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
            {mine.length === 0 ? "All clear" : `${mine.length} need attention`}
          </div>
          <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">
            {mine.length === 0 && <div className="px-3 py-6 text-center text-xs text-mut">Nothing needs attention right now.</div>}
            {mine.slice(0, 25).map((a) => (
              <Link key={a.key} to={a.to} onClick={() => setOpen(false)} className="flex items-start gap-2 px-3 py-2 text-xs hover:bg-panel2">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${a.tone === "problem" ? "bg-problem/12 text-problem" : "bg-transit/15 text-transit"}`}>{a.tag}</span>
                <span className="text-fg">{a.text}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
