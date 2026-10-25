import { useEffect, useState, useSyncExternalStore } from "react";
import { useCurrentUser } from "./useCurrentUser";
import { useRolePermissions } from "./usePermissions";
import { useDrivers, useLoads, useProfiles, useTrailers, useTrucks } from "./useTms";
import { useShifts, useShiftTimes } from "./useShifts";
import { useTasks } from "./useTasks";
import { bootState } from "@/lib/boot";

/** Heavy background parts (like the alerts bell) wait until the loading screen is gone. */
let bootReady = false;
const listeners = new Set<() => void>();
export const setBootReady = () => {
  bootReady = true;
  listeners.forEach((l) => l());
};
export const useBootReady = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => bootReady,
    () => false,
  );

const MIN_MS = 500; // never flash the screen for a split second
const MAX_MS = 10_000; // never keep someone waiting longer than this

/** What has to load before the app is shown, as a progress number and the name of what is loading now. */
export function useBootProgress() {
  const me = useCurrentUser();
  const checks: { label: string; status: string }[] = [
    { label: "Checking your account…", status: me.status },
    { label: "Loading your permissions…", status: useRolePermissions().status },
    { label: "Loading loads…", status: useLoads().status },
    { label: "Loading drivers…", status: useDrivers().status },
    { label: "Loading trucks and trailers…", status: useTrucks().status },
    { label: "Loading trailers…", status: useTrailers().status },
    { label: "Loading your team…", status: useProfiles().status },
    { label: "Loading shifts…", status: useShifts().status },
    { label: "Loading shift times…", status: useShiftTimes().status },
    { label: "Loading tasks…", status: useTasks().status },
  ];
  const [minDone, setMinDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [latched, setLatched] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setMinDone(true), MIN_MS);
    const b = setTimeout(() => setTimedOut(true), MAX_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  const st = bootState(checks, minDone, timedOut);
  useEffect(() => {
    if (st.ready) setLatched(true);
  }, [st.ready]);

  return { ready: latched || st.ready, progress: st.progress, label: st.label, accountError: st.accountError };
}
