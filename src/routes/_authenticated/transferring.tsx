import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { GhostButton, Panel } from "@/components/ui-kit";
import { TransferBoard } from "@/components/transfer-board";
import { TransferLibrary } from "@/components/transfer-library";
import { TransferSetup } from "@/components/transfer-setup";

export const Route = createFileRoute("/_authenticated/transferring")({
  head: () => ({
    meta: [
      { title: "Transferring — Vantera TMS" },
      { name: "description", content: "Company change checklist per driver: ELD, stickers, lease agreement, Amazon Relay setup." },
    ],
  }),
  component: TransferringPage,
});

function TransferringPage() {
  const { data: me } = useCurrentUser();
  const [tab, setTab] = useState<"board" | "templates" | "setup">("board");
  return (
    <div className="space-y-4">
      <Panel className="no-print flex flex-wrap items-center gap-2 p-3">
        <GhostButton active={tab === "board"} onClick={() => setTab("board")}>Board</GhostButton>
        <GhostButton active={tab === "templates"} onClick={() => setTab("templates")}>Templates and files</GhostButton>
        {me?.isSupervisor && <GhostButton active={tab === "setup"} onClick={() => setTab("setup")}>Steps setup</GhostButton>}
        <span className="ml-auto text-[11px] text-mut">Everyone on the team can update this page.</span>
      </Panel>
      {tab === "board" && <TransferBoard />}
      {tab === "templates" && <TransferLibrary />}
      {tab === "setup" && me?.isSupervisor && <TransferSetup />}
    </div>
  );
}
