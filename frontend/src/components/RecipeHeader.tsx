import { Copy, GitBranch, RotateCcw, Save, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { TagEditor } from "./TagEditor";
import type { CalculateResponse, Recipe, ServingMethod, TargetProfile } from "../types";
import { Tooltip } from "./Tooltip";
import { TOOLTIPS } from "../lib/tooltips";
import { InfoIcon } from "./InfoIcon";
import { fmtEnergy } from "../lib/formatting";
import { servingGroups, withServing } from "../lib/serving";
import { isTargeted } from "../lib/metrics";

interface StatusPill {
  label: string;
  value: string;
  tone: string;
}

function getBalancePill(result: CalculateResponse | null): StatusPill {
  // PAC, % frozen and serving temperature are the same judgement; count it once.
  const comparisons = result?.target_comparison?.filter(
    (c) => c.metric !== "serving_temp" && c.metric !== "frozen_pct" && isTargeted(c),
  );
  if (!comparisons || comparisons.length === 0) {
    return {
      label: "Balance",
      value: "No target",
      tone: "bg-base-200 text-base-content/70",
    };
  }

  const issueCount = comparisons.filter((comparison) => comparison.status !== "in_range").length;
  if (issueCount === 0) {
    return {
      label: "Balance",
      value: "On target",
      tone: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    };
  }

  if (issueCount <= 2) {
    return {
      label: "Balance",
      value: `${issueCount} issue${issueCount === 1 ? "" : "s"}`,
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }

  return {
    label: "Balance",
    value: `${issueCount} issues`,
    tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
}

function getFreezePill(result: CalculateResponse | null, targetProfile: TargetProfile | null): StatusPill {
  const servingTemp = result?.freezing.serving_temperature_c;
  if (servingTemp == null) {
    return {
      label: "Scoopability",
      value: "No data",
      tone: "bg-base-200 text-base-content/70",
    };
  }

  if (
    targetProfile?.serving_temp_min != null &&
    targetProfile.serving_temp_max != null
  ) {
    if (servingTemp < targetProfile.serving_temp_min) {
      return {
        label: "Scoopability",
        value: "Softer than target",
        tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
      };
    }
    if (servingTemp > targetProfile.serving_temp_max) {
      return {
        label: "Scoopability",
        value: "Harder than target",
        tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      };
    }
    return {
      label: "Scoopability",
      value: "In serving range",
      tone: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    };
  }

  if (servingTemp >= -8) {
    return {
      label: "Scoopability",
      value: "Very firm",
      tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    };
  }
  if (servingTemp >= -11) {
    return {
      label: "Scoopability",
      value: "Firm",
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  if (servingTemp >= -14) {
    return {
      label: "Scoopability",
      value: "Balanced",
      tone: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    };
  }
  if (servingTemp >= -17) {
    return {
      label: "Scoopability",
      value: "Soft",
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  return {
    label: "Scoopability",
    value: "Very soft",
    tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
}

function getSweetnessPill(result: CalculateResponse | null, targetProfile: TargetProfile | null): StatusPill {
  const pod = result?.sweetness.pod;
  if (pod == null) {
    return {
      label: "Sweetness",
      value: "No data",
      tone: "bg-base-200 text-base-content/70",
    };
  }

  if (targetProfile?.sweetness_min != null && targetProfile.sweetness_max != null) {
    if (pod < targetProfile.sweetness_min) {
      return {
        label: "Sweetness",
        value: "Below target",
        tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
      };
    }
    if (pod > targetProfile.sweetness_max) {
      return {
        label: "Sweetness",
        value: "Above target",
        tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      };
    }
    return {
      label: "Sweetness",
      value: "On target",
      tone: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    };
  }

  if (pod < 14) {
    return {
      label: "Sweetness",
      value: "Restrained",
      tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
    };
  }
  if (pod <= 18) {
    return {
      label: "Sweetness",
      value: "Balanced",
      tone: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    };
  }
  return {
    label: "Sweetness",
    value: "Sweet-forward",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  };
}

interface RecipeHeaderProps {
  readonly recipeName: string | null;
  /** The open recipe's id, once saved. */
  readonly recipeId?: string | null;
  /** The profile chosen for this recipe, if any. */
  readonly targetProfile: TargetProfile | null;
  /** Best-fit profile used when none is chosen. */
  readonly suggestedProfile: TargetProfile | null;
  /** Chosen serving method id; null follows the profile's usual one. */
  readonly servingMethod: string | null;
  readonly servingMethods?: ServingMethod[];
  readonly onChangeServingMethod: (methodId: string | null) => void;
  readonly profiles?: TargetProfile[];
  readonly result: CalculateResponse | null;
  readonly isSaving: boolean;
  readonly hasIngredients: boolean;
  readonly hasUnsavedChanges: boolean;
  readonly onSaveRecipe: () => void;
  readonly onRevertRecipe: () => void;
  readonly onDuplicateRecipe: () => void;
  readonly onDeleteRecipe: () => void;
  readonly onChangeProfile: (profile: TargetProfile | null) => void;
  /** The recipe this one was duplicated from, if it still exists. */
  readonly parentRecipe?: Pick<Recipe, "id" | "name"> | null;
  /** Recipes duplicated from this one. */
  readonly variants?: Pick<Recipe, "id" | "name">[];
  readonly tags?: readonly string[];
  /** Every tag in use, for suggestions. */
  readonly allTags?: readonly string[];
  readonly onChangeTags?: (tags: string[]) => void;
}

export function RecipeHeader({
  recipeName,
  recipeId = null,
  targetProfile,
  suggestedProfile,
  servingMethod,
  servingMethods = [],
  onChangeServingMethod,
  profiles,
  result,
  isSaving,
  hasIngredients,
  hasUnsavedChanges,
  onSaveRecipe,
  onRevertRecipe,
  onDuplicateRecipe,
  onDeleteRecipe,
  onChangeProfile,
  parentRecipe = null,
  variants = [],
  tags = [],
  allTags = [],
  onChangeTags,
}: RecipeHeaderProps) {
  const effectiveProfile = targetProfile ?? suggestedProfile;
  // The serving method actually applied (chosen, or the profile's usual one).
  const inEffect = servingMethods.find((m) => m.id === (servingMethod ?? result?.serving_method));
  // Freezing is judged against how it'll be served, not the style's default.
  const judgedProfile = withServing(effectiveProfile, result?.target_comparison);
  const summaryPills = [
    getBalancePill(result),
    getFreezePill(result, judgedProfile),
    getSweetnessPill(result, judgedProfile),
  ];

  return (
    <div className="bg-linear-to-r from-pink-50 to-pink-50/50 dark:from-pink-900/20 dark:to-pink-900/10 rounded-xl border border-pink-200 dark:border-pink-800/30 p-4 mb-0">
      <div className="max-w-7xl mx-auto">
        {/* Title and action buttons in single row */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-base-content mb-1">
              {recipeName ? (
                <span>{recipeName}</span>
              ) : (
                <span className="text-base-content/40 italic">Unsaved recipe</span>
              )}
            </h1>
            {(parentRecipe || variants.length > 0) && (
              <p className="mb-1 flex flex-wrap items-center gap-x-1.5 text-sm text-base-content/60">
                <GitBranch size={14} className="shrink-0" aria-hidden="true" />
                {parentRecipe && (
                  <span>
                    Based on{" "}
                    <Link to={`/calculator/${parentRecipe.id}`} className="link link-hover font-medium text-base-content/80">
                      {parentRecipe.name}
                    </Link>
                    {recipeId && (
                      <>
                        {" "}
                        (
                        <Link to={`/compare?a=${parentRecipe.id}&b=${recipeId}`} className="link link-hover">
                          compare
                        </Link>
                        )
                      </>
                    )}
                  </span>
                )}
                {parentRecipe && variants.length > 0 && <span aria-hidden="true">·</span>}
                {variants.length > 0 && (
                  <span>
                    Variants:{" "}
                    {variants.map((v, i) => (
                      <span key={v.id}>
                        {i > 0 && ", "}
                        <Link to={`/calculator/${v.id}`} className="link link-hover font-medium text-base-content/80">
                          {v.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
              </p>
            )}
            {recipeName && onChangeTags && (
              <div className="mb-1.5">
                <TagEditor tags={tags} allTags={allTags} onChange={onChangeTags} />
              </div>
            )}
            {/* Compact summary line */}
            <div className="flex items-center gap-3 text-sm text-base-content/60 flex-wrap">
              {effectiveProfile ? (
                <span>
                  Profile: <span className="font-semibold text-base-content/80">{effectiveProfile.name}</span>
                  {!targetProfile && <span className="ml-1 italic">(suggested)</span>}
                </span>
              ) : null}
              {result?.composition.total_weight_g ? (
                <span>
                  Weight: <span className="font-semibold text-base-content/80">{result.composition.total_weight_g.toFixed(0)}g</span>
                </span>
              ) : null}
              {result?.nutrition.per_100g.energy_kj ? (
                <span>
                  Energy:{" "}
                  <span className="font-semibold text-base-content/80">
                    {fmtEnergy(result.nutrition.per_100g.energy_kj)}
                  </span>{" "}
                  /100 g
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {summaryPills.map((pill) => (
                <div
                  key={pill.label}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${pill.tone}`}
                >
                  <span className="opacity-70">{pill.label}:</span>{" "}
                  <span>{pill.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 self-start lg:self-end">
            <div className="flex items-center gap-2">
              <label htmlFor="serving-select" className="text-xs text-base-content/55 flex items-center gap-1">
                Serving
                <InfoIcon label={TOOLTIPS.servingMethod} position="bottom" />
              </label>
              <select
                id="serving-select"
                value={servingMethod ?? ""}
                onChange={(e) => onChangeServingMethod(e.target.value || null)}
                className="select select-sm"
                title={inEffect?.description}
              >
                <option value="">
                  {!servingMethod && inEffect ? `Auto: ${inEffect.label}` : "Auto (style's usual)"}
                </option>
                {servingGroups(servingMethods).map((group) => (
                  <optgroup key={group} label={group}>
                    {servingMethods.filter((m) => m.group === group).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="profile-select" className="text-xs text-base-content/55 flex items-center gap-1">
                Profile
                <InfoIcon label={TOOLTIPS.profile} position="bottom" />
              </label>
              <select
                id="profile-select"
                value={targetProfile?.id ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const profile = profiles?.find((item) => item.id === id) ?? null;
                  onChangeProfile(profile);
                }}
                className="select select-sm min-w-48"
              >
                <option value="">
                  {suggestedProfile ? `Auto: ${suggestedProfile.name}` : "Auto (best fit)"}
                </option>
                {profiles?.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
            <Tooltip content={TOOLTIPS.saveRecipe}>
              <button
                type="button"
                className="btn btn-sm btn-primary gap-1"
                onClick={onSaveRecipe}
                disabled={isSaving || (!recipeName && !hasIngredients) || (!!recipeName && !hasUnsavedChanges)}
              >
                <Save size={16} />
                {recipeName ? "Update" : "Save"}
              </button>
            </Tooltip>
            {recipeName && (
              <Tooltip content={TOOLTIPS.revertRecipe}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost gap-1"
                  onClick={onRevertRecipe}
                  disabled={isSaving || !hasUnsavedChanges}
                >
                  <RotateCcw size={16} />
                  Revert
                </button>
              </Tooltip>
            )}
            {recipeName && (
              <Tooltip content={TOOLTIPS.duplicateRecipe}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost gap-1"
                  onClick={onDuplicateRecipe}
                  disabled={isSaving}
                >
                  <Copy size={16} />
                  Duplicate
                </button>
              </Tooltip>
            )}
            {recipeName && (
              <Tooltip content={TOOLTIPS.deleteRecipe}>
                <button
                  type="button"
                  className="btn btn-sm btn-error btn-outline gap-1"
                  onClick={onDeleteRecipe}
                  disabled={isSaving}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
