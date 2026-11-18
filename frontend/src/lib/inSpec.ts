import type { Ingredient, MetricComparison } from "../types";

/** Per-100 g value of each judged metric for an ingredient. */
const METRIC_VALUE: Record<string, (i: Ingredient) => number> = {
  pac: (i) => i.pac,
  sweetness: (i) => i.pod,
  total_solids: (i) => i.total_solids_pct,
  total_fat: (i) => i.total_fat_pct ?? 0,
  milk_fat: (i) => i.milk_fat_pct ?? 0,
  msnf: (i) => i.msnf_pct ?? 0,
  stabilizer: (i) => i.stabilizer_pct ?? 0,
  emulsifier: (i) => i.emulsifier_pct ?? 0,
  protein: (i) => i.protein_pct ?? 0,
};

export interface WeightBand {
  /** Lowest in-spec weight (g). */
  lo: number;
  /** Highest in-spec weight (g); Infinity if unbounded. */
  hi: number;
}

interface Row {
  readonly ingredient: Ingredient;
  readonly weight_grams: number;
}

/**
 * Weights of one ingredient that keep every target in range, with all other
 * weights held fixed. Each judged metric is a weighted average over the mix,
 * M(w) = (S + w·a) / (T + w), so each bound gives one crossing weight. Metrics
 * this ingredient can't bring into range at any weight are skipped, since they
 * aren't its problem, as are metrics it barely moves (see below). Returns null
 * when nothing constrains it or the remaining limits can't all be met at once.
 *
 * The ingredient's typical-use limits (% of mix) always apply on top, so salt
 * isn't "in spec" at 1% just because PAC would allow it.
 *
 * The PAC target is treated as fixed, though strictly it shifts a little with
 * the mix's water content.
 */
export function inSpecBand(
  rows: readonly Row[],
  index: number,
  comparisons: readonly MetricComparison[] | null,
): WeightBand | null {
  if (!comparisons?.length) return null;
  const self = rows[index];
  let lo = 0;
  let hi = Infinity;
  let constrained = false;

  for (const c of comparisons) {
    const valueOf = METRIC_VALUE[c.metric];
    if (!valueOf || (c.target_min == null && c.target_max == null)) continue;
    let T = 0;
    let S = 0;
    rows.forEach((r, j) => {
      if (j === index || r.weight_grams <= 0) return;
      T += r.weight_grams;
      S += r.weight_grams * valueOf(r.ingredient);
    });
    const a = valueOf(self.ingredient);

    // Ignore metrics this ingredient barely moves. Without this, a pinch of salt
    // or gum gets "limited" by merely diluting a metric that sits on its bound
    // (e.g. sweetness), though 0.2 g changes it by a few thousandths. Compare
    // the metric at none vs double the current weight with the target's width.
    const span = self.weight_grams > 0 ? self.weight_grams * 2 : 10;
    const metricAt = (w: number) => (T + w > 0 ? (S + w * a) / (T + w) : a);
    const width =
      c.target_min != null && c.target_max != null
        ? c.target_max - c.target_min
        : Math.max(Math.abs((c.target_min ?? c.target_max) as number) * 0.25, 0.5);
    if (Math.abs(metricAt(span) - metricAt(0)) < width * 0.1) continue;

    // Feasible weights for this metric alone.
    let mLo = 0;
    let mHi = Infinity;
    for (const [bound, isMin] of [
      [c.target_min, true],
      [c.target_max, false],
    ] as const) {
      if (bound == null) continue;
      if (Math.abs(a - bound) < 1e-9) {
        // Adding this ingredient pulls the metric toward the bound, never past it.
        continue;
      }
      const cross = (bound * T - S) / (a - bound);
      // More of this ingredient pulls the metric toward a.
      const needMore = isMin ? a > bound : a < bound;
      if (needMore) mLo = Math.max(mLo, cross);
      else mHi = Math.min(mHi, cross);
    }
    // Skip metrics this ingredient can't fix at any non-negative weight.
    if (mLo > mHi || mHi < 0) continue;

    lo = Math.max(lo, mLo);
    hi = Math.min(hi, mHi);
    constrained = true;
  }

  // Typical-use limits are % of the whole mix: w / (T + w) = p  ->  w = p T / (1 - p).
  const others = rows.reduce((t, r, j) => (j === index || r.weight_grams <= 0 ? t : t + r.weight_grams), 0);
  const asWeight = (pct: number) => (pct >= 100 ? Infinity : ((pct / 100) * others) / (1 - pct / 100));
  const { usage_min_pct: umin, usage_max_pct: umax } = self.ingredient;
  // They never exclude the weight the recipe already uses: that amount works.
  if (umin != null && umin > 0) {
    lo = Math.max(lo, Math.min(asWeight(umin), self.weight_grams));
    constrained = true;
  }
  if (umax != null) {
    hi = Math.min(hi, Math.max(asWeight(umax), self.weight_grams));
    constrained = true;
  }

  if (!constrained || lo > hi) return null;
  return { lo: Math.max(0, lo), hi };
}
