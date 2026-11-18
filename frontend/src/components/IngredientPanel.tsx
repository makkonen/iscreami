import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { RecipeRow } from "../hooks/useRecipeCalculator";

interface IngredientPanelProps {
  readonly rows: RecipeRow[];
  readonly onWeightChange: (ingredientId: string, weight: number) => void;
  readonly onRemove: (ingredientId: string) => void;
}

interface IngredientRowWithPct {
  row: RecipeRow;
  pct: number;
  originalIndex: number;
}

const GRID =
  "grid grid-cols-[minmax(0,1fr)_76px_52px_28px] sm:grid-cols-[minmax(0,1fr)_minmax(80px,170px)_76px_52px_28px] gap-x-2";

/** Round up to 1, 2 or 5 × 10^k. */
function niceCeil(v: number): number {
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= v - 1e-9) return m * base;
  return 10 * base;
}

/**
 * Slider end for a row: 0 to twice the reference weight, so the handle starts
 * centred. That suits 0.3 g of gum and 300 g of cream alike.
 */
function sliderMax(ref: number): number {
  return ref > 0 ? ref * 2 : 10;
}

function sliderStep(max: number): number {
  return Math.max(0.01, niceCeil(max / 1000));
}

function fmtWeight(w: number): string {
  return Number(w.toFixed(2)).toString();
}

interface WeightInputProps {
  readonly name: string;
  readonly weight: number;
  readonly onChange: (weight: number) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

/** Keeps the typed text while focused (so "0." survives) and shows the live weight otherwise. */
function WeightInput({ name, weight, onChange, onFocus, onBlur }: WeightInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={0}
      // Arrow keys nudge in steps that suit the amount: 0.01 g for gums and salt, 1 g for cream.
      step={weight < 3 ? 0.01 : weight < 10 ? 0.1 : 1}
      value={draft ?? fmtWeight(weight)}
      aria-label={`Weight for ${name} in grams`}
      onFocus={() => {
        setDraft(fmtWeight(weight));
        onFocus();
      }}
      onBlur={() => {
        setDraft(null);
        onBlur();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(Math.max(0, Number.parseFloat(e.target.value) || 0));
      }}
      className="input input-bordered input-xs w-full text-right tabular-nums"
    />
  );
}

export function IngredientPanel({
  rows,
  onWeightChange,
  onRemove,
}: IngredientPanelProps) {
  // While a weight is being dragged or typed, keep the row order and the
  // slider's scale fixed so nothing jumps out from under the cursor.
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const [frozenMax, setFrozenMax] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  // Weight each slider's scale is based on. It's kept after a drag, so the
  // handle stays where you left it, and only resets when a drag ends near
  // either end of the track (or the weight is typed).
  const [refWeights, setRefWeights] = useState<Record<string, number>>({});
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const totalWeight = rows.reduce((sum, r) => sum + r.weight_grams, 0);
  const rowsWithPct: IngredientRowWithPct[] = rows.map((row, index) => ({
    row,
    pct: totalWeight > 0 ? (row.weight_grams / totalWeight) * 100 : 0,
    // Keep original insertion order as tie-breaker when percentages are equal.
    originalIndex: index,
  }));
  const sortedRows = [...rowsWithPct].sort((a, b) => {
    if (frozenOrder) {
      const ai = frozenOrder.indexOf(a.row.ingredient.id);
      const bi = frozenOrder.indexOf(b.row.ingredient.id);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    }
    if (b.pct !== a.pct) return b.pct - a.pct;
    return a.originalIndex - b.originalIndex;
  });

  const freeze = () => {
    setFrozenOrder((cur) => cur ?? sortedRows.map((r) => r.row.ingredient.id));
  };
  const unfreeze = useCallback(() => {
    setFrozenOrder(null);
    setFrozenMax({});
    setDragging(null);
  }, []);

  // A drag can end outside the slider, so listen on the window.
  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      const max = frozenMax[dragging];
      const weight = rowsRef.current.find((r) => r.ingredient.id === dragging)?.weight_grams ?? 0;
      if (max && (weight < max * 0.1 || weight > max * 0.9)) {
        setRefWeights((m) => ({ ...m, [dragging]: weight }));
      }
      unfreeze();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, frozenMax, unfreeze]);

  return (
    <div className="space-y-1">
      {/* Header */}
      <div
        className={`${GRID} px-2 py-1.5 rounded-md bg-base-200/40 text-xs font-semibold text-base-content/50 uppercase tracking-wider items-center`}
      >
        <span>Ingredient</span>
        <span className="hidden sm:block" />
        <span className="text-right">Grams</span>
        <span className="text-right">%</span>
        <span></span>
      </div>

      {rows.length === 0 && (
        <div className="rounded-md border border-dashed border-base-300 bg-base-200/20 px-3 py-4 text-sm text-base-content/45 italic">
          Search and add ingredients above
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-0.5">
          <div className="px-2 pt-2 pb-1">
            <p className="text-xs text-base-content/45 leading-snug">
              Sorted by contribution (%). Sliders start centred and go from none to double the
              weight; the analysis updates as you drag.
            </p>
          </div>

          {sortedRows.map(({ row, pct }) => {
            const id = row.ingredient.id;
            const max = frozenMax[id] ?? sliderMax(refWeights[id] ?? row.weight_grams);
            const step = sliderStep(max);
            return (
              <div key={id} className={`${GRID} gap-y-1 items-center px-2 py-1.5 rounded hover:bg-base-200/50`}>
                <div className="min-w-0">
                  <span className="text-sm font-medium truncate block" title={row.ingredient.name}>
                    {row.ingredient.name}
                  </span>
                  {row.ingredient.category && (
                    <span className="text-xs text-base-content/40">{row.ingredient.category.name}</span>
                  )}
                </div>
                <div className="relative flex items-center order-last col-span-full sm:order-none sm:col-span-1">
                  <input
                    type="range"
                    min={0}
                    max={max}
                    step={step}
                    value={Math.min(row.weight_grams, max)}
                    aria-label={`Adjust ${row.ingredient.name}`}
                    title={`0 – ${fmtWeight(max)} g`}
                    onPointerDown={() => {
                      freeze();
                      setFrozenMax((m) => ({ ...m, [id]: max }));
                      setDragging(id);
                    }}
                    onKeyDown={freeze}
                    onBlur={() => {
                      if (!dragging) unfreeze();
                    }}
                    onChange={(e) => onWeightChange(id, Number(Number.parseFloat(e.target.value).toFixed(2)))}
                    className="range range-xs range-primary w-full"
                  />
                </div>
                <WeightInput
                  name={row.ingredient.name}
                  weight={row.weight_grams}
                  onChange={(w) => {
                    setRefWeights((m) => ({ ...m, [id]: w }));
                    onWeightChange(id, w);
                  }}
                  onFocus={freeze}
                  onBlur={unfreeze}
                />
                <span className="text-right text-sm tabular-nums text-base-content/60">
                  {pct.toFixed(pct < 1 ? 2 : 1)}%
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
                  aria-label={`Remove ${row.ingredient.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Total */}
      {rows.length > 0 && (
        <div className={`${GRID} px-2 py-2 border-t border-base-200 mt-2 rounded-md bg-base-200/30`}>
          <span className="text-sm font-semibold">Total</span>
          <span className="hidden sm:block" />
          <span className="text-right text-sm font-semibold tabular-nums">{totalWeight.toFixed(0)}</span>
          <span className="text-right text-sm font-semibold">100%</span>
          <span></span>
        </div>
      )}
    </div>
  );
}
