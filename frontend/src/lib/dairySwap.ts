import type { Ingredient } from "../types";

/**
 * Swapping fluid dairy: milks, half and half and creams lie on one line, from
 * skim (no fat) to heavy cream (about 36% fat), each roughly "fat plus skim".
 * So any dairy in a recipe can be replaced by what's on hand while keeping its
 * total weight and total fat, and with them the recipe's water and most of its
 * milk solids.
 */

const NOT_SWAPPABLE = /cheese|yog(h)?urt|shake|creamer|kefir|butter|powder|condensed|evaporated/i;

/** Milk, half and half or cream: mostly water, with milk solids and little sugar beyond lactose. */
export function isFluidDairy(i: Ingredient): boolean {
  const water = i.water_pct ?? 0;
  const fat = i.total_fat_pct ?? 0;
  return (
    (i.msnf_pct ?? 0) >= 4 &&
    water >= 50 &&
    fat <= 45 &&
    (i.total_sugar_pct ?? 0) <= 7 &&
    !NOT_SWAPPABLE.test(i.name)
  );
}

export interface DairyPart {
  readonly ingredient: Ingredient;
  readonly grams: number;
}

export interface DairySwap {
  readonly parts: DairyPart[];
  /** True when total weight and fat are both kept exactly. */
  readonly exact: boolean;
}

const fat = (i: Ingredient) => i.total_fat_pct ?? 0;
const msnf = (i: Ingredient) => i.msnf_pct ?? 0;
const protein = (i: Ingredient) => i.protein_pct ?? 0;

/** Weighted total of a per-100 g value over some dairy. */
export function totalOf(parts: readonly DairyPart[], value: (i: Ingredient) => number): number {
  return parts.reduce((t, p) => t + (p.grams * value(p.ingredient)) / 100, 0);
}

/**
 * The swap for `current` using `available`: same total weight and fat. With
 * one dairy on hand, it's simply the same weight. With several, the pair that
 * brackets the fat and keeps milk solids (then protein) closest; if the fat is
 * beyond everything on hand, the nearest single one.
 */
export function planDairySwap(current: readonly DairyPart[], available: readonly Ingredient[]): DairySwap | null {
  const W = current.reduce((t, p) => t + p.grams, 0);
  if (W <= 0 || available.length === 0) return null;
  const F = totalOf(current, fat);
  const M = totalOf(current, msnf);
  const P = totalOf(current, protein);
  const target = (F / W) * 100;

  let best: { parts: DairyPart[]; score: number } | null = null;
  const consider = (parts: DairyPart[]) => {
    const score = Math.abs(totalOf(parts, msnf) - M) + 0.25 * Math.abs(totalOf(parts, protein) - P);
    if (!best || score < best.score - 1e-9) best = { parts, score };
  };

  for (const a of available) {
    if (Math.abs(fat(a) - target) < 0.05) consider([{ ingredient: a, grams: W }]);
  }
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const [a, b] = [available[i], available[j]];
      if (Math.abs(fat(a) - fat(b)) < 1e-9) continue;
      // x + y = W and fat(a) x + fat(b) y = 100 F
      const x = (100 * F - fat(b) * W) / (fat(a) - fat(b));
      const y = W - x;
      if (x < -1e-6 || y < -1e-6) continue;
      consider(
        [
          { ingredient: a, grams: Math.max(0, x) },
          { ingredient: b, grams: Math.max(0, y) },
        ].filter((p) => p.grams > 0.05),
      );
    }
  }
  if (best) return { parts: (best as { parts: DairyPart[] }).parts, exact: true };

  // Nothing on hand brackets the fat: use the closest single one.
  const nearest = [...available].sort((a, b) => Math.abs(fat(a) - target) - Math.abs(fat(b) - target))[0];
  return { parts: [{ ingredient: nearest, grams: W }], exact: available.length === 1 && Math.abs(fat(nearest) - target) < 0.05 };
}

/** Grams rounded as the ingredient list shows them. */
export function roundGrams(g: number): number {
  return g < 3 ? Math.round(g * 100) / 100 : Math.round(g * 10) / 10;
}
