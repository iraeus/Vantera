import { label, statusTone } from "@/lib/tms";

const TONE_CLASS: Record<string, string> = {
  accent: "bg-accent/12 text-accent",
  transit: "bg-transit/12 text-transit",
  delivered: "bg-delivered/12 text-delivered",
  problem: "bg-problem/12 text-problem",
  mut: "bg-line/60 text-mut",
};

const DOT_CLASS: Record<string, string> = {
  accent: "bg-accent",
  transit: "bg-transit",
  delivered: "bg-delivered",
  problem: "bg-problem",
  mut: "bg-mut",
};

export function StatusPill({ status }: { status?: string | null }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT_CLASS[tone]}`} />
      {label(status)}
    </span>
  );
}
