import { useSyncExternalStore } from "react";

export type Theme = "dark" | "mid" | "light";
export type Density = "compact" | "normal" | "large";

export const THEMES: { value: Theme; text: string; hint: string }[] = [
  { value: "dark", text: "Dark", hint: "Near-black, best at night" },
  { value: "mid", text: "Mid", hint: "Soft slate, less glare" },
  { value: "light", text: "Light", hint: "White, best in bright offices" },
];
export const DENSITIES: { value: Density; text: string }[] = [
  { value: "compact", text: "Small" },
  { value: "normal", text: "Normal" },
  { value: "large", text: "Large" },
];

const THEME_KEY = "vantera-theme";
const DENSITY_KEY = "vantera-density";

/** Runs in <head> before the page paints, so there is no flash of the wrong theme. */
export const DISPLAY_BOOT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}"),s=localStorage.getItem("${DENSITY_KEY}");d.dataset.theme=(t==="light"||t==="mid"||t==="dark")?t:"dark";d.dataset.density=(s==="compact"||s==="large")?s:"normal"}catch(e){}`;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string, attr: "theme" | "density") {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice just lasts for this visit */
  }
  document.documentElement.dataset[attr] = value;
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

export function useDisplay() {
  const theme = useSyncExternalStore(subscribe, () => read<Theme>(THEME_KEY, ["dark", "mid", "light"], "dark"), () => "dark" as Theme);
  const density = useSyncExternalStore(subscribe, () => read<Density>(DENSITY_KEY, ["compact", "normal", "large"], "normal"), () => "normal" as Density);
  return {
    theme,
    density,
    setTheme: (t: Theme) => write(THEME_KEY, t, "theme"),
    setDensity: (d: Density) => write(DENSITY_KEY, d, "density"),
  };
}
