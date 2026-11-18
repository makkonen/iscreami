import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownRight, CornerUpLeft, Trash2 } from "lucide-react";
import { rowKey, type RecipeRow } from "../hooks/useRecipeCalculator";
import type { MetricComparison } from "../types";
import { inSpecBand, type WeightBand } from "../lib/inSpec";

interface IngredientPanelProps {
  readonly rows: RecipeRow[];
  /** Current target comparisons; used to show each ingredient's in-spec weight band. */
  readonly comparisons: MetricComparison[] | null;
  readonly onWeightChange: (key: string, weight: number) => void;
  readonly onRemove: (key: string) => void;
  /** Move a row between the mix and the add-ins. */
  readonly onToggleAddin: (key: string) => void;
  /** Set several weights at once, keyed by row (used to scale the batch). */
  readonly onSetWeights: (weights: Record<string, number>) => void;
}

interface IngredientRowWithPct {
  row: RecipeRow;
  key: string;
  pct: number;
  /** Index within its own section (mix or add-ins). */
  sectionIndex: number;
}

const GRID =
  "grid grid-cols-[minmax(0,1fr)_76px_52px_28px_28px] sm:grid-cols-[minmax(0,1fr)_minmax(80px,170px)_76px_52px_28px_28px] gap-x-2";

/** Round up to 1, 2 or 5 × 10^k. */
function niceCeil(v: number): number {
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= v - 1e-9) return m * base;
  return 10 * base;
}

/**
 * Slider end for a row. By default 0 to twice the reference weight, so the
 * handle starts centred; that suits 0.3 g of gum and 300 g of cream alike. If
 * the in-spec band ends before double, the scale shrinks toward it (handle sits
 * right); if the band starts beyond double, it stretches (handle sits left).
 */
