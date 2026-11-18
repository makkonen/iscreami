import type { MetricComparison, ServingMethod, TargetProfile } from "../types";

/**
 * Serving methods come from the server (/serving-methods): each is an eating
 * temperature plus how much of the water should be frozen then, and sets the
 * recipe's freezing target. A recipe with no serving method uses its profile's
 * usual one.
 */

/** Serving-method groups in the order the server lists them. */
export function servingGroups(methods: readonly ServingMethod[]): string[] {
  return [...new Set(methods.map((m) => m.group))];
}

/**
 * The profile as judged for this serving method: its serving window replaced
 * by the one the server derived for this recipe (the "serving_temp" comparison).
 */
export function withServing(
  profile: TargetProfile | null,
  comparisons: readonly MetricComparison[] | null | undefined,
): TargetProfile | null {
  const temp = comparisons?.find((c) => c.metric === "serving_temp");
  if (!profile || !temp) return profile;
  return { ...profile, serving_temp_min: temp.target_min, serving_temp_max: temp.target_max };
}
