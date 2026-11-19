import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { calculate, fetchProfiles, fetchRecipe, fetchRecipes } from "../api";
import { keyFor } from "../hooks/useRecipeCalculator";
import { KJ_PER_KCAL } from "../lib/formatting";
import { METRIC_LABELS } from "../lib/metrics";
import type { CalculateResponse, MetricComparison, Recipe } from "../types";

// Freezing and sweetness first, as in the calculator.
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
const UNITS: Record<string, string> = { pac: "", frozen_pct: "%", serving_temp: "°C" };

/** A saved recipe judged as the calculator would: its own profile (or best fit) and serving. */
function useRecipeResult(id: string | null) {
  const { data: recipe } = useQuery({
    queryKey: ["recipe", id],
    queryFn: () => fetchRecipe(id!),
    enabled: !!id,
  });
  const { data: result } = useQuery({
    queryKey: ["compare-result", id, recipe?.updated_at],
    enabled: !!recipe,
    queryFn: () =>
      calculate({
        target_profile_id: recipe!.target_profile_id,
        suggest_profile: !recipe!.target_profile_id,
        serving_method: recipe!.serving_method ?? null,
        ingredients: recipe!.ingredients.map((ri) => ({
          ingredient_id: ri.ingredient_id,
          weight_grams: ri.weight_grams,
          is_addin: ri.is_addin ?? false,
        })),
      }),
  });
  return { recipe: id ? recipe : undefined, result: id ? result : undefined };
}

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : v.toFixed(Math.abs(v) < 1 && v !== 0 ? 2 : digits);
}

function statusClass(c: MetricComparison | undefined): string {
  if (!c || (c.target_min == null && c.target_max == null)) return "";
  return c.status === "in_range" ? "text-success" : "text-warning";
}

function rangeText(c: MetricComparison | undefined, unit: string): string {
  if (!c) return "";
  // Targets derived from the serving method come out with long decimals.
  const n = (v: number) => String(Number(v.toFixed(Math.abs(v) < 1 ? 2 : 1)));
  if (c.target_min != null && c.target_max != null) return `${n(c.target_min)} to ${n(c.target_max)}${unit}`;
  if (c.target_max != null) return `≤ ${n(c.target_max)}${unit}`;
  if (c.target_min != null) return `≥ ${n(c.target_min)}${unit}`;
  return "";
}

function Delta({ a, b, digits: fixed }: { readonly a?: number | null; readonly b?: number | null; readonly digits?: number }) {
  if (a == null || b == null) return <span className="text-base-content/35">—</span>;
  const d = b - a;
  // Small differences (stabilizer, emulsifier) need more places to show at all.
  const digits = fixed ?? (Math.abs(d) < 1 ? 2 : 1);
  if (Math.abs(d) < 0.5 * 10 ** -digits) return <span className="text-base-content/35">0</span>;
  return (
    <span className="font-medium">
      {d > 0 ? "+" : "−"}
      {Math.abs(d).toFixed(digits)}
    </span>
  );
}