function sliderMax(ref: number, band: WeightBand | null): number {
  const max = ref > 0 ? ref * 2 : 10;
  if (band && band.hi > 0 && band.hi < max) return Math.max(band.hi * 1.25, ref * 1.1);
  if (band && band.lo > max) return band.lo * 1.25;
  return max;
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
  comparisons,
  onWeightChange,
  onRemove,
  onToggleAddin,
  onSetWeights,
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

  const mixRows = rows.filter((r) => !r.is_addin);
  const addinRows = rows.filter((r) => r.is_addin);
  // Both sections show % of the mix: an add-in at 15% is 15 g per 100 g of base.
  const mixWeight = mixRows.reduce((sum, r) => sum + r.weight_grams, 0);
  const addinWeight = addinRows.reduce((sum, r) => sum + r.weight_grams, 0);

  const withPct = (section: RecipeRow[]): IngredientRowWithPct[] =>
    section
      .map((row, sectionIndex) => ({
        row,
        key: rowKey(row),
        pct: mixWeight > 0 ? (row.weight_grams / mixWeight) * 100 : 0,
        sectionIndex,
      }))
      .sort((a, b) => {
        if (frozenOrder) {
          const ai = frozenOrder.indexOf(a.key);
          const bi = frozenOrder.indexOf(b.key);
          return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
        }
        // Biggest first; insertion order breaks ties.
        if (b.pct !== a.pct) return b.pct - a.pct;
        return a.sectionIndex - b.sectionIndex;
      });
  const sortedMix = withPct(mixRows);
  const sortedAddins = withPct(addinRows);

  // Batch size: scales every row (add-ins too) from the weights captured when
  // the drag or edit began, so repeated scaling doesn't drift. The slider runs
  // 0 to double the mix and re-centres on release.
  const [scaleBase, setScaleBase] = useState<{ mix: number; weights: Record<string, number> } | null>(null);
  const beginScale = () => {
    if (scaleBase || mixWeight <= 0) return scaleBase;
    const base = { mix: mixWeight, weights: Object.fromEntries(rows.map((r) => [rowKey(r), r.weight_grams])) };
    setScaleBase(base);
    return base;
  };
  const scaleTo = (targetMix: number) => {
    const base = scaleBase ?? beginScale();
    if (!base || base.mix <= 0) return;
    const f = Math.max(0, targetMix) / base.mix;
    onSetWeights(Object.fromEntries(Object.entries(base.weights).map(([k, w]) => [k, Number((w * f).toFixed(2))])));
  };
  useEffect(() => {
    if (!scaleBase) return;
    const end = () => setScaleBase(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [scaleBase]);
  const scaleMax = (scaleBase?.mix ?? mixWeight) * 2;

  const freeze = () => {
    setFrozenOrder((cur) => cur ?? [...sortedMix, ...sortedAddins].map((r) => r.key));
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
      const weight = rowsRef.current.find((r) => rowKey(r) === dragging)?.weight_grams ?? 0;
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

  function renderRow({ row, key, pct, sectionIndex }: IngredientRowWithPct) {
    // Add-ins don't affect the mix's targets, so they have no in-spec band.
    const band = row.is_addin ? null : inSpecBand(mixRows, sectionIndex, comparisons);
    const max = frozenMax[key] ?? sliderMax(refWeights[key] ?? row.weight_grams, band);
    const step = sliderStep(max);
    const bandText = band
      ? ` · in spec ${fmtWeight(band.lo)}–${Number.isFinite(band.hi) ? fmtWeight(band.hi) : "∞"} g`
      : "";
    const name = row.ingredient.name;
    return (
      <div key={key} className={`${GRID} gap-y-1 items-center px-2 py-1.5 rounded hover:bg-base-200/50`}>
        <div className="min-w-0">
          <span className="text-sm font-medium truncate block" title={name}>
            {name}
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
            aria-label={`Adjust ${name}`}
            title={`0 – ${fmtWeight(max)} g${bandText}`}
            onPointerDown={() => {
              freeze();
              setFrozenMax((m) => ({ ...m, [key]: max }));
              setDragging(key);
            }}
            onKeyDown={freeze}
            onBlur={() => {
              if (!dragging) unfreeze();
            }}
            onChange={(e) => onWeightChange(key, Number(Number.parseFloat(e.target.value).toFixed(2)))}
            className="range range-xs range-primary w-full"
          />
          {band && band.lo < max && (
            <div
              className="pointer-events-none absolute -bottom-1 h-1 rounded-full bg-green-500/70 dark:bg-green-400/70"
              style={{
                left: `${(band.lo / max) * 100}%`,
                width: `${Math.max(1, ((Math.min(band.hi, max) - band.lo) / max) * 100)}%`,
              }}
              aria-hidden="true"
            />
          )}
        </div>
        <WeightInput
          name={name}
          weight={row.weight_grams}
          onChange={(w) => {
            setRefWeights((m) => ({ ...m, [key]: w }));
            onWeightChange(key, w);
          }}
          onFocus={freeze}
          onBlur={unfreeze}
        />
        <span className="text-right text-sm tabular-nums text-base-content/60">
          {pct.toFixed(pct < 1 ? 2 : 1)}%
        </span>
        <button
          type="button"
          onClick={() => onToggleAddin(key)}
          className="btn btn-ghost btn-xs text-base-content/40 hover:text-primary"
          aria-label={row.is_addin ? `Move ${name} into the mix` : `Make ${name} an add-in`}
          title={row.is_addin ? "Move into the mix" : "Make an add-in (folded in after freezing)"}
        >
          {row.is_addin ? <CornerUpLeft size={14} /> : <CornerDownRight size={14} />}
        </button>
        <button
          type="button"
          onClick={() => onRemove(key)}
          className="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
          aria-label={`Remove ${name}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

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
        <span></span>
      </div>

      {rows.length === 0 && (
        <div className="rounded-md border border-dashed border-base-300 bg-base-200/20 px-3 py-4 text-sm text-base-content/45 italic">
          Search and add ingredients above
        </div>
      )}

      {mixRows.length > 0 && (
        <div className="space-y-0.5">
          <div className="px-2 pt-2 pb-1">
            <p className="text-xs text-base-content/45 leading-snug">
              Sorted by contribution (%). Sliders start centred (none to double); the green strip
              under each is the weight range that keeps every target in spec, with the rest of the
              recipe unchanged.
            </p>
          </div>
          {sortedMix.map(renderRow)}
        </div>
      )}

      {/* Mix total: drag or type to scale the whole batch */}
      {mixRows.length > 0 && (
        <div className={`${GRID} gap-y-1 items-center px-2 py-2 border-t border-base-200 mt-2 rounded-md bg-base-200/30`}>
          <span className="text-sm font-semibold">Mix</span>
          <div className="flex items-center order-last col-span-full sm:order-none sm:col-span-1">
            <input
              type="range"
              min={0}
              max={scaleMax}
              step={Math.max(1, niceCeil(scaleMax / 1000))}
              value={Math.min(mixWeight, scaleMax)}
              aria-label="Scale the whole batch"
              title="Scale every ingredient (add-ins too); 0 to double, re-centres when you let go"
              onPointerDown={() => beginScale()}
              onChange={(e) => scaleTo(Number(e.target.value))}
              className="range range-xs w-full"
            />
          </div>
          <WeightInput
            name="the whole mix"
            weight={Math.round(mixWeight)}
            onChange={(w) => scaleTo(w)}
            onFocus={() => beginScale()}
            onBlur={() => setScaleBase(null)}
          />
          <span className="text-right text-sm font-semibold">100%</span>
          <span></span>
          <span></span>
        </div>
      )}

      {/* Add-ins */}
      {addinRows.length > 0 && (
        <div className="space-y-0.5 pt-3">
          <div className="px-2 pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/50">Add-ins</h3>
            <p className="text-xs text-base-content/45 leading-snug">
              Folded in after freezing: counted in nutrition, not in the mix&apos;s balance. % is of the mix.
            </p>
          </div>
          {sortedAddins.map(renderRow)}
          <div className={`${GRID} px-2 py-2 border-t border-base-200 mt-2 rounded-md bg-base-200/30`}>
            <span className="text-sm font-semibold">Total with add-ins</span>
            <span className="hidden sm:block" />
            <span className="text-right text-sm font-semibold tabular-nums">
              {(mixWeight + addinWeight).toFixed(0)}
            </span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
      {mixRows.length > 0 && addinRows.length === 0 && (
        <p className="px-2 pt-2 text-xs text-base-content/40">
          Mix-ins like nuts, cookie dough or ripples? Use <CornerDownRight size={11} className="inline" /> on a
          row to make it an add-in.
        </p>
      )}
    </div>
  );
}
