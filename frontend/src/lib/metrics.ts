import type { MetricComparison } from "../types";

/** Show freezing behaviour as PAC or as the equivalent serving temperature (°C or °F). */
export type FreezeMetric = "pac" | "frozen_pct" | "serving_temp" | "serving_temp_f";

export const FREEZE_METRIC_LABELS: Record<FreezeMetric, string> = {
  pac: "PAC",
  frozen_pct: "% frozen",
  serving_temp: "°C",
  serving_temp_f: "°F",
};

// Freezing and sweetness first: they're what you balance against.
const METRIC_ORDER = [
  "pac",
  "frozen_pct",
  "serving_temp",
  "sweetness",
  "protein",
  "total_solids",
  "total_fat",
  "milk_fat",
  "msnf",
  "stabilizer",
  "emulsifier",
];

/** Whether a comparison has any target to be judged against. */
export function isTargeted(c: MetricComparison): boolean {
  return c.target_min != null || c.target_max != null;
}

/** The comparisons actually shown, in display order. */
export function visibleComparisons(
  comparisons: MetricComparison[],
  freezeMetric: FreezeMetric,
): MetricComparison[] {
  // PAC, % frozen and 75%-frozen temperature are the same judgement; show one.
  const shown = freezeMetric === "serving_temp_f" ? "serving_temp" : freezeMetric;
  const freezing = ["pac", "frozen_pct", "serving_temp"];
  const rank = (m: string) => {
    const i = METRIC_ORDER.indexOf(m);
    return i === -1 ? METRIC_ORDER.length : i;
  };
  return comparisons
    .filter((c) => !freezing.includes(c.metric) || c.metric === shown)
    .sort((a, b) => rank(a.metric) - rank(b.metric));
}

/** Display names for comparison metrics. */
export const METRIC_LABELS: Record<string, string> = {
  pac: "PAC",
  frozen_pct: "Frozen when eaten",
  protein: "Protein",
  total_solids: "Total Solids",
  total_fat: "Total Fat",
  milk_fat: "Milk Fat",
  sugar: "Sugars",
  msnf: "MSNF",
  stabilizer: "Stabilizer",
  emulsifier: "Emulsifier",
  sweetness: "Sweetness (POD)",
  serving_temp: "75% frozen at",
};