/** Two saved recipes side by side: what's in them, and how they measure up. */
export function CompareView() {
  useEffect(() => {
    document.title = "Compare - iscreami";
  }, []);
  const [params, setParams] = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");
  const { data: list } = useQuery({ queryKey: ["recipes"], queryFn: fetchRecipes });
  const recipes = [...(list?.items ?? [])].sort((x, y) => x.name.localeCompare(y.name));
  const a = useRecipeResult(aId);
  const b = useRecipeResult(bId);

  function choose(side: "a" | "b", id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set(side, id);
    else next.delete(side);
    setParams(next, { replace: true });
  }
  function swap() {
    const next = new URLSearchParams();
    if (bId) next.set("a", bId);
    if (aId) next.set("b", aId);
    setParams(next, { replace: true });
  }

  const picker = (side: "a" | "b", value: string | null) => (
    <select
      className="select select-sm w-full min-w-0 max-w-none"
      value={value ?? ""}
      onChange={(e) => choose(side, e.target.value)}
      aria-label={side === "a" ? "First recipe" : "Second recipe"}
    >
      <option value="">Choose a recipe…</option>
      {recipes.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold">Compare</h1>
      <p className="mt-1 mb-4 text-sm text-base-content/60">
        Two saved recipes side by side. Each is judged as in the calculator, against its own profile and serving.
      </p>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        {picker("a", aId)}
        <button type="button" className="btn btn-ghost btn-sm justify-self-center" onClick={swap} aria-label="Swap recipes" title="Swap">
          <ArrowLeftRight size={16} />
        </button>
        {picker("b", bId)}
      </div>

      {a.recipe && b.recipe && (
        <div className="space-y-6">
          <MetricsTable a={a} b={b} />
          <IngredientsTable a={a.recipe} b={b.recipe} />
        </div>
      )}
    </main>
  );
}

interface Side {
  readonly recipe?: Recipe;
  readonly result?: CalculateResponse;
}

function SideHeads({ a, b }: { readonly a: Recipe; readonly b: Recipe }) {
  return (
    <>
      <th className="text-right">
        <Link to={`/calculator/${a.id}`} className="link link-hover">
          A
        </Link>
      </th>
      <th className="text-right">
        <Link to={`/calculator/${b.id}`} className="link link-hover">
          B
        </Link>
      </th>
    </>
  );
}

function MetricsTable({ a, b }: { readonly a: Side; readonly b: Side }) {
  const byMetric = (s: Side) => new Map((s.result?.target_comparison ?? []).map((c) => [c.metric, c]));
  const ma = byMetric(a);
  const mb = byMetric(b);
  const metrics = METRIC_ORDER.filter((m) => ma.has(m) || mb.has(m));
  const { data: profiles } = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const profileName = (s: Side) =>
    s.recipe?.target_profile?.name ??
    `${profiles?.find((p) => p.id === s.result?.suggested_profile_id)?.name ?? "no profile"}, suggested`;
  const kcal = (s: Side) => {
    const kj = s.result?.nutrition.per_100g.energy_kj;
    return kj == null ? null : kj / KJ_PER_KCAL;
  };

  return (
    <section className="bg-base-100 rounded-xl border border-base-200 p-4 overflow-x-auto">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-base-content/50">Balance</h2>
      <p className="mb-3 text-xs text-base-content/50">
        A: {a.recipe?.name} ({profileName(a)}) · B: {b.recipe?.name} ({profileName(b)})
      </p>
      {!a.result || !b.result ? (
        <span className="loading loading-dots loading-sm" />
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Metric</th>
              <SideHeads a={a.recipe!} b={b.recipe!} />
              <th className="text-right">B − A</th>
              <th className="text-right">Target (A)</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const unit = UNITS[m] ?? "%";
              const ca = ma.get(m);
              const cb = mb.get(m);
              return (
                <tr key={m}>
                  <td>{METRIC_LABELS[m] ?? m}</td>
                  <td className={`text-right tabular-nums ${statusClass(ca)}`}>
                    {fmt(ca?.value)}
                    {unit}
                  </td>
                  <td className={`text-right tabular-nums ${statusClass(cb)}`}>
                    {fmt(cb?.value)}
                    {unit}
                  </td>
                  <td className="text-right tabular-nums">
                    <Delta a={ca?.value} b={cb?.value} />
                  </td>
                  <td className="text-right text-xs tabular-nums text-base-content/55">{rangeText(ca, unit)}</td>
                </tr>
              );
            })}
            <tr>
              <td>Energy (kcal/100 g)</td>
              <td className="text-right tabular-nums">{fmt(kcal(a), 0)}</td>
              <td className="text-right tabular-nums">{fmt(kcal(b), 0)}</td>
              <td className="text-right tabular-nums">
                <Delta a={kcal(a)} b={kcal(b)} digits={0} />
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

function IngredientsTable({ a, b }: { readonly a: Recipe; readonly b: Recipe }) {
  const mixTotal = (r: Recipe) => r.ingredients.reduce((t, i) => (i.is_addin ? t : t + i.weight_grams), 0);
  const ta = mixTotal(a);
  const tb = mixTotal(b);
  const sorted = (r: Recipe) => [...r.ingredients].sort((x, y) => x.sort_order - y.sort_order);
  const ka = new Map(a.ingredients.map((i) => [keyFor(i.ingredient_id, i.is_addin ?? false), i]));
  const kb = new Map(b.ingredients.map((i) => [keyFor(i.ingredient_id, i.is_addin ?? false), i]));
  // A's order, then anything only in B.
  const keys = [
    ...sorted(a).map((i) => keyFor(i.ingredient_id, i.is_addin ?? false)),
    ...sorted(b)
      .map((i) => keyFor(i.ingredient_id, i.is_addin ?? false))
      .filter((k) => !ka.has(k)),
  ];
  const pct = (g: number | undefined, total: number) => (g == null || total <= 0 ? null : (g / total) * 100);
  const grams = (g: number | undefined) => (g == null ? "—" : g < 3 ? g.toFixed(2) : g.toFixed(g < 10 ? 1 : 0));

  return (
    <section className="bg-base-100 rounded-xl border border-base-200 p-4 overflow-x-auto">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-base-content/50">Ingredients</h2>
      <p className="mb-3 text-xs text-base-content/50">
        % is of each mix ({ta.toFixed(0)} g vs {tb.toFixed(0)} g), so batches of different sizes compare fairly.
      </p>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Ingredient</th>
            <SideHeads a={a} b={b} />
            <th className="text-right">A %</th>
            <th className="text-right">B %</th>
            <th className="text-right">B − A (pts)</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const ia = ka.get(k);
            const ib = kb.get(k);
            const item = ia ?? ib!;
            const addin = item.is_addin ?? false;
            const pa = pct(ia?.weight_grams, ta);
            const pb = pct(ib?.weight_grams, tb);
            const changed = !ia || !ib || Math.abs((pa ?? 0) - (pb ?? 0)) >= 0.005;
            return (
              <tr key={k} className={changed ? "bg-primary/5" : "text-base-content/60"}>
                <td>
                  {item.ingredient.name}
                  {addin && <span className="ml-1 text-xs text-base-content/45">(add-in)</span>}
                </td>
                <td className="text-right tabular-nums">{grams(ia?.weight_grams)}</td>
                <td className="text-right tabular-nums">{grams(ib?.weight_grams)}</td>
                <td className="text-right tabular-nums">{fmt(pa, 2)}</td>
                <td className="text-right tabular-nums">{fmt(pb, 2)}</td>
                <td className="text-right tabular-nums">
                  <Delta a={pa ?? 0} b={pb ?? 0} digits={2} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
