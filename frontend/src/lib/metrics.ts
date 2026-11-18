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
