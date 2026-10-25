import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Public (no login): the driver's phone page identifies the driver by the secret token in its link. */
export const getCheckinView = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => z.object({ token: z.string().min(10).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { getCheckin } = await import("@/lib/checkin.server");
    return await getCheckin(data.token);
  });

export const sendCheckin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(10).max(80),
        status: z.string().max(40).optional(),
        location: z.string().max(120).optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        note: z.string().max(500).optional(),
        problem: z.boolean().optional(),
        photo: z.object({ dataUrl: z.string().max(3_600_000), name: z.string().max(120), kind: z.string().max(10) }).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { submitCheckin } = await import("@/lib/checkin.server");
    return await submitCheckin(data);
  });
