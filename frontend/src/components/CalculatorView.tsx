import { useEffect, useRef, useState } from "react";
import { DeleteRecipeMessage } from "./DeleteRecipeMessage";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IceCreamCone, Milk, Redo2, Scale, Undo2 } from "lucide-react";
import { BalanceModal } from "./BalanceModal";
import { DairySwapModal } from "./DairySwapModal";
import { type DairyPart, isSwappableDairy } from "../lib/dairySwap";
import { BatchLog } from "./BatchLog";
import { RecipeText } from "./RecipeText";
import { keyFor, rowKey, type RecipeRow } from "../hooks/useRecipeCalculator";
import type { BatchSnapshot, Ingredient, MetricComparison, TargetProfile } from "../types";
import { fetchIngredient, fetchProfiles, fetchRecipe, fetchRecipes, fetchServingMethods } from "../api";
import { useToast } from "../hooks/useToast";
import { useRecipeCalculator } from "../hooks/useRecipeCalculator";
import { CompositionTable } from "./CompositionTable";
import { FreezingSection } from "./FreezingSection";
import { IngredientPanel } from "./IngredientPanel";
import { IngredientSearch } from "./IngredientSearch";
import { MetricCards, type MetricDragHandlers } from "./MetricCards";
import { isDraggableMetric, weightsForTarget } from "../lib/metricDrag";
import { FREEZE_METRIC_LABELS, type FreezeMetric, isTargeted, visibleComparisons } from "../lib/metrics";
import { withServing } from "../lib/serving";
import { tagCounts } from "../lib/tags";
import { NutritionTable } from "./NutritionTable";
import { RecipeHeader } from "./RecipeHeader";
import { InfoIcon } from "./InfoIcon";
import { useEscape } from "../hooks/useEscape";
import { TOOLTIPS } from "../lib/tooltips";

/**
 * The rows with the swapped-out dairy replaced: the new dairy goes where the
 * first replaced row was, and joins any row of the same ingredient that stays.
 */
function swapDairy(rows: RecipeRow[], keys: string[], parts: DairyPart[]): RecipeRow[] {
  const replacing = new Set(keys);
  const at = rows.findIndex((r) => replacing.has(rowKey(r)));
  // Copies, so merging weights below doesn't touch the current rows.
  const kept = rows.filter((r) => !replacing.has(rowKey(r))).map((r) => ({ ...r }));
  const added: RecipeRow[] = [];
  for (const part of parts) {
    const existing = kept.find((r) => !r.is_addin && r.ingredient.id === part.ingredient.id);
    if (existing) existing.weight_grams = Math.round((existing.weight_grams + part.grams) * 100) / 100;
    else added.push({ ingredient: part.ingredient, weight_grams: part.grams, sort_order: 0, is_addin: false });
  }
  const before = rows.slice(0, Math.max(at, 0)).filter((r) => !replacing.has(rowKey(r))).length;
  const next = [...kept.slice(0, before), ...added, ...kept.slice(before)];
  return next.map((r, i) => ({ ...r, sort_order: i }));
}

// Advisory metrics (stabilizer, emulsifier) don't count toward "in range".
const counted = (c: MetricComparison) => isTargeted(c) && !c.advisory;

