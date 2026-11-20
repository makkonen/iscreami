import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Milk, X } from "lucide-react";
import { fetchIngredients } from "../api";
import { rowKey, type RecipeRow } from "../hooks/useRecipeCalculator";
import { useEscape } from "../hooks/useEscape";
import { type DairyPart, isSwappableDairy, planDairySwap, roundGrams, totalOf } from "../lib/dairySwap";
import type { Ingredient } from "../types";

const ON_HAND_KEY = "dairyOnHand";

function loadOnHand(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ON_HAND_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveOnHand(ids: Set<string>) {
  try {
    localStorage.setItem(ON_HAND_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private mode); the choice just won't be remembered.
  }
}

/**
 * Your own and the built-in milks, creams and milk powders (liquids first,
 * each lightest first), plus plain water. Bulk imports are left out.
 */
async function fetchDairy(): Promise<{ dairy: Ingredient[]; water?: Ingredient }> {
  const all = (
    await Promise.all(
      ["icc4", "manual", "seed"].map((source) => fetchIngredients({ source, limit: 200 }).then((p) => p.items)),
    )
  ).flat();
  const powder = (i: Ingredient) => ((i.water_pct ?? 0) < 50 ? 1 : 0);
  const dairy = all
    .filter(isSwappableDairy)
    .sort(
      (a, b) =>
        powder(a) - powder(b) || (a.total_fat_pct ?? 0) - (b.total_fat_pct ?? 0) || a.name.localeCompare(b.name),
    );
  return { dairy, water: all.find((i) => i.name.trim().toLowerCase() === "water") };
}

interface DairySwapModalProps {
  readonly rows: RecipeRow[];
  /** Replace the chosen rows' dairy with these parts, in one undoable step. */
  readonly onApply: (replaceKeys: string[], parts: DairyPart[]) => void;
  readonly onClose: () => void;
}

const fmt = (g: number) => (g < 10 ? g.toFixed(1) : g.toFixed(0));

export function DairySwapModal({ rows, onApply, onClose }: DairySwapModalProps) {
  useEscape(onClose, true);
  const { data } = useQuery({ queryKey: ["dairy-on-hand-options"], queryFn: fetchDairy });
  const dairy = data?.dairy;
  const swappable = rows.filter((r) => !r.is_addin && r.weight_grams > 0 && isSwappableDairy(r.ingredient));
  const [replace, setReplace] = useState<Set<string>>(() => new Set(swappable.map(rowKey)));
  const [onHand, setOnHand] = useState<Set<string>>(loadOnHand);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const current: DairyPart[] = swappable
    .filter((r) => replace.has(rowKey(r)))
    .map((r) => ({ ingredient: r.ingredient, grams: r.weight_grams }));
  const available = (dairy ?? []).filter((i) => onHand.has(i.id));
  const plan = planDairySwap(current, available, data?.water);
  const solidsChange = plan ? totalOf(plan.parts, (i) => i.msnf_pct ?? 0) - totalOf(current, (i) => i.msnf_pct ?? 0) : 0;

  const compare = (label: string, value: (i: Ingredient) => number, unit = "g") => {
    if (!plan) return null;
    const before = totalOf(current, value);
    const after = totalOf(plan.parts, value);
    const diff = after - before;
    return (
      <tr key={label}>
        <td>{label}</td>
        <td className="text-right tabular-nums">
          {fmt(before)} {unit}
        </td>
        <td className="text-right tabular-nums">
          {fmt(after)} {unit}
        </td>
        <td className={`text-right tabular-nums ${Math.abs(diff) >= 0.5 ? "font-medium" : "text-base-content/40"}`}>
          {Math.abs(diff) < 0.05 ? "same" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))} ${unit}`}
        </td>
      </tr>
    );
  };

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="Swap dairy">
      <div className="modal-box max-w-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Milk size={18} /> Swap dairy
          </h3>
          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-sm text-base-content/60">
          Milks, creams and milk powders are fat plus milk solids plus water, so the recipe&apos;s dairy can be rebuilt
          from what you have, keeping its weight, fat and milk solids.{" "}
          {data?.water ? "Water is always on hand, for reconstituting powder." : ""}
        </p>

        {swappable.length === 0 ? (
          <p className="text-sm italic text-base-content/55">No milk, cream or milk powder in the mix to swap.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Replace</legend>
              {swappable.map((r) => (
                <label key={rowKey(r)} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={replace.has(rowKey(r))}
                    onChange={() => setReplace((s) => toggle(s, rowKey(r)))}
                  />
                  <span className="min-w-0 flex-1 truncate">{r.ingredient.name}</span>
                  <span className="tabular-nums text-base-content/55">{fmt(r.weight_grams)} g</span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">What you have</legend>
              {!dairy && <span className="loading loading-dots loading-sm" />}
              {dairy?.map((i) => (
                <label key={i.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={onHand.has(i.id)}
                    onChange={() =>
                      setOnHand((s) => {
                        const next = toggle(s, i.id);
                        saveOnHand(next);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  <span className="tabular-nums text-base-content/55">{(i.total_fat_pct ?? 0).toFixed(1)}% fat</span>
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {current.length > 0 && available.length === 0 && (
          <p className="mt-4 text-sm text-base-content/55">Tick what you have to see the swap.</p>
        )}

        {plan && (
          <div className="mt-4 rounded-lg border border-base-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-base-content/60">
                {current.map((p) => `${fmt(p.grams)} g ${p.ingredient.name}`).join(" + ")}
              </span>
              <ArrowRight size={14} className="shrink-0" />
              <span className="font-medium">
                {plan.parts.map((p) => `${fmt(roundGrams(p.grams))} g ${p.ingredient.name}`).join(" + ")}
              </span>
            </div>
            {!plan.fatKept && (
              <p className="mt-2 text-sm text-warning">
                Nothing you have spans this fat level, so the closest one is used and the fat changes.
              </p>
            )}
            {plan.fatKept && !plan.solidsKept && (
              <p className="mt-2 text-sm text-warning">
                Milk solids {solidsChange < 0 ? "drop" : "rise"} by {fmt(Math.abs(solidsChange))} g. Tick a milk powder
                you have to make up the difference, or untick the powder in the recipe to leave it as it is.
              </p>
            )}
            <table className="table table-xs mt-2">
              <thead>
                <tr>
                  <th>In the dairy</th>
                  <th className="text-right">Now</th>
                  <th className="text-right">After</th>
                  <th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {compare("Fat", (i) => i.total_fat_pct ?? 0)}
                {compare("Milk solids (MSNF)", (i) => i.msnf_pct ?? 0)}
                {compare("Protein", (i) => i.protein_pct ?? 0)}
                {compare("Sugars", (i) => i.total_sugar_pct ?? 0)}
                {compare("Water", (i) => i.water_pct ?? 0)}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!plan}
            onClick={() =>
              plan &&
              onApply(
                [...replace].filter((k) => swappable.some((r) => rowKey(r) === k)),
                plan.parts.map((p) => ({ ...p, grams: roundGrams(p.grams) })),
              )
            }
          >
            Apply swap
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Close" />
    </div>
  );
}
