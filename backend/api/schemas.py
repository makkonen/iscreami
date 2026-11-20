"""Pydantic v2 schemas for request/response models."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from api.services.composition import ingredient_total_solids_pct
from api.services.pac import ingredient_pac
from api.services.sweetness import ingredient_pod
from api.settings import settings

# --- Enums ---


class MetricStatus(StrEnum):
    in_range = "in_range"
    below = "below"
    above = "above"


# --- Ingredient Category ---


class IngredientCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str


# --- Ingredient ---


class IngredientBase(BaseModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    category_id: int | None = None
    source: str = Field(default="manual", max_length=50)
    source_id: str | None = Field(default=None, max_length=100)

    # Composition per 100g
    water_pct: float | None = None
    total_fat_pct: float | None = None
    saturated_fat_pct: float | None = None
    trans_fat_pct: float | None = None
    protein_pct: float | None = None
    carbohydrate_pct: float | None = None
    fiber_pct: float | None = None
    total_sugar_pct: float | None = None
    energy_kj_per_100g: float | None = None
    alcohol_pct: float | None = None
    sodium_mg: float | None = None

    # Sugar breakdown
    sucrose_pct: float | None = None
    glucose_pct: float | None = None
    fructose_pct: float | None = None
    lactose_pct: float | None = None
    maltose_pct: float | None = None
    galactose_pct: float | None = None

    # Dairy-specific
    milk_fat_pct: float | None = None
    msnf_pct: float | None = None

    # Chocolate-specific
    cocoa_butter_pct: float | None = None
    cocoa_solids_pct: float | None = None

    # Stabilizer/emulsifier content per 100g
    stabilizer_pct: float | None = None
    emulsifier_pct: float | None = None

    # Overrides
    pac_override: float | None = None
    pod_override: float | None = None

    # Typical use, % of the whole mix
    usage_min_pct: float | None = Field(default=None, ge=0, le=100)
    usage_max_pct: float | None = Field(default=None, ge=0, le=100)

    aliases: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("aliases")
    @classmethod
    def check_alias_lengths(cls, v: list[str]) -> list[str]:
        for i, alias in enumerate(v):
            if len(alias) > 200:
                raise ValueError(
                    f"Alias at index {i} exceeds maximum length of 200 characters"
                )
        return v


class IngredientCreate(IngredientBase):
    pass


class IngredientUpdate(IngredientBase):
    name: str | None = None  # type: ignore[assignment]


class IngredientOut(IngredientBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    category: IngredientCategoryOut | None = None

    @field_validator("aliases", mode="before")  # type: ignore[misc]
    @classmethod
    def coerce_aliases(cls, v: object) -> list[str]:
        if isinstance(v, list) and v and hasattr(v[0], "alias"):
            return [item.alias for item in v]  # type: ignore[union-attr]
        return v  # type: ignore[return-value]

    @computed_field  # type: ignore[misc]
    @property
    def pac(self) -> float:
        return ingredient_pac(self)  # type: ignore[arg-type]

    @computed_field  # type: ignore[misc]
    @property
    def pod(self) -> float:
        return ingredient_pod(self)  # type: ignore[arg-type]

    @computed_field  # type: ignore[misc]
    @property
    def total_solids_pct(self) -> float:
        return ingredient_total_solids_pct(self)  # type: ignore[arg-type]


class PaginatedIngredients(BaseModel):
    total: int
    items: list[IngredientOut]


# --- Target Profile ---


class TargetProfileBase(BaseModel):
    name: str = Field(max_length=255)
    serving_temp_min: float | None = None
    serving_temp_max: float | None = None
    sweetness_min: float | None = None
    sweetness_max: float | None = None
    total_solids_min: float | None = None
    total_solids_max: float | None = None
    total_fat_min: float | None = None
    total_fat_max: float | None = None
    milk_fat_min: float | None = None
    milk_fat_max: float | None = None
    sugar_min: float | None = None
    sugar_max: float | None = None
    alcohol_min: float | None = None
    alcohol_max: float | None = None
    msnf_min: float | None = None
    msnf_max: float | None = None
    stabilizer_min: float | None = None
    stabilizer_max: float | None = None
    emulsifier_min: float | None = None
    emulsifier_max: float | None = None
    protein_min: float | None = None
    protein_max: float | None = None
    # How this style is usually served (an id from /serving-methods).
    default_serving_method: str | None = Field(default=None, max_length=50)


class TargetProfileCreate(TargetProfileBase):
    pass


class TargetProfileUpdate(TargetProfileBase):
    name: str | None = None  # type: ignore[assignment]


class TargetProfileOut(TargetProfileBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


# --- Recipe ---

MAX_RECIPE_TAGS = 30
MAX_RECIPE_TEXT = 20000  # notes and instructions


def normalize_tags(tags: list[str] | None) -> list[str] | None:
    """Tidy tags: trim each "/" level, drop empty levels and duplicates, sort."""
    if tags is None:
        return None
    seen: dict[str, str] = {}
    for tag in tags:
        parts = [" ".join(p.split()) for p in tag.split("/")]
        clean = "/".join(p for p in parts if p)[:100]
        if clean and clean.casefold() not in seen:
            seen[clean.casefold()] = clean
    return sorted(seen.values(), key=str.casefold)


class RecipeIngredientInput(BaseModel):
    ingredient_id: uuid.UUID
    weight_grams: float = Field(gt=0)
    sort_order: int = 0
    is_addin: bool = False


MAX_RECIPE_INGREDIENTS = 100  # shared across schemas, routes, and export


class RecipeIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ingredient_id: uuid.UUID
    weight_grams: float
    sort_order: int
    is_addin: bool = False
    ingredient: IngredientOut


class RecipeCreate(BaseModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=MAX_RECIPE_TEXT)
    instructions: str | None = Field(default=None, max_length=MAX_RECIPE_TEXT)
    recipe_type: str | None = Field(default=None, max_length=100)
    serving_method: str | None = Field(default=None, max_length=50)
    target_profile_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list, max_length=MAX_RECIPE_TAGS)
    ingredients: list[RecipeIngredientInput] = Field(
        default_factory=list, max_length=MAX_RECIPE_INGREDIENTS
    )

    _tidy_tags = field_validator("tags")(normalize_tags)


class RecipeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)  # type: ignore[assignment]
    description: str | None = Field(default=None, max_length=MAX_RECIPE_TEXT)
    instructions: str | None = Field(default=None, max_length=MAX_RECIPE_TEXT)
    recipe_type: str | None = Field(default=None, max_length=100)
    serving_method: str | None = Field(default=None, max_length=50)
    target_profile_id: uuid.UUID | None = None
    tags: list[str] | None = Field(default=None, max_length=MAX_RECIPE_TAGS)
    ingredients: list[RecipeIngredientInput] | None = Field(
        default=None, max_length=MAX_RECIPE_INGREDIENTS
    )

    _tidy_tags = field_validator("tags")(normalize_tags)


class RecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str | None = None
    instructions: str | None = None
    recipe_type: str | None = None
    serving_method: str | None = None
    target_profile_id: uuid.UUID | None = None
    target_profile: TargetProfileOut | None = None
    parent_id: uuid.UUID | None = None
    tags: list[str] = []
    created_at: datetime
    updated_at: datetime
    ingredients: list[RecipeIngredientOut] = []

    @computed_field  # type: ignore[misc]
    @property
    def total_weight_grams(self) -> float:
        return sum(ingredient.weight_grams for ingredient in self.ingredients)


# --- Batches ---


class BatchIngredient(BaseModel):
    ingredient_id: uuid.UUID
    name: str = Field(max_length=255)
    weight_grams: float = Field(ge=0)
    is_addin: bool = False


class BatchSnapshot(BaseModel):
    """What went into a batch, and its key metrics, as made."""

    ingredients: list[BatchIngredient] = Field(max_length=MAX_RECIPE_INGREDIENTS)
    # e.g. pac, pod, serving_temp_c, frozen_pct, protein_pct, kcal_per_100g.
    metrics: dict[str, float | None] = Field(default_factory=dict, max_length=40)
    profile_name: str | None = Field(default=None, max_length=255)


class BatchBase(BaseModel):
    made_on: date
    serving_method: str | None = Field(default=None, max_length=50)
    hardness: int | None = Field(default=None, ge=-2, le=2)
    sweetness: int | None = Field(default=None, ge=-2, le=2)
    iciness: int | None = Field(default=None, ge=0, le=3)
    overall: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, max_length=5000)


class BatchCreate(BatchBase):
    snapshot: BatchSnapshot


class BatchUpdate(BaseModel):
    """Ratings and notes can be revised; what went in can't."""

    made_on: date | None = None
    serving_method: str | None = Field(default=None, max_length=50)
    hardness: int | None = Field(default=None, ge=-2, le=2)
    sweetness: int | None = Field(default=None, ge=-2, le=2)
    iciness: int | None = Field(default=None, ge=0, le=3)
    overall: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, max_length=5000)