export function CalculatorView() {
  const { recipeId } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "Calculator - iscreami";
  }, []);
  const {
    rows,
    result,
    loading,
    profile,
    servingMethod,
    currentRecipe,
    isSaving,
    hasUnsavedChanges,
    changeProfile,
    changeServingMethod,
    addIngredient,
    updateWeight,
    removeIngredient,
    toggleAddin,
    moveRow,
    sortByAmount,
    setWeights,
    replaceRows,
    lockedKeys,
    toggleLock,
    holdProfile,
    requestBalance,
    loadRecipe,
    revertRecipe,
    undo,
    redo,
    canUndo,
    canRedo,
    saveAsNewRecipe,
    updateDetails,
    saveCurrentRecipe,
    deleteCurrentRecipe,
  } = useRecipeCalculator();

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: fetchProfiles,
  });
  const { data: servingMethods } = useQuery({
    queryKey: ["serving-methods"],
    queryFn: fetchServingMethods,
    staleTime: Infinity,
  });

  // For the "based on" / variants line.
  const { data: allRecipes } = useQuery({ queryKey: ["recipes"], queryFn: fetchRecipes });

  // Load recipe from URL params if present
  const { data: urlRecipe } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => (recipeId ? fetchRecipe(recipeId) : Promise.resolve(null)),
    enabled: !!recipeId,
  });

  // PAC or serving temperature for the freezing row; remembered per browser.
  const [freezeMetric, setFreezeMetric] = useState<FreezeMetric>(() => {
    try {
      const saved = localStorage.getItem("freezeMetric");
      return saved && saved in FREEZE_METRIC_LABELS ? (saved as FreezeMetric) : "pac";
    } catch {
      return "pac";
    }
  });
  function chooseFreezeMetric(m: FreezeMetric) {
    setFreezeMetric(m);
    try {
      localStorage.setItem("freezeMetric", m);
    } catch {
      // Storage unavailable (private mode); the choice just won't persist.
    }
  }
  // A manually chosen profile wins; otherwise use the server's best-fit suggestion.
  // The style a marker drag is holding fixed (see holdProfile).
  const [heldProfile, setHeldProfile] = useState<TargetProfile | null>(null);
  const suggestedProfile =
    (!profile && (heldProfile ?? profiles?.find((p) => p.id === result?.suggested_profile_id))) || null;
  const effectiveProfile = profile ?? suggestedProfile;

  // Ingredients outside their typical use, as % of the mix; live with the sliders.
  const mixTotal = rows.reduce((t, r) => (r.is_addin ? t : t + r.weight_grams), 0);
  const usageWarnings = rows.flatMap((r) => {
    if (r.is_addin || mixTotal <= 0 || r.weight_grams <= 0) return [];
    const pct = (r.weight_grams / mixTotal) * 100;
    const { usage_min_pct: lo, usage_max_pct: hi } = r.ingredient;
    // A little tolerance, so amounts that round to the limit don't warn.
    if (hi != null && pct > hi * 1.03)
      return [`${r.ingredient.name}: ${pct.toFixed(pct < 1 ? 2 : 1)}% of mix (typical use up to ${hi}%)`];
    if (lo != null && lo > 0 && pct < lo * 0.97)
      return [`${r.ingredient.name}: ${pct.toFixed(pct < 1 ? 3 : 1)}% of mix (typical use at least ${lo}%)`];
    return [];
  });

  // Dragging a balance marker: the ingredients that raise that metric scale
  // together from the weights at the start of the drag (so it doesn't drift).
  const dragBase = useRef<RecipeRow[] | null>(null);
  const metricDrag: MetricDragHandlers = {
    isDraggable: isDraggableMetric,
    start: () => {
      dragBase.current = rows;
      if (!profile && suggestedProfile) {
        setHeldProfile(suggestedProfile);
        holdProfile(suggestedProfile);
      }
    },
    move: (metric, value) => {
      const weights = weightsForTarget(dragBase.current ?? rows, lockedKeys, metric, value);
      if (weights) setWeights(weights);
    },
    end: () => {
      dragBase.current = null;
      if (heldProfile || (!profile && suggestedProfile)) {
        setHeldProfile(null);
        holdProfile(null);
      }
    },
  };

  const shownComparisons = result?.target_comparison
    ? visibleComparisons(result.target_comparison, freezeMetric)
    : null;

  // Recipe UI state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [dairyOpen, setDairyOpen] = useState(false);
  const [newRecipeName, setNewRecipeName] = useState("");
  // Whether the name dialog is saving a duplicate of the open recipe.
  const [duplicating, setDuplicating] = useState(false);

  useEscape(() => setSaveDialogOpen(false), saveDialogOpen);
  useEscape(() => setDeleteConfirmOpen(false), deleteConfirmOpen);

  // Load recipe from URL params. Only when it's a different recipe: a refetch of
  // the open one (window refocus, tags saved) mustn't wipe unsaved edits.
  const loadedId = currentRecipe?.id;
  useEffect(() => {
    if (urlRecipe && profiles && urlRecipe.id !== loadedId) {
      const targetProfile = profiles.find((p) => p.id === urlRecipe.target_profile_id) ?? null;
      loadRecipe(urlRecipe, targetProfile);
    }
  }, [urlRecipe, profiles, loadRecipe, loadedId]);

  async function handleSave() {
    if (currentRecipe) {
      await saveCurrentRecipe();
    } else {
      setNewRecipeName("");
      setDuplicating(false);
      setSaveDialogOpen(true);
    }
  }

  function handleDuplicate() {
    if (!currentRecipe) return;
    setNewRecipeName(`${currentRecipe.name} (copy)`);
    setDuplicating(true);
    setSaveDialogOpen(true);
  }

  async function handleSaveNewConfirm() {
    const name = newRecipeName.trim();
    if (!name) return;
    const saved = await saveAsNewRecipe(name, { duplicate: duplicating });
    setSaveDialogOpen(false);
    // Point the URL at the new recipe, so reloading opens it rather than the original.
    if (saved) navigate(`/calculator/${saved.id}`, { replace: !duplicating });
  }

  const parentRecipe = currentRecipe?.parent_id
    ? (allRecipes?.items.find((r) => r.id === currentRecipe.parent_id) ?? null)
    : null;
  const variants = currentRecipe ? (allRecipes?.items.filter((r) => r.parent_id === currentRecipe.id) ?? []) : [];
  const allTags = [...tagCounts(allRecipes?.items.map((r) => r.tags) ?? []).keys()].sort();

  function handleSaveNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void handleSaveNewConfirm();
  }

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) step through edits, except while typing
  // in a field, where the browser's own undo applies.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target;
      // Sliders keep focus after a drag, but have no undo of their own.
      const typing =
        el instanceof HTMLInputElement
          ? !["range", "checkbox", "radio", "button"].includes(el.type)
          : el instanceof Element && !!el.closest("textarea, select, [contenteditable='true']");
      if (typing) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  // Put a logged batch's weights in the editor, fetching any ingredient it
  // used that the recipe no longer has.
  const { addToast } = useToast();
  async function loadBatchWeights(snapshot: BatchSnapshot) {
    const known = new Map<string, Ingredient>(rows.map((r) => [r.ingredient.id, r.ingredient]));
    const next: RecipeRow[] = [];
    for (const [i, item] of snapshot.ingredients.entries()) {
      let ingredient = known.get(item.ingredient_id);
      if (!ingredient) {
        try {
          ingredient = await fetchIngredient(item.ingredient_id);
          known.set(ingredient.id, ingredient);
        } catch {
          addToast(`${item.name} no longer exists, so it was left out.`, "error");
          continue;
        }
      }
      next.push({ ingredient, weight_grams: item.weight_grams, sort_order: i, is_addin: item.is_addin });
    }
    replaceRows(next);
  }

  async function handleDeleteConfirm() {
    const deleted = await deleteCurrentRecipe();
    setDeleteConfirmOpen(false);
    // Leave the deleted recipe's URL, or it would be loaded again from cache.
    if (deleted) navigate("/calculator", { replace: true });
  }

  return (
    <main className="min-h-screen">
      {/* Header with recipe title and key metrics */}
      <div className="border-b border-base-200/50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <RecipeHeader
            recipeName={currentRecipe?.name ?? null}
            recipeId={currentRecipe?.id ?? null}
            targetProfile={profile}
            suggestedProfile={suggestedProfile}
            servingMethod={servingMethod}
            servingMethods={servingMethods}
            onChangeServingMethod={changeServingMethod}
            profiles={profiles}
            result={result}
            isSaving={isSaving}
            hasIngredients={rows.length > 0}
            hasUnsavedChanges={hasUnsavedChanges}
            onSaveRecipe={handleSave}
            onRevertRecipe={revertRecipe}
            onDuplicateRecipe={handleDuplicate}
            onDeleteRecipe={() => setDeleteConfirmOpen(true)}
            parentRecipe={parentRecipe}
            variants={variants}
            tags={currentRecipe?.tags ?? []}
            allTags={allTags}
            onChangeTags={(tags) => void updateDetails({ tags })}
            onRename={(name) => updateDetails({ name })}
            rating={currentRecipe?.rating ?? null}
            onRate={(rating) => void updateDetails({ rating })}
            sourceUrl={currentRecipe?.source_url ?? null}
            onChangeSource={(source_url) => updateDetails({ source_url })}
            onChangeProfile={changeProfile}
          />
        </div>
      </div>

      {/* Content area */}
      <div className="max-w-7xl mx-auto px-4 pt-3">
        <div className="grid grid-cols-1 lg:grid-cols-[600px_1fr] gap-6">
          {/* Left: Ingredient Panel */}
          <div>
            <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">
                    Ingredients
                  </h2>
                  <p className="mt-1 text-sm text-base-content/55">
                    Build the mix here. Lock rows you want left alone, then balance.
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                <div className="join">
                  <button
                    type="button"
                    className="join-item btn btn-sm btn-ghost px-2"
                    onClick={undo}
                    disabled={!canUndo}
                    aria-label="Undo"
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="join-item btn btn-sm btn-ghost px-2"
                    onClick={redo}
                    disabled={!canRedo}
                    aria-label="Redo"
                    title="Redo (Ctrl+Shift+Z)"
                  >
                    <Redo2 size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline gap-1 shrink-0"
                  onClick={() => setBalanceOpen(true)}
                  disabled={!rows.some((r) => !r.is_addin && r.weight_grams > 0)}
                >
                  <Scale size={14} /> Balance
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline gap-1 shrink-0"
                  onClick={() => setDairyOpen(true)}
                  disabled={!rows.some((r) => !r.is_addin && r.weight_grams > 0 && isSwappableDairy(r.ingredient))}
                  title="Use the milk, cream and milk powder you have instead, keeping the same weight, fat and milk solids"
                >
                  <Milk size={14} /> Swap dairy
                </button>
                </div>
              </div>
              <IngredientSearch onSelect={addIngredient} />
              <div className="mt-4">
                <IngredientPanel
                  key={currentRecipe?.id ?? "new"}
                  rows={rows}
                  comparisons={result?.target_comparison ?? null}
                  onWeightChange={updateWeight}
                  onRemove={removeIngredient}
                  onToggleAddin={toggleAddin}
                  onMoveRow={moveRow}
                  onSortByAmount={sortByAmount}
                  onSetWeights={setWeights}
                  lockedKeys={lockedKeys}
                  onToggleLock={toggleLock}
                />
              </div>
            </div>

            {currentRecipe && (
              <div className="mt-6">
                <RecipeText
                  key={currentRecipe.id}
                  notes={currentRecipe.description ?? null}
                  instructions={currentRecipe.instructions ?? null}
                  onSave={updateDetails}
                />
              </div>
            )}

            {currentRecipe && (
              <div className="mt-6">
                <BatchLog
                  recipeId={currentRecipe.id}
                  rows={rows}
                  result={result}
                  profileName={effectiveProfile?.name ?? null}
                  servingMethod={servingMethod ?? result?.serving_method ?? null}
                  servingMethods={servingMethods ?? []}
                  onLoadWeights={(s) => void loadBatchWeights(s)}
                />
              </div>
            )}
          </div>

          {/* Right: Metrics Dashboard */}
          <div className="space-y-4">
            {loading && !result && (
              <div className="rounded-xl border border-base-200 bg-base-100 p-4">
                <div className="flex items-center gap-2 text-sm text-base-content/50">
                  <span className="loading loading-dots loading-sm"></span>
                  <span>Updating recipe analysis…</span>
                </div>
                <p className="mt-2 text-sm text-base-content/45">
                  Keep editing ingredient weights. Balance, freezing, sweetness, and nutrition will refresh automatically.
                </p>
              </div>
            )}

            {result && (
              <>
                {shownComparisons ? (
                  <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-4 lg:sticky lg:top-2 lg:z-10">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">
                        Recipe Balance
                        {effectiveProfile && (
                          <span className="ml-2 normal-case tracking-normal font-normal text-base-content/50">
                            vs <span className="font-medium text-base-content/70">{effectiveProfile.name}</span>
                            {suggestedProfile && <span className="ml-1 italic">(suggested)</span>}
                          </span>
                        )}
                      </h2>
                      <div className="flex items-center gap-3 ml-auto">
                        <span className="text-xs tabular-nums text-base-content/60 whitespace-nowrap">
                          {loading && <span className="loading loading-dots loading-xs mr-2 align-middle" />}
                          {shownComparisons.filter((c) => counted(c) && c.status === "in_range").length}/
                          {shownComparisons.filter(counted).length} in range
                        </span>
                        <div className="join" role="group" aria-label="Show freezing as">
                          {(Object.keys(FREEZE_METRIC_LABELS) as FreezeMetric[]).map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={`join-item btn btn-xs ${freezeMetric === m ? "btn-active" : "btn-ghost"}`}
                              aria-pressed={freezeMetric === m}
                              onClick={() => chooseFreezeMetric(m)}
                            >
                              {FREEZE_METRIC_LABELS[m]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <MetricCards
                      comparisons={result.target_comparison}
                      freezeMetric={freezeMetric}
                      onDragMetric={metricDrag}
                    />
                    {usageWarnings.length > 0 && (
                      <ul className="mt-3 space-y-1 border-t border-base-200 pt-2 text-xs text-amber-700 dark:text-amber-400">
                        {usageWarnings.map((w) => (
                          <li key={w}>▲ {w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-base-300 bg-base-100 px-4 py-3 text-sm text-base-content/55">
                    No target profiles yet. Add some on the Profiles page to see where this recipe sits.
                  </div>
                )}

                <div className="rounded-xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-blue-200/70 bg-blue-50/80 px-3 py-2.5 dark:border-blue-800/30 dark:bg-blue-900/15">
                      <div className="flex items-center gap-1">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                        PAC
                        </h2>
                        <InfoIcon label={TOOLTIPS.pacMix} position="bottom" className="text-blue-500/70 hover:text-blue-600 dark:text-blue-300/70" />
                      </div>
                      <div className="mt-1 flex items-end justify-between gap-3">
                        <div className="text-xl font-bold tabular-nums text-blue-900 dark:text-blue-100">
                          {result.pac.pac_mix.toFixed(1)}
                        </div>
                        <p className="text-xs text-right text-blue-800/75 dark:text-blue-200/75">
                          anti-freeze power per 100g mix
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-200/70 bg-amber-50/80 px-3 py-2.5 dark:border-amber-800/30 dark:bg-amber-900/15">
                      <div className="flex items-center gap-1">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        POD
                        </h2>
                        <InfoIcon label={TOOLTIPS.sweetness} position="bottom" className="text-amber-500/70 hover:text-amber-600 dark:text-amber-300/70" />
                      </div>
                      <div className="mt-1 flex items-end justify-between gap-3">
                        <div className="text-xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
                          {result.sweetness.pod.toFixed(1)}%
                        </div>
                        <p className="text-xs text-right text-amber-800/75 dark:text-amber-200/75">
                          relative sweetness vs sucrose
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-4">
                  <div className="flex items-center gap-1 mb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">
                      Freezing
                    </h2>
                    <InfoIcon label={TOOLTIPS.freezingPoint} position="bottom" />
                  </div>
                  <p className="text-xs text-base-content/40 mb-3">
                    Check when the mix begins freezing and where it reaches scoopable consistency in service.
                  </p>
                  <FreezingSection freezing={result.freezing} profile={withServing(effectiveProfile, result.target_comparison)} />
                </div>

                <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-4">
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">
                      Nutrition
                    </h2>
                    <p className="text-xs text-base-content/40 mt-1">
                      Keep the label-facing numbers visible while you balance texture and scoopability.
                    </p>
                  </div>
                  <NutritionTable nutrition={result.nutrition} />
                </div>

                <div className="rounded-xl border border-base-200 bg-base-100 p-4 shadow-sm">
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">
                      Composition
                    </h2>
                    <p className="text-xs text-base-content/40 mt-1">
                      Secondary reference values for diagnosing why the recipe behaves the way it does.
                    </p>
                  </div>
                  <CompositionTable composition={result.composition} sweetness={result.sweetness} />
                </div>
              </>
            )}

            {!result && !loading && rows.length === 0 && (
              <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-8 text-center">
                <IceCreamCone className="mx-auto text-base-content/30 mb-3" size={48} />
                <p className="text-base-content/55 font-medium">
                  Start with a few core ingredients to build your mix.
                </p>
                <p className="mt-2 text-sm text-base-content/40">
                  Choose a profile, add dairy and sugars, then refine texture and scoopability with the analysis panels.
                </p>
              </div>
            )}

            {!result && !loading && rows.length > 0 && (
              <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-5 text-sm text-base-content/50">
                Add or adjust ingredient weights to generate recipe analysis.
              </div>
            )}
          </div>
        </div>
      </div>

      {balanceOpen && (
        <BalanceModal
          rows={rows}
          lockedKeys={lockedKeys}
          current={result}
          onRun={requestBalance}
          onApply={(proposal) => {
            setWeights(
              Object.fromEntries(
                proposal.ingredients.map((i) => [keyFor(i.ingredient_id, i.is_addin), i.weight_grams]),
              ),
            );
            setBalanceOpen(false);
          }}
          onClose={() => setBalanceOpen(false)}
        />
      )}

      {dairyOpen && (
        <DairySwapModal
          rows={rows}
          onApply={(keys, parts) => {
            replaceRows(swapDairy(rows, keys, parts));
            setDairyOpen(false);
          }}
          onClose={() => setDairyOpen(false)}
        />
      )}

      {/* Save-as-new dialog */}
      {saveDialogOpen && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="Save recipe">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg mb-4">{duplicating ? "Duplicate Recipe" : "Save Recipe"}</h3>
            {duplicating && currentRecipe && (
              <p className="text-sm text-base-content/60 mb-3">
                Saves the recipe as it is now as a new variant of &ldquo;{currentRecipe.name}&rdquo;, which stays as
                last saved.
              </p>
            )}
            <label className="label" htmlFor="recipe-name-input">
              <span className="label-text">Recipe name</span>
            </label>
            <input
              id="recipe-name-input"
              type="text"
              className="input input-bordered w-full"
              placeholder="My ice cream recipe"
              value={newRecipeName}
              onChange={(e) => setNewRecipeName(e.target.value)}
              onKeyDown={handleSaveNameKeyDown}
              autoFocus
            />
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSaveNewConfirm()}
                disabled={!newRecipeName.trim() || isSaving}
              >
                {isSaving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => setSaveDialogOpen(false)}
            aria-label="Close save dialog"
          />
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmOpen && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="Delete recipe">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg mb-2">Delete Recipe</h3>
            {currentRecipe && <DeleteRecipeMessage recipeId={currentRecipe.id} name={currentRecipe.name} />}
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={() => void handleDeleteConfirm()}
                disabled={isSaving}
              >
                {isSaving ? <span className="loading loading-spinner loading-xs" /> : "Delete"}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => setDeleteConfirmOpen(false)}
            aria-label="Close delete dialog"
          />
        </div>
      )}
    </main>
  );
}
