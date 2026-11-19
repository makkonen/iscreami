import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BalanceGoal, BalanceResponse, CalculateResponse, Ingredient, Recipe, TargetProfile } from "../types";
import {
    balanceRecipe,
    calculate,
    createRecipe,
    updateRecipe as apiUpdateRecipe,
    deleteRecipe as apiDeleteRecipe,
} from "../api";
import { useToast } from "./useToast";
import { errorMessage } from "../lib/errors";
import { STATUS_PREFIX } from "../lib/tags";

export interface RecipeRow {
    ingredient: Ingredient;
    weight_grams: number;
    sort_order: number;
    /** Folded in after freezing: counted in nutrition, not in the mix. */
    is_addin: boolean;
}

/** Rows are identified by ingredient and section: an ingredient can be in both. */
export function rowKey(row: Pick<RecipeRow, "ingredient" | "is_addin">): string {
    return keyFor(row.ingredient.id, row.is_addin);
}

export function keyFor(ingredientId: string, isAddin: boolean): string {
    return `${ingredientId}:${isAddin ? "addin" : "mix"}`;
}

interface RecipeIngredientInput {
    ingredient_id: string;
    weight_grams: number;
    sort_order: number;
    is_addin: boolean;
}

// Rows are persisted in display order; sort_order mirrors the array index.
function toIngredientInputs(rows: RecipeRow[]): RecipeIngredientInput[] {
    return rows.map((r, idx) => ({
        ingredient_id: r.ingredient.id,
        weight_grams: r.weight_grams,
        sort_order: idx,
        is_addin: r.is_addin,
    }));
}

