import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { MetricComparison, MetricStatus } from "../types";
import { InfoIcon } from "./InfoIcon";
import { TOOLTIPS } from "../lib/tooltips";
import { type FreezeMetric, METRIC_LABELS, visibleComparisons } from "../lib/metrics";
import { cToF } from "../lib/formatting";

// ─── Labels & units ───────────────────────────────────────────────────────────


const METRIC_UNITS: Record<string, string> = {
  pac: "",
  frozen_pct: "%",
  serving_temp: "°C",
};

const METRIC_TOOLTIPS: Record<string, string> = {
  pac: `${TOOLTIPS.pacMix}\n\nThe target range is the PAC that gives the right firmness for how this recipe is served.`,
  total_solids: TOOLTIPS.totalSolids,
  total_fat: TOOLTIPS.totalFat,
  milk_fat: TOOLTIPS.milkFat,
  sugar: TOOLTIPS.sugars,
  msnf: TOOLTIPS.msnf,
  stabilizer: TOOLTIPS.stabilizer,
  emulsifier: TOOLTIPS.emulsifier,
  protein: TOOLTIPS.protein,
  frozen_pct:
    "Share of the water frozen at the serving method's eating temperature (e.g. about −9 °C after a Creami ice cream spin). Scoopable is about 75%; soft serve and a fresh Creami spin are softer, popsicles firmer.",
  sweetness: TOOLTIPS.sweetness,
  serving_temp: TOOLTIPS.servingTemp,
};

// ─── Status config ────────────────────────────────────────────────────────────

interface StatusConfig {
  glyph: string;
  label: string;
}

// Colour shows how close to the centre a value is; the glyph says which way it
// is out, so the state doesn't rely on colour alone.
const STATUS_CONFIG: Record<MetricStatus, StatusConfig> = {
  in_range: { glyph: "", label: "In range" },
  below: { glyph: "▼", label: "Too low" },
  above: { glyph: "▲", label: "Too high" },
};

/**
 * How far off target a value is: 0 at the centre of the range, 1 at its edge,
 * 2 one half-range beyond. One-sided limits fade from 0 (well inside) to 1 at
 * the limit, using a quarter of the limit as the scale.
 */
function offTarget(value: number, min: number | null, max: number | null): number {
  if (min != null && max != null) {
    const half = Math.max((max - min) / 2, 1e-6);
    return Math.abs(value - (min + max) / 2) / half;
  }
  const limit = min ?? max;
  if (limit == null) return 0;
  const scale = Math.max(Math.abs(limit) * 0.25, 0.5);
  const over = min != null ? min - value : value - limit;
  return Math.max(0, 1 + over / scale);
}

/** Green (dead centre) through amber (range edge) to red (well outside). */
function hueFor(score: number): number {
  const s = Math.min(score, 2);
  return s <= 1 ? 140 - 90 * s : 50 - 50 * (s - 1);
}

// ─── Gauge bar ────────────────────────────────────────────────────────────────

/** Live drag of a metric's marker: the recipe follows the dragged value. */
export interface MetricDragHandlers {
  readonly isDraggable: (metric: string) => boolean;
  readonly start: (metric: string) => void;
  readonly move: (metric: string, value: number) => void;
  readonly end: () => void;
}

interface GaugeBarProps {
  readonly value: number;
  readonly targetMin: number | null;
  readonly targetMax: number | null;
  readonly hue: number;
  readonly label: string;
  /** When set, the marker can be dragged (pointer or arrow keys). */
  readonly onDrag?: { start: () => void; move: (value: number) => void; end: () => void };
}