class BatchOut(BatchBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    recipe_id: uuid.UUID
    snapshot: BatchSnapshot
    created_at: datetime


class PaginatedRecipes(BaseModel):
    total: int
    items: list[RecipeOut]


# --- Calculator ---


class CalculateIngredientInput(BaseModel):
    ingredient_id: uuid.UUID
    weight_grams: float = Field(gt=0)
    # Folded in after freezing: counted in nutrition, not in the mix.
    is_addin: bool = False


class CalculateRequest(BaseModel):
    target_profile_id: uuid.UUID | None = None
    ingredients: list[CalculateIngredientInput] = Field(
        min_length=1, max_length=MAX_RECIPE_INGREDIENTS
    )
    serving_size_g: float = Field(default=settings.serving_size_g, gt=0)
    # With no target_profile_id, pick the best-fitting profile and compare against it.
    suggest_profile: bool = False
    # How it's served (an id from /serving-methods); sets the freezing targets.
    # Unset: the profile's usual serving method.
    serving_method: str | None = Field(default=None, max_length=50)


class CompositionResult(BaseModel):
    total_weight_g: float
    water_pct: float
    total_solids_pct: float
    total_fat_pct: float
    saturated_fat_pct: float
    trans_fat_pct: float
    milk_fat_pct: float
    msnf_pct: float
    # MSNF scaled to the milk salts it carries, as the freezing model uses it
    # (lower than msnf_pct when whey protein isolate and the like are in).
    msnf_for_freezing_pct: float = 0.0
    total_sugar_pct: float
    protein_pct: float
    carbohydrate_pct: float
    fiber_pct: float
    alcohol_pct: float
    stabilizer_pct: float
    emulsifier_pct: float


class PACResult(BaseModel):
    pac_mix: float  # per 100g mix
    pac_water: float | None  # per 100g free water (None if no free water)


class FreezingCurvePoint(BaseModel):
    temperature_c: float
    frozen_water_pct: float


class FreezingResult(BaseModel):
    freezing_point_c: float
    serving_temperature_c: float | None
    curve: list[FreezingCurvePoint]


class SweetenerBreakdownItem(BaseModel):
    ingredient_name: str
    weight_g: float
    pct_of_sweeteners: float


class SweetnessResult(BaseModel):
    pod: float  # relative sweetness %
    sweetener_breakdown: list[SweetenerBreakdownItem]


class NutritionResult(BaseModel):
    per_100g: dict[str, float]
    per_serving: dict[str, float]
    serving_size_g: float


class MetricComparison(BaseModel):
    metric: str
    value: float
    target_min: float | None
    target_max: float | None
    status: MetricStatus


class CalculateResponse(BaseModel):
    composition: CompositionResult
    pac: PACResult
    freezing: FreezingResult
    sweetness: SweetnessResult
    nutrition: NutritionResult
    target_comparison: list[MetricComparison] | None = None
    # Set when target_comparison is against a suggested (best-fit) profile.
    suggested_profile_id: uuid.UUID | None = None
    # The serving method the freezing targets were judged against.
    serving_method: str | None = None


class ServingMethodOut(BaseModel):
    id: str
    label: str
    group: str
    description: str
    eating_temp_c: float
    frozen_pct_min: float
    frozen_pct_max: float


# --- Export/Import ---


class RecipeExportMetrics(BaseModel):
    """Calculated metrics in exported recipes."""

    model_config = ConfigDict(from_attributes=True)

    pac_mix: float
    pac_water: float | None = None
    pod: float
    freezing_point_c: float
    free_water_g: float
    sugar_solids_g: float


class RecipeExportOut(BaseModel):
    """Recipe as exported (includes calculated metrics and underscore keys)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None
    instructions: str | None = None
    recipe_type: str | None = None
    serving_method: str | None = None
    tags: list[str] = []
    created_at: str
    updated_at: str
    total_weight_grams: float
    target_profile: TargetProfileOut | None = None
    ingredients: list[RecipeIngredientOut] = []
    calculated_metrics: RecipeExportMetrics


# --- System ---


class HealthResponse(BaseModel):
    """Health check response."""

    status: str


# --- Balancing ---


class BalanceGoal(StrEnum):
    """What the balancer optimises once targets are met."""

    closest = "closest"  # change as little as possible
    centred = "centred"  # sit as close to the middle of each range as possible
    min_kcal = "min_kcal"  # fewest calories
    max_protein = "max_protein"  # most protein


class BalanceIngredientInput(BaseModel):
    ingredient_id: uuid.UUID
    weight_grams: float = Field(ge=0)
    is_addin: bool = False
    # Keep this weight as it is.
    locked: bool = False


class BalanceRequest(BaseModel):
    target_profile_id: uuid.UUID | None = None
    # With no target_profile_id, balance against the best-fitting profile.
    suggest_profile: bool = True
    serving_method: str | None = Field(default=None, max_length=50)
    goal: BalanceGoal = BalanceGoal.closest
    # By default each ingredient stays within half to double its weight.
    allow_big_changes: bool = False
    # By default the batch may move by up to 15% (per-100 g goals keep it).
    keep_batch_size: bool = False
    ingredients: list[BalanceIngredientInput] = Field(
        min_length=1, max_length=MAX_RECIPE_INGREDIENTS
    )


class BalancedIngredient(BaseModel):
    ingredient_id: uuid.UUID
    is_addin: bool
    weight_grams: float


class BalanceResponse(BaseModel):
    profile_id: uuid.UUID
    # Every ingredient, in request order; add-ins and locked rows unchanged.
    ingredients: list[BalancedIngredient]
    # Targets the balancer couldn't meet with the ingredients available.
    unmet: list[MetricComparison]
    # Full analysis of the balanced recipe (add-ins included in nutrition).
    result: CalculateResponse
