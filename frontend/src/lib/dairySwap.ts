import type { Ingredient } from "../types";

/**
 * Swapping dairy: milks, half and half, creams and milk powders are, near
 * enough, fat plus milk solids (MSNF) plus water. So a recipe's dairy can be
 * rebuilt from what's on hand, with water to reconstitute powder, keeping its
 * total weight, fat and milk solids: and with them its water and how it
 * freezes.
 */

const NOT_SWAPPABLE = /cheese|yog(h)?urt|shake|creamer|kefir|butter|condensed|evaporated|whey|isolate|casein|protein/i;

/** Milk, half and half or cream: mostly water, with milk solids and little sugar beyond lactose. */
export function isFluidDairy(i: Ingredient): boolean {
  return (
    (i.msnf_pct ?? 0) >= 4 &&
    (i.water_pct ?? 0) >= 50 &&
    (i.total_fat_pct ?? 0) <= 45 &&
    (i.total_sugar_pct ?? 0) <= 7 &&
    !NOT_SWAPPABLE.test(i.name)
  );
}

/**
 * Skim or whole milk powder. Real milk solids are about 37% protein, which
 * tells them apart from protein isolates (whey isolate is ~98%).
 */
export function isMilkPowder(i: Ingredient): boolean {
  const msnf = i.msnf_pct ?? 0;
  return (
    msnf >= 30 &&
    (i.water_pct ?? 0) <= 10 &&
    (i.total_fat_pct ?? 0) <= 45 &&
    (i.protein_pct ?? 0) <= 0.5 * msnf &&
    !NOT_SWAPPABLE.test(i.name)
  );
}

export function isSwappableDairy(i: Ingredient): boolean {
  return isFluidDairy(i) || isMilkPowder(i);
}

export interface DairyPart {
  readonly ingredient: Ingredient;
  readonly grams: number;
}

export interface DairySwap {
  readonly parts: DairyPart[];
  /** Total weight and fat are kept exactly. */
  readonly fatKept: boolean;
  /** Milk solids are kept to within about 2% of the dairy's weight. */
  readonly solidsKept: boolean;
}

const fat = (i: Ingredient) => i.total_fat_pct ?? 0;
const msnf = (i: Ingredient) => i.msnf_pct ?? 0;
const protein = (i: Ingredient) => i.protein_pct ?? 0;
const sugar = (i: Ingredient) => i.total_sugar_pct ?? 0;

/** Weighted total of a per-100 g value over some dairy. */
export function totalOf(parts: readonly DairyPart[], value: (i: Ingredient) => number): number {
  return parts.reduce((t, p) => t + (p.grams * value(p.ingredient)) / 100, 0);
}

/** Solve a small linear system by Gaussian elimination; null if singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-9) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]));
}

/**
 * The swap for `current` using `available` (plus `water`, if given, which is
 * always on hand). Candidates use one to three ingredients:
 * - one: the same weight;
 * - two: the same weight and fat;
 * - three: the same weight, fat and milk solids (e.g. cream, skim powder and water).
 * The best keeps milk solids, then protein and sugars, closest; each extra
 * ingredient has to earn its place by keeping them noticeably closer.
 */
export function planDairySwap(
  current: readonly DairyPart[],
  available: readonly Ingredient[],
  water?: Ingredient,
): DairySwap | null {
  const W = current.reduce((t, p) => t + p.grams, 0);
  const dairy = available.filter((i) => i.id !== water?.id);
  if (W <= 0 || dairy.length === 0) return null;
  const F = totalOf(current, fat);
  const M = totalOf(current, msnf);
  const P = totalOf(current, protein);
  const S = totalOf(current, sugar);
  const pool = water ? [...dairy, water] : dairy;

  let best: { parts: DairyPart[]; score: number } | null = null;
  const consider = (ings: Ingredient[], grams: number[]) => {
    if (grams.some((g) => g < -1e-6)) return;
    if (!ings.some((i) => i !== water)) return; // not water alone
    const parts = ings.map((ingredient, i) => ({ ingredient, grams: Math.max(0, grams[i]) })).filter((p) => p.grams > 0.05);
    if (parts.length === 0) return;
    const score =
      Math.abs(totalOf(parts, msnf) - M) +
      0.25 * Math.abs(totalOf(parts, protein) - P) +
      0.1 * Math.abs(totalOf(parts, sugar) - S) +
      0.004 * W * (parts.length - 1) +
      // Pour milk rather than reconstitute powder when both work.
      0.01 * parts.reduce((t, p) => t + (p.ingredient === water ? p.grams : 0), 0) +
      // Missing the fat (only possible with a single ingredient) costs the most.
      2 * Math.abs(totalOf(parts, fat) - F);
    if (!best || score < best.score - 1e-9) best = { parts, score };
  };

  for (const a of dairy) consider([a], [W]);
  for (const pair of combinations(pool, 2)) {
    const x = solve(
      [
        [1, 1],
        pair.map(fat),
      ],
      [W, 100 * F],
    );
    if (x) consider(pair, x);
  }
  for (const trio of combinations(pool, 3)) {
    const x = solve([[1, 1, 1], trio.map(fat), trio.map(msnf)], [W, 100 * F, 100 * M]);
    if (x) consider(trio, x);
  }
  if (!best) return null;
  const parts = (best as { parts: DairyPart[] }).parts;
  return {
    parts,
    fatKept: Math.abs(totalOf(parts, fat) - F) < 0.1,
    solidsKept: Math.abs(totalOf(parts, msnf) - M) <= 0.02 * W,
  };
}

/** Grams rounded as the ingredient list shows them. */
export function roundGrams(g: number): number {
  return g < 3 ? Math.round(g * 100) / 100 : Math.round(g * 10) / 10;
}