export function useRecipeCalculator() {
    const [rows, setRows] = useState<RecipeRow[]>([]);
    const [result, setResult] = useState<CalculateResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [profile, setProfile] = useState<TargetProfile | null>(null);
    // Chosen serving method id; null follows the profile's usual one.
    const [servingMethod, setServingMethod] = useState<string | null>(null);
    const servingRef = useRef<string | null>(servingMethod);
    useEffect(() => {
        servingRef.current = servingMethod;
    }, [servingMethod]);
    const [currentRecipe, setCurrentRecipe] = useState<Recipe | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const lastErrorAtRef = useRef<number>(0);
    const rowsRef = useRef<RecipeRow[]>(rows);
    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);
    const { addToast } = useToast();
    const qc = useQueryClient();

    // Live recalculation: at most one request in flight. While it runs, only the
    // newest state is queued, so dragging a slider updates as fast as the server
    // answers without piling up requests. `gen` discards responses that were
    // overtaken by clearing the recipe.
    const heldProfileRef = useRef<TargetProfile | null>(null);
    const pendingRef = useRef<{
        rows: RecipeRow[];
        profile: TargetProfile | null;
        serving: string | null;
        gen: number;
    } | null>(null);
    const inFlightRef = useRef(false);
    const genRef = useRef(0);
    const clearedGenRef = useRef(0);

    const pump = useCallback(async () => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setLoading(true);
        try {
            while (pendingRef.current) {
                const job = pendingRef.current;
                pendingRef.current = null;
                try {
                    const resp = await calculate({
                        target_profile_id: job.profile?.id ?? null,
                        // No profile chosen: let the server pick the best fit.
                        suggest_profile: !job.profile,
                        serving_method: job.serving,
                        ingredients: job.rows.map((r) => ({
                            ingredient_id: r.ingredient.id,
                            weight_grams: r.weight_grams,
                            is_addin: r.is_addin,
                        })),
                    });
                    if (job.gen > clearedGenRef.current) setResult(resp);
                } catch {
                    // Only surface the error if it persists (> 5 s since last toast)
                    // to avoid flashing on transient failures.
                    const now = Date.now();
                    if (now - lastErrorAtRef.current > 5000) {
                        lastErrorAtRef.current = now;
                        addToast("Could not reach the server. Please check your connection.");
                    }
                }
            }
        } finally {
            inFlightRef.current = false;
            setLoading(false);
        }
    }, [addToast]);

    const triggerCalculate = useCallback(
        (nextRows: RecipeRow[], nextProfile: TargetProfile | null, nextServing?: string | null) => {
            const gen = ++genRef.current;
            // Zero-weight rows are allowed while editing but the API rejects them.
            const weighed = nextRows.filter((r) => r.weight_grams > 0);
            if (weighed.length === 0) {
                pendingRef.current = null;
                clearedGenRef.current = gen;
                setResult(null);
                return;
            }
            pendingRef.current = {
                rows: weighed,
                // While a drag holds the auto-matched style, judge against it
                // rather than re-matching on every move.
                profile: nextProfile ?? heldProfileRef.current,
                serving: nextServing === undefined ? servingRef.current : nextServing,
                gen,
            };
            void pump();
        },
        [pump]
    );

    const addIngredient = useCallback(
        (ingredient: Ingredient, weight_grams = 100) => {
            const key = rowKey({ ingredient, is_addin: false });
            if (rowsRef.current.some((r) => rowKey(r) === key)) {
                addToast(`"${ingredient.name}" is already in the recipe`, "info");
                return;
            }
            setRows((prev) => {
                const next = [
                    ...prev,
                    { ingredient, weight_grams, sort_order: prev.length, is_addin: false },
                ];
                triggerCalculate(next, profile);
                return next;
            });
        },
        [profile, triggerCalculate, addToast]
    );

    const updateWeight = useCallback(
        (key: string, weight_grams: number) => {
            setRows((prev) => {
                const next = prev.map((r) =>
                    rowKey(r) === key ? { ...r, weight_grams } : r
                );
                triggerCalculate(next, profile);
                return next;
            });
        },
        [profile, triggerCalculate]
    );

    const removeIngredient = useCallback(
        (key: string) => {
            setRows((prev) => {
                const next = prev.filter((r) => rowKey(r) !== key);
                triggerCalculate(next, profile);
                return next;
            });
        },
        [profile, triggerCalculate]
    );

    // Hold the auto-matched style fixed (e.g. while dragging a balance marker),
    // so rows don't appear or vanish mid-drag; null releases it.
    const holdProfile = useCallback(
        (p: TargetProfile | null) => {
            heldProfileRef.current = p;
            if (!p) triggerCalculate(rowsRef.current, profile);
        },
        [profile, triggerCalculate]
    );

    // Rows the balancer must leave alone. Kept per session, not saved.
    const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(new Set());
    const toggleLock = useCallback((key: string) => {
        setLockedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const requestBalance = useCallback(
        (goal: BalanceGoal, allowBigChanges: boolean, keepBatchSize: boolean): Promise<BalanceResponse> =>
            balanceRecipe({
                target_profile_id: profile?.id ?? null,
                suggest_profile: !profile,
                serving_method: servingMethod,
                goal,
                allow_big_changes: allowBigChanges,
                keep_batch_size: keepBatchSize,
                ingredients: rows.map((r) => ({
                    ingredient_id: r.ingredient.id,
                    weight_grams: r.weight_grams,
                    is_addin: r.is_addin,
                    locked: lockedKeys.has(rowKey(r)),
                })),
            }),
        [rows, profile, servingMethod, lockedKeys]
    );

    // Set several weights at once (e.g. scaling the whole batch), keyed by row.
    const setWeights = useCallback(
        (weights: Record<string, number>) => {
            setRows((prev) => {
                const next = prev.map((r) => {
                    const w = weights[rowKey(r)];
                    return w === undefined ? r : { ...r, weight_grams: w };
                });
                triggerCalculate(next, profile);
                return next;
            });
        },
        [profile, triggerCalculate]
    );

    // Row order is the recipe's order: saved with it and restored on Revert.
    const moveRow = useCallback((fromKey: string, toKey: string) => {
        setRows((prev) => {
            const from = prev.findIndex((r) => rowKey(r) === fromKey);
            const to = prev.findIndex((r) => rowKey(r) === toKey);
            if (from === -1 || to === -1 || from === to) return prev;
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    }, []);

    const sortByAmount = useCallback(() => {
        setRows((prev) => [...prev].sort((a, b) => b.weight_grams - a.weight_grams));
    }, []);

    // Move a row between the mix and the add-ins; if the ingredient is already
    // in the other section, the weights are combined.
    const toggleAddin = useCallback(
        (key: string) => {
            setRows((prev) => {
                const row = prev.find((r) => rowKey(r) === key);
                if (!row) return prev;
                const moved = { ...row, is_addin: !row.is_addin };
                const existing = prev.find((r) => rowKey(r) === rowKey(moved));
                const next = existing
                    ? prev
                          .filter((r) => r !== row)
                          .map((r) => (r === existing ? { ...r, weight_grams: r.weight_grams + row.weight_grams } : r))
                    : prev.map((r) => (r === row ? moved : r));
                triggerCalculate(next, profile);
                return next;
            });
        },
        [profile, triggerCalculate]
    );

    const changeProfile = useCallback(
        (p: TargetProfile | null) => {
            setProfile(p);
            triggerCalculate(rows, p);
        },
        [rows, triggerCalculate]
    );

    const changeServingMethod = useCallback(
        (m: string | null) => {
            setServingMethod(m);
            triggerCalculate(rows, profile, m);
        },
        [rows, profile, triggerCalculate]
    );

    const loadRecipe = useCallback(
        (recipe: Recipe, targetProfile?: TargetProfile | null) => {
            const nextRows: RecipeRow[] = recipe.ingredients
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((ri) => ({
                    ingredient: ri.ingredient,
                    weight_grams: ri.weight_grams,
                    sort_order: ri.sort_order,
                    is_addin: ri.is_addin ?? false,
                }));
            const p = targetProfile ?? null;
            const serving = recipe.serving_method ?? null;
            setRows(nextRows);
            setCurrentRecipe(recipe);
            setProfile(p);
            setServingMethod(serving);
            setLockedKeys(new Set());
            triggerCalculate(nextRows, p, serving);
        },
        [triggerCalculate]
    );

    const clearRecipe = useCallback(() => {
        pendingRef.current = null;
        clearedGenRef.current = ++genRef.current;
        setRows([]);
        setResult(null);
        setCurrentRecipe(null);
        setProfile(null);
        setServingMethod(null);
    }, []);

    // Discard unsaved edits and go back to the last saved version.
    const revertRecipe = useCallback(() => {
        if (currentRecipe) loadRecipe(currentRecipe, currentRecipe.target_profile ?? null);
    }, [currentRecipe, loadRecipe]);

    // Save the editor as a new recipe. As a duplicate, it keeps the open
    // recipe's notes and links back to it. Returns the saved recipe, if any.
    const saveAsNewRecipe = useCallback(
        async (name: string, { duplicate = false } = {}): Promise<Recipe | null> => {
            setIsSaving(true);
            try {
                const saved = await createRecipe({
                    name,
                    description: duplicate ? (currentRecipe?.description ?? null) : null,
                    parent_id: duplicate ? (currentRecipe?.id ?? null) : null,
                    // A variant starts its own testing, so status tags stay behind.
                    tags: duplicate
                        ? (currentRecipe?.tags ?? []).filter((t) => !t.startsWith(STATUS_PREFIX))
                        : [],
                    target_profile_id: profile?.id ?? null,
                    serving_method: servingMethod,
                    ingredients: toIngredientInputs(rows),
                });
                setCurrentRecipe(saved);
                qc.setQueryData(["recipe", saved.id], saved);
                qc.invalidateQueries({ queryKey: ["recipes"] });
                addToast(`Recipe "${name}" saved.`, "success");
                return saved;
            } catch (err) {
                addToast(errorMessage(err, "Failed to save recipe."), "error");
                return null;
            } finally {
                setIsSaving(false);
            }
        },
        [rows, profile, servingMethod, currentRecipe, addToast, qc]
    );

    const saveCurrentRecipe = useCallback(async () => {
        if (!currentRecipe) return;
        setIsSaving(true);
        try {
            const saved = await apiUpdateRecipe(currentRecipe.id, {
                name: currentRecipe.name,
                target_profile_id: profile?.id ?? null,
                serving_method: servingMethod,
                ingredients: toIngredientInputs(rows),
            });
            setCurrentRecipe(saved);
            qc.setQueryData(["recipe", saved.id], saved);
            qc.invalidateQueries({ queryKey: ["recipes"] });
            addToast(`Recipe "${saved.name}" updated.`, "success");
        } catch (err) {
            addToast(errorMessage(err, "Failed to update recipe."), "error");
        } finally {
            setIsSaving(false);
        }
    }, [currentRecipe, rows, profile, servingMethod, addToast, qc]);

    // Tags save straight away, separately from the recipe's unsaved edits.
    const updateTags = useCallback(
        async (tags: string[]) => {
            if (!currentRecipe) return;
            const { id, tags: before } = currentRecipe;
            const withTags = (next: string[] | undefined) => (r: Recipe | null | undefined) =>
                r && r.id === id ? { ...r, tags: next } : r;
            // Show them at once, so a second tag added before this one saves builds on it.
            setCurrentRecipe((r) => withTags(tags)(r) ?? null);
            try {
                const saved = await apiUpdateRecipe(id, { tags });
                setCurrentRecipe((r) => withTags(saved.tags)(r) ?? null);
                qc.setQueryData<Recipe>(["recipe", id], (r) => withTags(saved.tags)(r) ?? undefined);
                qc.invalidateQueries({ queryKey: ["recipes"] });
            } catch (err) {
                setCurrentRecipe((r) => withTags(before)(r) ?? null);
                addToast(errorMessage(err, "Failed to save tags."), "error");
            }
        },
        [currentRecipe, addToast, qc]
    );

    // Returns whether the recipe was deleted.
    const deleteCurrentRecipe = useCallback(async (): Promise<boolean> => {
        if (!currentRecipe) return false;
        const name = currentRecipe.name;
        setIsSaving(true);
        try {
            await apiDeleteRecipe(currentRecipe.id);
            qc.invalidateQueries({ queryKey: ["recipes"] });
            addToast(`Recipe "${name}" deleted.`, "success");
            qc.removeQueries({ queryKey: ["recipe", currentRecipe.id] });
            clearRecipe();
            return true;
        } catch (err) {
            addToast(errorMessage(err, "Failed to delete recipe."), "error");
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [currentRecipe, addToast, qc, clearRecipe]);

    // Detect unsaved changes by comparing current state with saved recipe
    const hasUnsavedChanges = useMemo(() => {
        if (!currentRecipe) return false;

        // Check if profile changed
        if ((profile?.id ?? null) !== (currentRecipe.target_profile_id ?? null)) return true;
        if (servingMethod !== (currentRecipe.serving_method ?? null)) return true;

        // Check if ingredient count changed
        if (rows.length !== currentRecipe.ingredients.length) return true;

        // Check if any ingredient, section or weight changed
        const savedByKey = new Map(
            currentRecipe.ingredients.map((ri) => [rowKey({ ingredient: ri.ingredient, is_addin: ri.is_addin ?? false }), ri])
        );
        // Order counts too: it's saved with the recipe.
        const savedOrder = [...currentRecipe.ingredients]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((ri) => rowKey({ ingredient: ri.ingredient, is_addin: ri.is_addin ?? false }));
        if (rows.some((row, i) => rowKey(row) !== savedOrder[i])) return true;
        for (const row of rows) {
            const saved = savedByKey.get(rowKey(row));
            if (!saved || saved?.weight_grams !== row.weight_grams) return true;
        }

        return false;
    }, [currentRecipe, rows, profile, servingMethod]);

    return {
        rows,
        result,
        loading,
        profile,
        servingMethod,
        currentRecipe,
        isSaving,
        hasUnsavedChanges,
        addIngredient,
        updateWeight,
        removeIngredient,
        toggleAddin,
        moveRow,
        sortByAmount,
        setWeights,
        lockedKeys,
        toggleLock,
        holdProfile,
        requestBalance,
        changeProfile,
        changeServingMethod,
        loadRecipe,
        clearRecipe,
        revertRecipe,
        saveAsNewRecipe,
        saveCurrentRecipe,
        updateTags,
        deleteCurrentRecipe,
    };
}
