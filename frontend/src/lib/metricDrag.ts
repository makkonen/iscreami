import { rowKey, type RecipeRow } from "../hooks/useRecipeCalculator";
import { METRIC_VALUE } from "./inSpec";

/** Metrics that can be dragged: those that are a weighted average of the mix. */
export function isDraggableMetric(metric: string): boolean {
  return metric in METRIC_VALUE;
}

/** How far contributors may be scaled up in one drag. */
const MAX_FACTOR = 5;

/**
 * Weights that move one metric to `target` by scaling, by one common factor,
 * every unlocked mix ingredient that pulls the metric up (those richer in it
 * than the mix as a whole). Raising the metric grows them; lowering it shrinks
 * them. Everything else, add-ins and locked rows stay as they are.
 *
 * The metric is a weighted average, m(k) = (S_other + k·S_c) / (T_other + k·T_c),
 * so the factor has an exact solution; the target is clamped to what these
 * ingredients can reach (between leaving them out and scaling them ×5).
 * Returns null when nothing can move the metric.
 */
export function weightsForTarget(
  baseRows: readonly RecipeRow[],
  lockedKeys: ReadonlySet<string>,
  metric: string,
  target: number,
): Record<string, number> | null {
  const valueOf = METRIC_VALUE[metric];
  if (!valueOf) return null;
  const mix = baseRows.filter((r) => !r.is_addin && r.weight_grams > 0);
  const total = mix.reduce((t, r) => t + r.weight_grams, 0);
  if (total <= 0) return null;
  const current = mix.reduce((t, r) => t + valueOf(r.ingredient) * r.weight_grams, 0) / total;

  const movers = mix.filter((r) => !lockedKeys.has(rowKey(r)) && valueOf(r.ingredient) > current + 1e-9);
  if (movers.length === 0) return null;
  const sumC = movers.reduce((t, r) => t + valueOf(r.ingredient) * r.weight_grams, 0);
  const totC = movers.reduce((t, r) => t + r.weight_grams, 0);
  const sumO = mix.reduce((t, r) => t + valueOf(r.ingredient) * r.weight_grams, 0) - sumC;
  const totO = total - totC;
  if (totO <= 0) return null; // the movers are the whole mix: scaling them changes nothing

  const at = (k: number) => (sumO + k * sumC) / (totO + k * totC);
  const reachable = [at(0), at(MAX_FACTOR)];
  const t = Math.min(Math.max(target, Math.min(...reachable)), Math.max(...reachable));
  const denom = sumC - t * totC;
  let k = Math.abs(denom) < 1e-12 ? MAX_FACTOR : (t * totO - sumO) / denom;
  if (!Number.isFinite(k)) k = MAX_FACTOR;
  k = Math.min(Math.max(k, 0), MAX_FACTOR);

  return Object.fromEntries(movers.map((r) => [rowKey(r), Number((r.weight_grams * k).toFixed(2))]));
}
