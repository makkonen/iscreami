/* API client for communicating with the iscreami backend. */

import type {
    BalanceRequest,
    BalanceResponse,
    CalculateRequest,
    CalculateResponse,
    BatchRatings,
    BatchSnapshot,
    Ingredient,
    IngredientCategory,
    IngredientInput,
    PaginatedIngredients,
    Recipe,
    RecipeBatch,
    RecipeExport,
    TargetProfile,
    TargetProfileInput,
    ServingMethod,
} from "./types";

const BASE = "/api/v1";

function parseErrorMessage(status: number, body: string): string {
    let message = `HTTP ${status}`;
    try {
        message = (JSON.parse(body) as { detail?: string })?.detail ?? message;
    } catch {
        /* use status fallback */
    }
    return message;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers,
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(parseErrorMessage(res.status, body));
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
}

// --- Ingredients ---

export function fetchIngredients(
    params?: {
        q?: string;
        category_id?: number;
        source?: string;
        /** Leave out bulk imports (USDA, NZFCDB). */
        exclude_bulk?: boolean;
        offset?: number;
        limit?: number;
    },
    signal?: AbortSignal,
): Promise<PaginatedIngredients> {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.category_id) sp.set("category_id", String(params.category_id));
    if (params?.source) sp.set("source", params.source);
    if (params?.exclude_bulk) sp.set("exclude_bulk", "true");
    if (params?.offset) sp.set("offset", String(params.offset));
    if (params?.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const path = qs ? `/ingredients?${qs}` : "/ingredients";
    return request(path, signal ? { signal } : undefined);
}

export function createIngredient(data: IngredientInput): Promise<Ingredient> {
    return request("/ingredients", { method: "POST", body: JSON.stringify(data) });
}

export function updateIngredient(id: string, data: IngredientInput): Promise<Ingredient> {
    return request(`/ingredients/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteIngredient(id: string): Promise<void> {
    return request(`/ingredients/${id}`, { method: "DELETE" });
}

// --- Categories ---

export function fetchCategories(): Promise<IngredientCategory[]> {
    return request("/ingredient-categories");
}

// --- Recipes ---

export function fetchRecipes(): Promise<{ total: number; items: Recipe[] }> {
    return request("/recipes?limit=200");
}

/** Link to download a recipe as a .paprikarecipe file. */
export function paprikaUrl(id: string): string {
    return `${BASE}/recipes/${id}/paprika`;
}

export function fetchRecipe(id: string): Promise<Recipe> {
    return request(`/recipes/${id}`);
}

export function createRecipe(data: {
    name: string;
    description?: string | null;
    instructions?: string | null;
    source_url?: string | null;
    parent_id?: string | null;
    tags?: string[];
    target_profile_id?: string | null;
    serving_method?: string | null;
    ingredients: { ingredient_id: string; weight_grams: number; sort_order: number; is_addin?: boolean }[];
}): Promise<Recipe> {
    return request("/recipes", { method: "POST", body: JSON.stringify(data) });
}

export function updateRecipe(
    id: string,
    data: {
        name?: string;
        description?: string | null;
        instructions?: string | null;
        source_url?: string | null;
        tags?: string[];
        rating?: number | null;
        target_profile_id?: string | null;
        serving_method?: string | null;
        ingredients?: { ingredient_id: string; weight_grams: number; sort_order: number; is_addin?: boolean }[];
    }
): Promise<Recipe> {
    return request(`/recipes/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function fetchIngredient(id: string): Promise<Ingredient> {
    return request(`/ingredients/${id}`);
}

// --- Batches ---

export function fetchBatches(recipeId: string): Promise<RecipeBatch[]> {
    return request(`/recipes/${recipeId}/batches`);
}

export function createBatch(recipeId: string, data: BatchRatings & { snapshot: BatchSnapshot }): Promise<RecipeBatch> {
    return request(`/recipes/${recipeId}/batches`, { method: "POST", body: JSON.stringify(data) });
}

export function updateBatch(recipeId: string, batchId: string, data: Partial<BatchRatings>): Promise<RecipeBatch> {
    return request(`/recipes/${recipeId}/batches/${batchId}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteBatch(recipeId: string, batchId: string): Promise<void> {
    return request(`/recipes/${recipeId}/batches/${batchId}`, { method: "DELETE" });
}

export function deleteRecipe(id: string): Promise<void> {
    return request(`/recipes/${id}`, { method: "DELETE" });
}

// --- Target Profiles ---

export function fetchProfiles(): Promise<TargetProfile[]> {
    return request("/target-profiles");
}

export function fetchServingMethods(): Promise<ServingMethod[]> {
    return request("/serving-methods");
}

export function createProfile(data: TargetProfileInput): Promise<TargetProfile> {
    return request("/target-profiles", { method: "POST", body: JSON.stringify(data) });
}

export function updateProfile(id: string, data: TargetProfileInput): Promise<TargetProfile> {
    return request(`/target-profiles/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteProfile(id: string): Promise<void> {
    return request(`/target-profiles/${id}`, { method: "DELETE" });
}

// --- Calculator ---

export function balanceRecipe(data: BalanceRequest): Promise<BalanceResponse> {
    return request("/balance", { method: "POST", body: JSON.stringify(data) });
}

export function calculate(data: CalculateRequest): Promise<CalculateResponse> {
    return request("/calculate", { method: "POST", body: JSON.stringify(data) });
}

// --- Export/Import ---

export async function exportRecipe(id: string): Promise<RecipeExport> {
    return request(`/recipes/${id}/export`);
}

export async function exportAllRecipes(): Promise<RecipeExport[]> {
    return request(`/recipes/export-all`);
}

export function importRecipes(file: File): Promise<Recipe[]> {
    const formData = new FormData();
    formData.append("file", file);
    return request("/recipes/import", { method: "POST", body: formData });
}
