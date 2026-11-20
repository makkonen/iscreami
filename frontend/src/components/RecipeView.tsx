import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Printer, RotateCcw } from "lucide-react";
import { calculate, fetchProfiles, fetchRecipe, fetchServingMethods, paprikaUrl } from "../api";
import { KJ_PER_KCAL } from "../lib/formatting";
import { findServing } from "../lib/serving";
import type { CalculateResponse, Recipe, RecipeIngredientOut } from "../types";
import { SourceLink } from "./RecipeSource";
import { StarRating } from "./StarRating";

/** Grams as you'd weigh them: hundredths under 3 g, tenths under 10 g. */
function grams(g: number): string {
  if (g < 3) return String(Number(g.toFixed(2)));
  if (g < 10) return String(Number(g.toFixed(1)));
  return g.toFixed(0);
}

function readTicks(key: string): Set<number> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(key) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

/** The recipe as structured data, so Paprika's bookmarklet (and others) can import the page. */
function jsonLd(recipe: Recipe, result: CalculateResponse | undefined, line: (ri: RecipeIngredientOut) => string) {
  const sorted = [...recipe.ingredients].sort((a, b) => a.sort_order - b.sort_order);
  const steps = (recipe.instructions ?? "").split("\n").filter((s) => s.trim());
  const n = result?.nutrition.per_100g;
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    recipeCategory: "Ice Cream",
    recipeIngredient: [
      ...sorted.filter((i) => !i.is_addin).map(line),
      ...sorted.filter((i) => i.is_addin).map((i) => `${line(i)} (add-in, folded in after freezing)`),
    ],
    recipeInstructions: steps.map((text) => ({ "@type": "HowToStep", text })),
    recipeYield: `${Math.round(recipe.total_weight_grams)} g`,
    description: recipe.description ?? undefined,
    keywords: (recipe.tags ?? []).join(", ") || undefined,
    isBasedOn: recipe.source_url ?? undefined,
    ...(recipe.rating != null && {
      aggregateRating: { "@type": "AggregateRating", ratingValue: recipe.rating, ratingCount: 1 },
    }),
    ...(n && {
      nutrition: {
        "@type": "NutritionInformation",
        servingSize: "100 g",
        // Paprika drops servingSize, so say it in the first line it shows.
        calories: `${Math.round(n.energy_kj / KJ_PER_KCAL)} kcal (per 100 g)`,
        fatContent: `${n.total_fat_g.toFixed(1)} g`,
        saturatedFatContent: `${n.saturated_fat_g.toFixed(1)} g`,
        carbohydrateContent: `${n.carbohydrate_g.toFixed(1)} g`,
        sugarContent: `${n.sugars_g.toFixed(1)} g`,
        fiberContent: `${n.fiber_g.toFixed(1)} g`,
        proteinContent: `${n.protein_g.toFixed(1)} g`,
      },
    }),
  };
}

