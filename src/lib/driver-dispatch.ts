import { ACTIVE_STATUSES, TRANSIT_STATUSES } from "@/lib/tms";

type DriverLoad = {
  driver_id: string | null;
  status: string;
};

export function automaticDriverDispatchState(
  loads: DriverLoad[],
  driverId: string,
): { dispatch_status: "covered" | "prebook" | "in_transit"; status: "available" | "on_load" } {
  const activeLoads = loads.filter(
    (load) => load.driver_id === driverId && ACTIVE_STATUSES.includes(load.status),
  );
  const inTransit = activeLoads.some((load) => TRANSIT_STATUSES.includes(load.status));
  const hasBookedLoad = activeLoads.some((load) =>
    ["booked", "upcoming", "assigned", "dispatched", "at_pickup", "loading"].includes(load.status),
  );

  return {
    dispatch_status: inTransit ? (hasBookedLoad ? "prebook" : "in_transit") : "covered",
    status: inTransit ? "on_load" : "available",
  };
}