function GaugeBar({ value, targetMin, targetMax, hue, label, onDrag }: GaugeBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // While dragging, the scale is frozen and the marker follows the pointer, so
  // the track doesn't rescale under the cursor as the recipe catches up.
  const [frozen, setFrozen] = useState<{ min: number; max: number } | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  // No target for this style: keep the grid cell so the row stays aligned.
  if (targetMin == null && targetMax == null) return <div aria-hidden="true" />;

  // Build a scale that comfortably contains both the target zone and the current value.
  // The padding ensures neither the zone nor the marker sits right at the track edge.
  const allValues = [value, targetMin ?? value, targetMax ?? value];
  const lo = Math.min(...allValues);
  const hi = Math.max(...allValues);
  const span = Math.max(hi - lo, 1);
  const pad = span * 0.38 + 0.5;
  const scaleMin = frozen?.min ?? lo - pad;
  const scaleMax = frozen?.max ?? hi + pad;
  const scaleRange = scaleMax - scaleMin;

  const toPos = (v: number) => ((v - scaleMin) / scaleRange) * 100;

  const shown = dragValue ?? value;
  const valuePos = toPos(shown);
  const zoneLeft = toPos(targetMin ?? scaleMin);
  const zoneRight = toPos(targetMax ?? scaleMax);

  const valueAt = (clientX: number, min: number, max: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return min + frac * (max - min);
  };
  const begin = (e: PointerEvent<HTMLDivElement>) => {
    if (!onDrag) return;
    try {
      // Keep receiving moves when the pointer leaves the track.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured; the drag still works within the track.
    }
    const scale = { min: scaleMin, max: scaleMax };
    setFrozen(scale);
    onDrag.start();
    const v = valueAt(e.clientX, scale.min, scale.max);
    setDragValue(v);
    onDrag.move(v);
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (!onDrag || !frozen) return;
    const v = valueAt(e.clientX, frozen.min, frozen.max);
    setDragValue(v);
    onDrag.move(v);
  };
  const finish = () => {
    if (!frozen) return;
    setFrozen(null);
    setDragValue(null);
    onDrag?.end();
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onDrag || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const step = (scaleMax - scaleMin) / 50;
    onDrag.start();
    onDrag.move(value + (e.key === "ArrowRight" ? step : -step));
    onDrag.end();
  };

  const track = (
    <div ref={trackRef} className="relative h-2 rounded-full bg-base-300" aria-hidden="true">
      {/* Target zone: green at the centre, amber toward the edges */}
      <div
        className="absolute inset-y-0 rounded-full border border-base-content/20"
        style={{
          left: `${zoneLeft}%`,
          width: `${zoneRight - zoneLeft}%`,
          background:
            targetMin != null && targetMax != null
              ? "linear-gradient(to right, hsl(50 90% 50% / 0.4), hsl(140 65% 45% / 0.55), hsl(50 90% 50% / 0.4))"
              : "hsl(140 65% 45% / 0.45)",
        }}
      />
      {/* Current-value marker */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ring-2 ring-base-100 shadow ${
          frozen ? "w-4 h-4" : "w-3.5 h-3.5 transition-[left,background-color] duration-150"
        }`}
        style={{
          left: `${Math.max(2, Math.min(98, valuePos))}%`,
          backgroundColor: `hsl(${hue} 75% 48%)`,
        }}
      />
    </div>
  );

  if (!onDrag) return track;
  // A taller hit area around the thin track makes the marker easy to grab.
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`Drag to adjust ${label}`}
      aria-valuenow={Number(shown.toFixed(2))}
      aria-valuemin={Number(scaleMin.toFixed(2))}
      aria-valuemax={Number(scaleMax.toFixed(2))}
      title="Drag to adjust: the ingredients that raise it scale up or down together"
      className="py-1.5 cursor-ew-resize touch-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onPointerDown={begin}
      onPointerMove={drag}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={nudge}
    >
      {track}
    </div>
  );
}

// ─── MetricCards ──────────────────────────────────────────────────────────────

interface MetricCardsProps {
  readonly comparisons: MetricComparison[] | null;
  readonly freezeMetric: FreezeMetric;
  readonly onDragMetric?: MetricDragHandlers;
}

function toFahrenheit(c: MetricComparison): MetricComparison {
  const f = (v: number | null) => (v == null ? null : Math.round(cToF(v) * 10) / 10);
  return { ...c, value: cToF(c.value), target_min: f(c.target_min), target_max: f(c.target_max) };
}

function rangeText(c: MetricComparison, unit: string): string {
  if (c.target_min != null && c.target_max != null) return `${c.target_min}–${c.target_max}${unit}`;
  if (c.target_max != null) return `≤ ${c.target_max}${unit}`;
  if (c.target_min != null) return `≥ ${c.target_min}${unit}`;
  return "";
}

/** Compact one-line-per-metric view, so every target fits on screen at once. */
export function MetricCards({ comparisons, freezeMetric, onDragMetric }: MetricCardsProps) {
  if (!comparisons || comparisons.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem_4.75rem] items-center gap-x-3 gap-y-2.5">
      {visibleComparisons(comparisons, freezeMetric).map((raw) => {
        const inF = raw.metric === "serving_temp" && freezeMetric === "serving_temp_f";
        const c = inF ? toFahrenheit(raw) : raw;
        const label = METRIC_LABELS[c.metric] ?? c.metric;
        const unit = inF ? "°F" : (METRIC_UNITS[c.metric] ?? "%");
        const cfg = STATUS_CONFIG[c.status];
        const untargeted = c.target_min == null && c.target_max == null;
        const range = untargeted ? "no target" : rangeText(c, unit);
        const hue = hueFor(offTarget(c.value, c.target_min, c.target_max));
        const tooltip = METRIC_TOOLTIPS[c.metric] ?? label;

        return (
          // On phones each metric is its own small grid: label, value and range on
          // one line with the bar full width beneath.
          <div
            key={c.metric}
            className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.75rem] items-center gap-x-3 gap-y-1 sm:contents"
          >
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm font-medium text-base-content/85 truncate">{label}</span>
              <InfoIcon label={tooltip} position="bottom" />
            </div>
            <div className="col-span-full order-last sm:order-none sm:col-span-1">
            <GaugeBar
              value={c.value}
              targetMin={c.target_min}
              targetMax={c.target_max}
              hue={hue}
              label={label}
              onDrag={
                onDragMetric && !inF && onDragMetric.isDraggable(c.metric)
                  ? {
                      start: () => onDragMetric.start(c.metric),
                      move: (v) => onDragMetric.move(c.metric, v),
                      end: onDragMetric.end,
                    }
                  : undefined
              }
            />
            </div>
            <span
              className={`text-sm font-bold tabular-nums text-right transition-colors duration-150 ${
                untargeted
                  ? "text-base-content/70"
                  : "text-[hsl(var(--hue)_70%_35%)] dark:text-[hsl(var(--hue)_80%_65%)]"
              }`}
              style={{ "--hue": hue } as CSSProperties}
            >
              <span className="sr-only">{cfg.label}: </span>
              {cfg.glyph && <span className="text-[10px] mr-0.5" aria-hidden="true">{cfg.glyph}</span>}
              {c.value.toFixed(Math.abs(c.value) < 1 ? 2 : 1)}
              <span className="text-xs font-normal text-base-content/60 ml-0.5">{unit}</span>
            </span>
            <span className="text-xs tabular-nums text-base-content/60 text-right">{range}</span>
          </div>
        );
      })}
    </div>
  );
}
