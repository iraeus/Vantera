import { useState } from "react";
import { toast } from "sonner";
import { useTransferActions, useTransferData } from "@/hooks/useTransfer";
import { TONES, activeSteps, optionsOf, type TOption, type TStep, type Tone } from "@/lib/transfer";
import { EmptyRow, GhostButton, Panel, PanelHeader, PrimaryButton, TextInput } from "./ui-kit";
import { MiniSelect } from "./entity-kit";

function OptionRow({ o, stepId, first, last, onMove }: { o: TOption; stepId: string; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const act = useTransferActions();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel2 px-2 py-1.5 ring-1 ring-line">
      <input
        key={`${o.id}-${o.label}`}
        defaultValue={o.label}
        onBlur={(e) => e.target.value.trim() && e.target.value !== o.label && act.updateOption(o.id, { label: e.target.value.trim() })}
        className="h-8 min-w-40 flex-1 rounded-md bg-ink px-2 text-xs text-fg ring-1 ring-line focus:outline-none"
      />
      <MiniSelect value={o.tone} onChange={(v) => act.updateOption(o.id, { tone: v as Tone })} options={TONES.map((t) => ({ value: t.value, text: t.text }))} />
      <label className="flex items-center gap-1 text-[11px] text-mut" title="A driver is finished when every step is on a choice that counts as done">
        <input type="checkbox" checked={o.is_done} onChange={(e) => act.updateOption(o.id, { is_done: e.target.checked })} /> counts as done
      </label>
      <label className="flex items-center gap-1 text-[11px] text-mut" title="The choice every driver starts on">
        <input type="radio" name={`default-${stepId}`} checked={o.is_default} onChange={() => act.makeDefault(stepId, o.id)} /> starts here
      </label>
      <label className="flex items-center gap-1 text-[11px] text-mut" title="Ask for the print shop's email, location and phone when this is chosen">
        <input type="checkbox" checked={o.asks_details} onChange={(e) => act.updateOption(o.id, { asks_details: e.target.checked })} /> asks for print shop
      </label>
      <span className="ml-auto flex gap-1">
        <GhostButton onClick={() => !first && onMove(-1)}>↑</GhostButton>
        <GhostButton onClick={() => !last && onMove(1)}>↓</GhostButton>
        <GhostButton onClick={() => confirm(`Delete the choice "${o.label}"? Drivers on it go back to the starting choice.`) && act.deleteOption(o.id)}>Delete</GhostButton>
      </span>
    </div>
  );
}

function StepCard({ step, first, last, onMove }: { step: TStep; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const { options } = useTransferData();
  const act = useTransferActions();
  const list = optionsOf(options, step.id);

  async function moveOption(i: number, dir: -1 | 1) {
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    await act.updateOption(a.id, { sort_order: b.sort_order });
    await act.updateOption(b.id, { sort_order: a.sort_order });
  }

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          key={`${step.id}-${step.label}`}
          defaultValue={step.label}
          onBlur={(e) => e.target.value.trim() && e.target.value !== step.label && act.updateStep(step.id, { label: e.target.value.trim() })}
          className="h-9 min-w-48 flex-1 rounded-lg bg-ink px-3 text-sm font-medium text-fg ring-1 ring-line focus:outline-none"
        />
        <GhostButton active={step.is_active} onClick={() => act.updateStep(step.id, { is_active: !step.is_active })}>{step.is_active ? "Shown on the board" : "Hidden"}</GhostButton>
        <GhostButton onClick={() => !first && onMove(-1)}>← Move</GhostButton>
        <GhostButton onClick={() => !last && onMove(1)}>Move →</GhostButton>
        <GhostButton onClick={() => confirm(`Delete the step "${step.label}" and every driver's choice for it?`) && act.deleteStep(step.id)}>Delete step</GhostButton>
      </div>
      <div className="space-y-1.5">
        {list.map((o, i) => <OptionRow key={o.id} o={o} stepId={step.id} first={i === 0} last={i === list.length - 1} onMove={(dir) => moveOption(i, dir)} />)}
        {list.length === 0 && <EmptyRow text="No choices yet." />}
      </div>
      <GhostButton onClick={() => act.addOption(step.id, (list[list.length - 1]?.sort_order ?? 0) + 1)}>+ Add a choice</GhostButton>
    </Panel>
  );
}

/** Setup tab: add or rename steps and their choices (supervisors and admins). */
export function TransferSetup() {
  const { steps } = useTransferData();
  const act = useTransferActions();
  const [name, setName] = useState("");
  const sorted = [...steps].sort((a, b) => a.sort_order - b.sort_order);
  const visible = activeSteps(steps).length;

  async function move(i: number, dir: -1 | 1) {
    const a = sorted[i];
    const b = sorted[i + dir];
    if (!a || !b) return;
    await act.updateStep(a.id, { sort_order: b.sort_order });
    await act.updateStep(b.id, { sort_order: a.sort_order });
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Steps on the board" count={`${visible} shown`} />
        <p className="px-4 py-3 text-xs text-mut">
          Each step is a column. For each step you choose which statuses exist, their color, which ones mean "done", and where drivers start.
          A driver turns green when every shown step is on a "done" choice. Changes apply to everyone.
        </p>
        <div className="flex items-end gap-2 px-4 pb-4">
          <div className="max-w-sm flex-1"><TextInput label="Add a new step" value={name} onChange={setName} placeholder="e.g. Insurance added" /></div>
          <PrimaryButton
            disabled={!name.trim()}
            onClick={async () => {
              await act.addStep(name.trim(), (sorted[sorted.length - 1]?.sort_order ?? 0) + 1);
              setName("");
              toast.success("Step added. Open it below to set its choices.");
            }}
          >
            Add step
          </PrimaryButton>
        </div>
      </Panel>
      {sorted.map((s, i) => <StepCard key={s.id} step={s} first={i === 0} last={i === sorted.length - 1} onMove={(dir) => move(i, dir)} />)}
    </div>
  );
}
