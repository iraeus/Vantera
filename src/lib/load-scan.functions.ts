import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ScannedLoad = {
  load_number: string;
  rate: number | null;
  miles: number | null;
  equipment_type: string;
  tractor: string;
  trailer: string;
  driver: string;
  stops: { kind: "pickup" | "drop"; facility_code: string; address: string; city: string; scheduled: string }[];
  notes: string;
  broker: { name: string; mc_number: string; dot_number: string; phone: string; email: string; address: string };
};

const str = { type: "string" };
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["load_number", "rate", "miles", "equipment_type", "tractor", "trailer", "driver", "stops", "notes", "broker"],
  properties: {
    load_number: { ...str, description: "Amazon load/trip ID like T-112ABCD9X or 1112SASFQW34; empty if none" },
    rate: { type: ["number", "null"], description: "Total payout in USD" },
    miles: { type: ["number", "null"] },
    equipment_type: { ...str, description: "e.g. 53' Dry van, Reefer; empty if unknown" },
    tractor: { ...str, description: "Tractor/truck/unit number; empty if not shown" },
    trailer: { ...str, description: "Trailer number; empty if not shown" },
    driver: { ...str, description: "Driver name; empty if not shown" },
    stops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "facility_code", "address", "city", "scheduled"],
        properties: {
          kind: { type: "string", enum: ["pickup", "drop"] },
          facility_code: { ...str, description: "Amazon facility code like SAT3; empty if none" },
          address: str,
          city: { ...str, description: "City, ST" },
          scheduled: { ...str, description: "Scheduled date/time as ISO 8601 local, e.g. 2026-10-06T08:00; empty if unknown" },
        },
      },
    },
    notes: { ...str, description: "Any other useful details (extra stops, reference numbers)" },
    broker: {
      type: "object",
      additionalProperties: false,
      required: ["name", "mc_number", "dot_number", "phone", "email", "address"],
      description: "The broker/customer company issuing the load — identify from the logo, letterhead or text. Use 'Amazon' for Amazon Relay.",
      properties: {
        name: str,
        mc_number: { ...str, description: "MC number digits only; empty if not shown" },
        dot_number: { ...str, description: "USDOT number digits only; empty if not shown" },
        phone: str,
        email: str,
        address: str,
      },
    },
  },
};

// Gemini's schema format is a subset of JSON Schema: no "additionalProperties",
// and nullable types are written as { type: "number", nullable: true }.
function toGeminiSchema(node: any): any {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "additionalProperties") continue;
      if (k === "type" && Array.isArray(v)) {
        const types = (v as string[]).filter((t) => t !== "null");
        out.type = types[0] ?? "string";
        if (v.includes("null")) out.nullable = true;
      } else {
        out[k] = toGeminiSchema(v);
      }
    }
    return out;
  }
  return node;
}

// Google retires old Gemini models over time (gemini-2.5-flash now returns 404).
// We try these in order and use the first one that exists. To force a model,
// add GEMINI_MODEL=<name> to your .env file.
function geminiModels(): string[] {
  const list = [process.env["GEMINI_MODEL"], "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
  return Array.from(new Set(list.filter((m): m is string => !!m)));
}

export const scanLoadFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ dataUrl: z.string().max(15_000_000), mime: z.string(), name: z.string() })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ load?: ScannedLoad; error?: string }> => {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) return { error: "AI is not configured (add GEMINI_API_KEY to your .env file)" };
    const isPdf = data.mime === "application/pdf";
    if (!isPdf && !data.mime.startsWith("image/")) return { error: "Upload an image or PDF" };
    const base64 = data.dataUrl.includes(",") ? data.dataUrl.split(",")[1] : data.dataUrl;
    const year = new Date().getFullYear();
    const prompt = `Extract the trucking load details from this rate confirmation or Amazon Relay document. Identify the broker company from its logo or letterhead. List stops in order. Use year ${year} when the year is missing. Leave fields empty / null when not shown — never guess.`;

    const requestBody = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inline_data: { mime_type: data.mime, data: base64 } }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schema),
      },
    });

    let res: Response | null = null;
    for (const model of geminiModels()) {
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: requestBody,
          },
        );
      } catch (e) {
        console.error("scan failed", e);
        return { error: "Couldn't reach the AI service. Check your internet connection." };
      }
      if (res.status !== 404) break; // 404 = this model name no longer exists, try the next one
      console.error(`Gemini model "${model}" not found (404), trying the next one`);
    }
    if (!res) return { error: "No Gemini model is configured" };
    if (res.status === 404) {
      return { error: "No available Gemini model was found. Set GEMINI_MODEL in your .env file to a current model name." };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("scan failed", res.status, body);
      if (res.status === 429) return { error: "AI is busy or the free limit was reached, try again in a minute" };
      if (res.status === 400 && body.includes("API key")) return { error: "Your GEMINI_API_KEY is not valid" };
      if (res.status === 400 && body.includes("free tier")) return { error: "Gemini free tier is not available in your country" };
      if (res.status === 403) return { error: "Gemini key was rejected (check the key)" };
      return { error: `Scan failed (${res.status})` };
    }

    const json: any = await res.json().catch(() => null);
    if (json?.promptFeedback?.blockReason) return { error: "The AI declined to read this file" };
    const out: string = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
    try {
      return { load: JSON.parse(out) as ScannedLoad };
    } catch {
      return { error: "Couldn't read load details from this file" };
    }
  });
