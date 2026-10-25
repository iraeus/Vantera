import { useEffect, useRef, useState } from "react";
import { DENSITIES, THEMES, useDisplay, type Theme } from "@/hooks/useDisplay";

/** Small color swatch that previews each theme (hard-coded on purpose: it must look the same under every theme). */
const SWATCH: Record<Theme, { bg: string; panel: string; accent: string }> = {
  dark: { bg: "#11191c", panel: "#1d282c", accent: "#65d5c0" },
  mid: { bg: "#39494b", panel: "#506163", accent: "#a5e3d8" },
  light: { bg: "#f4f8f7", panel: "#ffffff", accent: "#087e75" },
};

function Swatch({ theme }: { theme: Theme }) {
  const c = SWATCH[theme];
  return (
    <span className="inline-flex h-5 w-8 shrink-0 overflow-hidden rounded ring-1 ring-black/20" style={{ background: c.bg }} aria-hidden>
      <span className="m-auto h-3 w-5 rounded-sm" style={{ background: c.panel, borderTop: `2px solid ${c.accent}` }} />
    </span>
  );
}

/** Header button: pick Dark / Mid / Light and the text size. Saved in this browser. */
export function DisplayMenu() {
  const { theme, density, setTheme, setDensity } = useDisplay();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        className="flex h-8 items-center gap-2 rounded-lg bg-panel2 px-2 text-xs text-fg ring-1 ring-line hover:ring-accent/40"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Swatch theme={theme} />
        <span className="hidden sm:inline">Display</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl bg-panel p-3 shadow-lg ring-1 ring-line">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Theme</div>
          <div className="space-y-1.5">
            {THEMES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ring-1 ${theme === t.value ? "bg-accent/12 ring-accent/50" : "bg-panel2 ring-line hover:ring-accent/30"}`}
              >
                <Swatch theme={t.value} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-fg">{t.text}</span>
                  <span className="block text-[10px] text-mut">{t.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mb-2 mt-3 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">Text size</div>
          <div className="grid grid-cols-3 gap-1.5">
            {DENSITIES.map((d) => (
              <button
                key={d.value}
                onClick={() => setDensity(d.value)}
                className={`h-8 rounded-lg text-xs ring-1 ${density === d.value ? "bg-accent/12 text-accent ring-accent/50" : "bg-panel2 text-mut ring-line hover:text-fg"}`}
              >
                {d.text}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-mut">Saved on this computer only.</p>
        </div>
      )}
    </div>
  );
}

/** Compact three-dot switcher for the sign-in page. */
export function ThemeDots() {
  const { theme, setTheme } = useDisplay();
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          onClick={() => setTheme(t.value)}
          title={t.text}
          aria-label={`${t.text} theme`}
          className={`rounded-md p-1 ring-1 ${theme === t.value ? "ring-accent" : "ring-line"}`}
        >
          <Swatch theme={t.value} />
        </button>
      ))}
    </div>
  );
}
