import { useState } from "react";
import { Lock, Scale, X } from "lucide-react";
import type { BalanceGoal, BalanceResponse, CalculateResponse } from "../types";
import type { RecipeRow } from "../hooks/useRecipeCalculator";
import { rowKey } from "../hooks/useRecipeCalculator";
import { METRIC_LABELS } from "../lib/metrics";
import { useEscape } from "../hooks/useEscape";
import { KJ_PER_KCAL } from "../lib/formatting";

const GOALS: { id: BalanceGoal; label: string; hint: string }[] = [
  { id: "closest", label: "Change as little as possible", hint: "Fix what's out of range with the smallest edits." },
  { id: "centred", label: "Most centred", hint: "Aim for the middle of every range, not just inside it." },
  { id: "min_kcal", label: "Fewest calories", hint: "Stay in range with the lowest energy per 100 g." },
  { id: "max_protein", label: "Most protein", hint: "Stay in range with as much protein as the style allows." },
];

interface BalanceModalProps {
  readonly rows: RecipeRow[];
  readonly lockedKeys: ReadonlySet<string>;
  readonly current: CalculateResponse | null;
  readonly onRun: (goal: BalanceGoal, allowBigChanges: boolean) => Promise<BalanceResponse>;
  readonly onApply: (proposal: BalanceResponse) => void;
  readonly onClose: () => void;
}

function fmtG(w: number): string {
  return w < 10 ? w.toFixed(2) : w.toFixed(1);
}

export function BalanceModal({ rows, lockedKeys, current, onRun, onApply, onClose }: BalanceModalProps) {
  const [goal, setGoal] = useState<BalanceGoal>("closest");
  const [allowBig, setAllowBig] = useState(false);
  const [proposal, setProposal] = useState<BalanceResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose, true);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setProposal(await onRun(goal, allowBig));
    } catch (e) {
      setProposal(null);
      setError(e instanceof Error ? e.message : "Balancing failed.");
    } finally {
      setRunning(false);
    }
  }

  const proposed = new Map(
    (proposal?.ingredients ?? []).map((i) => [`${i.ingredient_id}:${i.is_addin ? "addin" : "mix"}`, i.weight_grams]),
  );
  const mixRows = rows.filter((r) => !r.is_addin);
  const kcal = (r: CalculateResponse | null | undefined) =>
    r ? r.nutrition.per_100g.energy_kj / KJ_PER_KCAL : null;

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="Balance recipe">
      <div className="modal-box max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Scale size={18} /> Balance recipe
          </h3>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-base-content/60 mb-3">
          Adjusts the unlocked mix ingredients to bring every target into range, keeping the batch size.
          Add-ins and locked rows aren&apos;t changed.
        </p>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <legend className="sr-only">Goal</legend>
          {GOALS.map((g) => (
            <label
              key={g.id}
              className={`rounded-lg border p-2.5 cursor-pointer ${goal === g.id ? "border-primary bg-primary/10" : "border-base-300"}`}
            >
              <input
                type="radio"
                name="balance-goal"
                className="radio radio-xs radio-primary mr-2 align-middle"
                checked={goal === g.id}
                onChange={() => {
                  setGoal(g.id);
                  setProposal(null);
                }}
              />
              <span className="text-sm font-medium align-middle">{g.label}</span>
              <span className="block text-xs text-base-content/55 mt-1">{g.hint}</span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-start gap-2 text-sm mb-4 cursor-pointer">
          <input
            type="checkbox"
            className="checkbox checkbox-xs mt-0.5"
            checked={allowBig}
            onChange={(e) => {
              setAllowBig(e.target.checked);
              setProposal(null);
            }}
          />
          <span>
            Allow big changes
            <span className="block text-xs text-base-content/55">
              Normally each ingredient stays between half and double its weight so the recipe keeps its
              character. Typical-use limits always apply.
            </span>
          </span>
        </label>

        {error && <div className="alert alert-error text-sm mb-3">{error}</div>}

        {proposal && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th className="text-right">Now</th>
                    <th className="text-right">Balanced</th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {mixRows.map((r) => {
                    const key = rowKey(r);
                    const after = proposed.get(key) ?? r.weight_grams;
                    const delta = after - r.weight_grams;
                    const changed = Math.abs(delta) >= 0.005;
                    return (
                      <tr key={key} className={changed ? "" : "text-base-content/45"}>
                        <td>
                          {lockedKeys.has(key) && <Lock size={11} className="inline mr-1 -mt-0.5" aria-label="locked" />}
                          {r.ingredient.name}
                        </td>
                        <td className="text-right tabular-nums">{fmtG(r.weight_grams)}</td>
                        <td className="text-right tabular-nums font-medium">{fmtG(after)}</td>
                        <td className={`text-right tabular-nums ${delta > 0 ? "text-success" : delta < 0 ? "text-error" : ""}`}>
                          {changed ? `${delta > 0 ? "+" : ""}${fmtG(delta)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {kcal(current) != null && (
                <span>
                  Energy: {kcal(current)!.toFixed(0)} → <strong>{kcal(proposal.result)!.toFixed(0)}</strong> kcal/100 g
                </span>
              )}
              {current && (
                <span>
                  Protein: {current.composition.protein_pct.toFixed(1)} →{" "}
                  <strong>{proposal.result.composition.protein_pct.toFixed(1)}</strong>%
                </span>
              )}
            </div>

            {proposal.unmet.length === 0 ? (
              <div className="alert alert-success text-sm py-2">Every target is in range.</div>
            ) : (
              <div className="alert alert-warning text-sm py-2 block">
                <p className="font-medium">Couldn&apos;t meet every target with these ingredients:</p>
                <ul className="mt-1 list-disc list-inside">
                  {proposal.unmet.map((u) => (
                    <li key={u.metric}>
                      {METRIC_LABELS[u.metric] ?? u.metric}: {u.value.toFixed(1)} (target{" "}
                      {u.target_min ?? "…"}–{u.target_max ?? "…"})
                    </li>
                  ))}
                </ul>
                {!allowBig && (
                  <p className="mt-1 text-xs">Try allowing big changes, unlocking rows, or adding an ingredient.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-outline" onClick={() => void run()} disabled={running}>
            {running ? <span className="loading loading-spinner loading-xs" /> : proposal ? "Re-run" : "Preview"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!proposal || running}
            onClick={() => proposal && onApply(proposal)}
          >
            Apply
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Close balance dialog" />
    </div>
  );
}
