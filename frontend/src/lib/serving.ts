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

/**
 * Custom serving: "custom:<eating temp °C>:<texture>", as the server reads it.
 * The textures are the frozen-% windows the presets use.
 */
export const CUSTOM_TEXTURES = {
  soft: { label: "Soft", detail: "as off a spin or churn", min: 50, max: 64 },
  scoop: { label: "Scoopable", detail: "scoopable", min: 70, max: 78 },
  firm: { label: "Firm", detail: "as a popsicle", min: 83, max: 90 },
} as const;
export type CustomTexture = keyof typeof CUSTOM_TEXTURES;
export const CUSTOM_TEMP_MIN = -40;
export const CUSTOM_TEMP_MAX = 0;

export function customServingId(tempC: number, texture: CustomTexture): string {
  return `custom:${Number(tempC.toFixed(1))}:${texture}`;
}

export function parseCustomServing(id: string | null | undefined): { tempC: number; texture: CustomTexture } | null {
  const m = id?.match(/^custom:(-?\d+(?:\.\d+)?):(\w+)$/);
  if (!m || !(m[2] in CUSTOM_TEXTURES)) return null;
  const tempC = Number(m[1]);
  if (tempC < CUSTOM_TEMP_MIN || tempC > CUSTOM_TEMP_MAX) return null;
  return { tempC, texture: m[2] as CustomTexture };
}

/** A serving method by id, presets or custom; undefined if unknown. */
export function findServing(id: string | null | undefined, methods: readonly ServingMethod[]): ServingMethod | undefined {
  const preset = methods.find((m) => m.id === id);
  if (preset) return preset;
  const custom = parseCustomServing(id);
  if (!custom) return undefined;
  const t = CUSTOM_TEXTURES[custom.texture];
  return {
    id: id!,
    label: `Custom · ${custom.tempC} °C, ${t.label.toLowerCase()}`,
    group: "Custom",
    description: `Eaten at ${custom.tempC} °C, ${t.detail}: ${t.min}-${t.max}% frozen.`,
    eating_temp_c: custom.tempC,
    frozen_pct_min: t.min,
    frozen_pct_max: t.max,
  };
}

/** The custom texture closest to a method's frozen-% window. */
export function textureFor(m: ServingMethod | undefined): CustomTexture {
  if (!m) return "scoop";
  return m.frozen_pct_max <= 65 ? "soft" : m.frozen_pct_min >= 80 ? "firm" : "scoop";
}
