import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** Account-scoped browser preferences, kept separate when multiple staff share a workstation. */
export function useUserPreference<T>(key: string, fallback: T) {
  const { data: me } = useCurrentUser();
  const storageKey = `vantera:user:${me?.id ?? "guest"}:${key}`;
  const [value, setValue] = useState<T>(fallback);
  const [loadedKey, setLoadedKey] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      setValue(stored ? (JSON.parse(stored) as T) : fallback);
    } catch {
      setValue(fallback);
    }
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Keep the preference for this session when browser storage is unavailable.
    }
  }, [loadedKey, storageKey, value]);

  return [value, setValue] as const;
}
