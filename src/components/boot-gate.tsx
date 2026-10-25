import { useEffect, useState } from "react";
import { BootScreen } from "./boot-screen";
import { setBootReady, useBootProgress } from "@/hooks/useBoot";

/**
 * Covers the app with the loading screen until the first data is in, then fades out.
 * The app loads underneath it, so nothing is wasted. Shown when you sign in or reload the page.
 */
export function BootGate() {
  const p = useBootProgress();
  const [phase, setPhase] = useState<"show" | "leaving" | "gone">("show");

  useEffect(() => {
    if (p.ready) setPhase((cur) => (cur === "show" ? "leaving" : cur));
  }, [p.ready]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const t = setTimeout(() => {
      setPhase("gone");
      setBootReady();
    }, 350);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <BootScreen
      progress={p.progress}
      label={p.label}
      leaving={phase === "leaving"}
      error={p.accountError ? "We could not load your account." : undefined}
      onRetry={() => window.location.reload()}
    />
  );
}