/** A plain page for one recipe: to print, send to Paprika, or follow on a phone while making it. */
export function RecipeView() {
  const { recipeId = "" } = useParams();
  const { data: recipe, isError } = useQuery({ queryKey: ["recipe", recipeId], queryFn: () => fetchRecipe(recipeId) });
  const { data: profiles } = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const { data: servingMethods } = useQuery({
    queryKey: ["serving-methods"],
    queryFn: fetchServingMethods,
    staleTime: Infinity,
  });
  const { data: result } = useQuery({
    queryKey: ["view-result", recipeId, recipe?.updated_at],
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

  // "Make ___ g": scales everything to a batch size (the mix, add-ins in proportion).
  const mixGrams = (recipe?.ingredients ?? []).filter((i) => !i.is_addin).reduce((t, i) => t + i.weight_grams, 0);
  const [target, setTarget] = useState<string>("");
  const wanted = Number(target);
  const factor = target && wanted > 0 && mixGrams > 0 ? wanted / mixGrams : 1;

  // Ticks for weighing, kept for this tab so a reload doesn't lose your place.
  const tickKey = `recipe-ticks:${recipeId}`;
  const [ticked, setTicked] = useState<Set<number>>(() => readTicks(tickKey));
  const toggle = (id: number) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        sessionStorage.setItem(tickKey, JSON.stringify([...next]));
      } catch {
        // Storage unavailable; ticks just won't survive a reload.
      }
      return next;
    });

  const line = (ri: RecipeIngredientOut) => `${grams(ri.weight_grams * factor)} g ${ri.ingredient.name}`;
  useEffect(() => {
    if (!recipe) return;
    document.title = `${recipe.name} - iscreami`;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(jsonLd(recipe, result, line));
    document.head.appendChild(script);
    return () => script.remove();
    // line depends on factor; the structured data follows the scaled amounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, result, factor]);

  if (isError) return <main className="mx-auto max-w-2xl px-4 py-6">Recipe not found.</main>;
  if (!recipe) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <span className="loading loading-spinner" />
      </main>
    );
  }

  const sorted = [...recipe.ingredients].sort((a, b) => a.sort_order - b.sort_order);
  const mix = sorted.filter((i) => !i.is_addin);
  const addins = sorted.filter((i) => i.is_addin);
  const steps = (recipe.instructions ?? "").split("\n").filter((s) => s.trim());
  const profileName =
    recipe.target_profile?.name ?? profiles?.find((p) => p.id === result?.suggested_profile_id)?.name ?? null;
  const serving = findServing(recipe.serving_method ?? result?.serving_method, servingMethods ?? []);
  const comps = new Map((result?.target_comparison ?? []).map((c) => [c.metric, c]));
  const frozen = comps.get("frozen_pct");
  const n = result?.nutrition.per_100g;

  const ingredientList = (items: RecipeIngredientOut[]) => (
    <ul className="divide-y divide-base-200 border-y border-base-200">
      {items.map((ri) => {
        const done = ticked.has(ri.id);
        return (
          <li key={ri.id}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2 print:min-h-0 print:py-1">
              <input
                type="checkbox"
                className="checkbox checkbox-sm shrink-0 print:hidden"
                checked={done}
                onChange={() => toggle(ri.id)}
              />
              <span aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 border border-black print:inline-block" />
              <span className={`min-w-0 flex-1 leading-snug ${done ? "text-base-content/40 line-through" : ""}`}>
                {ri.ingredient.name}
              </span>
              <span
                className={`shrink-0 text-right text-lg font-semibold tabular-nums ${done ? "text-base-content/40" : ""}`}
              >
                {grams(ri.weight_grams * factor)} g
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-4 sm:py-6 print:max-w-none print:p-0 print:text-black">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link to={`/calculator/${recipe.id}`} className="btn btn-ghost btn-sm gap-1 px-2">
          <ArrowLeft size={16} /> Calculator
        </Link>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-sm btn-outline gap-1" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
          <a
            href={paprikaUrl(recipe.id)}
            download
            className="btn btn-sm btn-outline gap-1"
            title="Download a .paprikarecipe file; Paprika's bookmarklet also works on this page"
          >
            <Download size={15} /> Paprika
          </a>
        </div>
      </div>

      <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{recipe.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-base-content/65">
        {recipe.rating != null && <StarRating value={recipe.rating} size={15} />}
        {profileName && <span>{profileName}</span>}
        {serving && <span>· {serving.label}</span>}
        {recipe.source_url && (
          <span>
            · <SourceLink url={recipe.source_url} />
          </span>
        )}
      </div>
      {(recipe.tags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 print:hidden">
          {recipe.tags!.map((t) => (
            <span key={t} className="badge badge-sm badge-ghost">
              {t}
            </span>
          ))}
        </div>
      )}

      <section className="mt-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Ingredients</h2>
          <label className="flex items-center gap-2 text-sm print:hidden">
            Make
            <input
              type="number"
              inputMode="decimal"
              min={1}
              className="input input-sm input-bordered w-24 text-right tabular-nums"
              placeholder={String(Math.round(mixGrams))}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Batch size in grams"
            />
            g
            {factor !== 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setTarget("")}
                aria-label="Back to the recipe's own amounts"
                title="Back to the recipe's own amounts"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </label>
          <span className="hidden text-sm print:inline">Makes {Math.round(mixGrams * factor)} g</span>
        </div>
        {factor !== 1 && (
          <p className="mb-2 text-sm text-base-content/60 print:hidden">
            Scaled ×{factor.toFixed(2)} from {Math.round(mixGrams)} g.
          </p>
        )}
        {ingredientList(mix)}
        {addins.length > 0 && (
          <>
            <h3 className="mb-1 mt-4 font-semibold">
              Add-ins <span className="text-sm font-normal text-base-content/55">· fold in after freezing</span>
            </h3>
            {ingredientList(addins)}
          </>
        )}
      </section>

      {steps.length > 0 && (
        <section className="mt-6 break-inside-avoid">
          <h2 className="mb-2 text-lg font-semibold">Method</h2>
          <ol className="list-decimal space-y-2 pl-6 leading-relaxed">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      {recipe.description && (
        <section className="mt-6 break-inside-avoid">
          <h2 className="mb-2 text-lg font-semibold">Notes</h2>
          <p className="whitespace-pre-wrap leading-relaxed text-base-content/85">{recipe.description}</p>
        </section>
      )}

      {result && n && (
        <section className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 break-inside-avoid">
          <div>
            <h2 className="mb-1 font-semibold">Per 100 g</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
              <dt>Energy</dt>
              <dd className="text-right">{Math.round(n.energy_kj / KJ_PER_KCAL)} kcal</dd>
              <dt>Protein</dt>
              <dd className="text-right">{n.protein_g.toFixed(1)} g</dd>
              <dt>Fat</dt>
              <dd className="text-right">{n.total_fat_g.toFixed(1)} g</dd>
              <dt>Carbohydrate</dt>
              <dd className="text-right">{n.carbohydrate_g.toFixed(1)} g</dd>
              <dt>Sugars</dt>
              <dd className="text-right">{n.sugars_g.toFixed(1)} g</dd>
              <dt>Fiber</dt>
              <dd className="text-right">{n.fiber_g.toFixed(1)} g</dd>
            </dl>
          </div>
          <div>
            <h2 className="mb-1 font-semibold">Balance</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
              <dt>Frozen when eaten</dt>
              <dd className="text-right">
                {frozen ? `${frozen.value.toFixed(0)}%` : "—"}
                {frozen?.target_min != null && frozen.target_max != null && (
                  <span className="text-base-content/55">
                    {" "}
                    ({frozen.target_min.toFixed(0)}–{frozen.target_max.toFixed(0)})
                  </span>
                )}
              </dd>
              <dt>PAC</dt>
              <dd className="text-right">{result.pac.pac_mix.toFixed(1)}</dd>
              <dt>Sweetness (POD)</dt>
              <dd className="text-right">{result.sweetness.pod.toFixed(1)}</dd>
              <dt>Total solids</dt>
              <dd className="text-right">{result.composition.total_solids_pct.toFixed(1)}%</dd>
            </dl>
          </div>
        </section>
      )}
    </main>
  );
}
