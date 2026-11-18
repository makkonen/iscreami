"""Recipe calculator — orchestrates all sub-calculators.

Takes a list of (Ingredient, weight_grams) pairs and produces the full
calculation result: composition, PAC, freezing, sweetness, nutrition,
and optional target profile comparison.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from api.models import SUGAR_FIELDS
from api.schemas import (
    CalculateResponse,
    CompositionResult,
    FreezingCurvePoint,
    FreezingResult,
    MetricComparison,
    MetricStatus,
    NutritionResult,
    PACResult,
    SweetenerBreakdownItem,
    SweetnessResult,
)
from api.services.freezing import (
    fpd_at_frozen_pct,
    freezing_curve,
    freezing_point,
    frozen_water_fraction,
)
from api.services.pac import recipe_pac
from api.services.serving import ServingTarget, serving_method
from api.services.sweetness import recipe_pod
from api.settings import settings

if TYPE_CHECKING:
    from api.models import Ingredient, TargetProfile


def _weighted_pct(
    items: list[tuple[Ingredient, float]],
    attr: str,
    total_weight: float,
) -> float:
    """Compute weighted percentage for a given ingredient attribute."""
    total = 0.0
    for ingredient, weight_g in items:
        val = getattr(ingredient, attr, None)
        if val is not None:
            total += float(val) * weight_g / 100.0
    return total / total_weight * 100.0 if total_weight > 0 else 0.0


def calculate_composition(
    items: list[tuple[Ingredient, float]],
) -> CompositionResult:
    total_weight = sum(w for _, w in items)

    water = _weighted_pct(items, "water_pct", total_weight)
    total_fat = _weighted_pct(items, "total_fat_pct", total_weight)
    sat_fat = _weighted_pct(items, "saturated_fat_pct", total_weight)
    trans_fat = _weighted_pct(items, "trans_fat_pct", total_weight)
    milk_fat = _weighted_pct(items, "milk_fat_pct", total_weight)
    msnf = _weighted_pct(items, "msnf_pct", total_weight)
    total_sugar = _weighted_pct(items, "total_sugar_pct", total_weight)
    protein = _weighted_pct(items, "protein_pct", total_weight)
    carbohydrate = _weighted_pct(items, "carbohydrate_pct", total_weight)
    fiber = _weighted_pct(items, "fiber_pct", total_weight)
    alcohol = _weighted_pct(items, "alcohol_pct", total_weight)
    stabilizer = _weighted_pct(items, "stabilizer_pct", total_weight)
    emulsifier = _weighted_pct(items, "emulsifier_pct", total_weight)

    return CompositionResult(
        total_weight_g=round(total_weight, 2),
        water_pct=round(water, 2),
        total_solids_pct=round(100.0 - water - alcohol, 2),
        total_fat_pct=round(total_fat, 2),
        saturated_fat_pct=round(sat_fat, 2),
        trans_fat_pct=round(trans_fat, 2),
        milk_fat_pct=round(milk_fat, 2),
        msnf_pct=round(msnf, 2),
        total_sugar_pct=round(total_sugar, 2),
        protein_pct=round(protein, 2),
        carbohydrate_pct=round(carbohydrate, 2),
        fiber_pct=round(fiber, 2),
        alcohol_pct=round(alcohol, 2),
        stabilizer_pct=round(stabilizer, 2),
        emulsifier_pct=round(emulsifier, 2),
    )


def calculate_pac(items: list[tuple[Ingredient, float]]) -> PACResult:
    pac_mix, pac_water = recipe_pac(items)
    return PACResult(
        pac_mix=round(pac_mix, 2),
        pac_water=round(pac_water, 2) if pac_water is not None else None,
    )


def calculate_freezing(
    pac_result: PACResult, composition: CompositionResult
) -> FreezingResult:
    pac_water = pac_result.pac_water
    msnf_pct = composition.msnf_pct
    water_pct = composition.water_pct

    fp = freezing_point(pac_water, msnf_pct, water_pct)
    curve = freezing_curve(pac_water, msnf_pct, water_pct)

    # Serving temperature at 75% frozen water (industry standard)
    serving_temp: float | None = None
    if pac_water is not None and pac_water > 0 and water_pct > 0:
        fpd = fpd_at_frozen_pct(75.0, pac_water, msnf_pct, water_pct)
        serving_temp = -round(fpd, 2)

    return FreezingResult(
        freezing_point_c=round(fp, 2),
        serving_temperature_c=serving_temp,
        curve=[
            FreezingCurvePoint(temperature_c=t, frozen_water_pct=f) for t, f in curve
        ],
    )


def calculate_sweetness(
    items: list[tuple[Ingredient, float]],
) -> SweetnessResult:
    pod = recipe_pod(items)

    # Build sweetener breakdown
    breakdown: list[SweetenerBreakdownItem] = []
    total_sweetener_g = 0.0

    for ingredient, weight_g in items:
        sweet_g = 0.0
        # Check for any sugars
        for name in SUGAR_FIELDS:
            val = getattr(ingredient, f"{name}_pct", None)
            if val is not None and val > 0:
                sweet_g += float(val) * weight_g / 100.0

        # Fallback is value-based (total sugar when nothing summed), unlike the
        # presence-based trigger in sugar_contributions_per_100g() (models.py),
        # which PAC/POD use. On an all-zero breakdown these disagree: this path
        # applies total_sugar as sucrose, PAC/POD do not. Pre-existing divergence;
        # keep in sync if consolidating the fallback decision.
        if sweet_g <= 0 and ingredient.total_sugar_pct:
            sweet_g = float(ingredient.total_sugar_pct) * weight_g / 100.0

        if sweet_g > 0:
            breakdown.append(
                SweetenerBreakdownItem(
                    ingredient_name=ingredient.name,
                    weight_g=round(sweet_g, 2),
                    pct_of_sweeteners=0.0,  # filled below
                )
            )
            total_sweetener_g += sweet_g

    # Compute percentages
    for item in breakdown:
        if total_sweetener_g > 0:
            item.pct_of_sweeteners = round(item.weight_g / total_sweetener_g * 100.0, 1)

    return SweetnessResult(
        pod=round(pod, 2),
        sweetener_breakdown=breakdown,
    )


def calculate_nutrition(
    items: list[tuple[Ingredient, float]],
    serving_size_g: float = settings.serving_size_g,
) -> NutritionResult:
    total_weight = sum(w for _, w in items)

    nutrient_fields = {
        "energy_kj": "energy_kj_per_100g",
        "total_fat_g": "total_fat_pct",
        "saturated_fat_g": "saturated_fat_pct",
        "trans_fat_g": "trans_fat_pct",
        "carbohydrate_g": "carbohydrate_pct",
        "sugars_g": "total_sugar_pct",
        "fiber_g": "fiber_pct",
        "protein_g": "protein_pct",
    }

    per_100g: dict[str, float] = {}
    for label, attr in nutrient_fields.items():
        per_100g[label] = round(_weighted_pct(items, attr, total_weight), 2)

    # Per serving
    per_serving: dict[str, float] = {}
    for label, val in per_100g.items():
        per_serving[label] = round(val * serving_size_g / 100.0, 2)

    return NutritionResult(
        per_100g=per_100g,
        per_serving=per_serving,
        serving_size_g=serving_size_g,
    )


def pac_mix_for_serving_temp(
    serving_temp_c: float, msnf_pct: float, water_pct: float
) -> float | None:
    """PAC (per 100 g mix) at which this mix reaches 75% frozen water at serving_temp_c.

    Inverts calculate_freezing's serving-temperature rule for the recipe's own
    water and MSNF, so a profile's serving-temperature range can be shown as a
    PAC range. Serving temperature falls monotonically as PAC rises.
    """
    if water_pct <= 0 or serving_temp_c >= 0:
        return None
    target_fpd = -serving_temp_c
    if fpd_at_frozen_pct(75.0, 0.0, msnf_pct, water_pct) >= target_fpd:
        return 0.0  # MSNF alone already gets there
    lo, hi = 0.0, 1000.0
    for _ in range(50):
        mid = (lo + hi) / 2.0
        if fpd_at_frozen_pct(75.0, mid, msnf_pct, water_pct) < target_fpd:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2.0 * water_pct / 100.0, 1)


def pac_water_for_frozen_pct(
    temp_c: float, frozen_pct: float, msnf_pct: float, water_pct: float
) -> float:
    """PAC per 100 g water at which this mix is frozen_pct frozen at temp_c.
    More PAC means less frozen, so this is a simple bisection."""
    target = frozen_pct / 100.0
    # frozen_water_fraction treats exactly zero PAC as "no data", so start just above it.
    lo, hi = 1e-6, 1000.0
    if frozen_water_fraction(temp_c, lo, msnf_pct, water_pct) <= target:
        return 0.0
    for _ in range(50):
        mid = (lo + hi) / 2.0
        if frozen_water_fraction(temp_c, mid, msnf_pct, water_pct) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def compare_to_target(
    composition: CompositionResult,
    sweetness: SweetnessResult,
    freezing: FreezingResult,
    profile: TargetProfile,
    pac: PACResult | None = None,
    serving: ServingTarget | None = None,
) -> list[MetricComparison]:
    """Compare calculated metrics against target profile ranges.

    Freezing behaviour is judged by PAC (and the equivalent serving
    temperature) rather than by grams of sugar, so recipes built on allulose,
    erythritol or other non-sugar sweeteners are assessed fairly.

    With a serving target, the freezing ranges come from it instead of the
    profile: PAC and the 75%-frozen temperature that put this mix within the
    target frozen percentage at the eating temperature, plus that percentage
    itself ("frozen_pct").
    """
    checks: list[tuple[str, float, float | None, float | None]] = []
    water, msnf = composition.water_pct, composition.msnf_pct
    if serving is not None and pac is not None and water > 0:
        softest = pac_water_for_frozen_pct(
            serving.eating_temp_c, serving.frozen_pct_min, msnf, water
        )
        firmest = pac_water_for_frozen_pct(
            serving.eating_temp_c, serving.frozen_pct_max, msnf, water
        )

        def t75(pac_water: float) -> float:
            return -round(fpd_at_frozen_pct(75.0, pac_water, msnf, water), 2)

        temp_min, temp_max = t75(softest), t75(firmest)
        checks.append(
            (
                "pac",
                pac.pac_mix,
                round(firmest * water / 100.0, 1),
                round(softest * water / 100.0, 1),
            )
        )
        checks.append(
            (
                "frozen_pct",
                100.0
                * frozen_water_fraction(
                    serving.eating_temp_c, pac.pac_water or 0.0, msnf, water
                ),
                serving.frozen_pct_min,
                serving.frozen_pct_max,
            )
        )
    else:
        temp_min = _f(profile.serving_temp_min)
        temp_max = _f(profile.serving_temp_max)
    if pac is not None and serving is None:
        # Colder serving temperature needs more PAC, so the bounds swap.
        checks.append(
            (
                "pac",
                pac.pac_mix,
                pac_mix_for_serving_temp(
                    temp_max, composition.msnf_pct, composition.water_pct
                )
                if temp_max is not None
                else None,
                pac_mix_for_serving_temp(
                    temp_min, composition.msnf_pct, composition.water_pct
                )
                if temp_min is not None
                else None,
            )
        )
    checks += [
        (
            "total_solids",
            composition.total_solids_pct,
            _f(profile.total_solids_min),
            _f(profile.total_solids_max),
        ),
        (
            "total_fat",
            composition.total_fat_pct,
            _f(profile.total_fat_min),
            _f(profile.total_fat_max),
        ),
        ("milk_fat", composition.milk_fat_pct, None, _f(profile.milk_fat_max)),
        ("msnf", composition.msnf_pct, None, _f(profile.msnf_max)),
        (
            "stabilizer",
            composition.stabilizer_pct,
            _f(profile.stabilizer_min),
            _f(profile.stabilizer_max),
        ),
        (
            "emulsifier",
            composition.emulsifier_pct,
            _f(profile.emulsifier_min),
            _f(profile.emulsifier_max),
        ),
    ]
    # Protein is only judged by profiles that set a range (e.g. high-protein bases).
    if profile.protein_min is not None or profile.protein_max is not None:
        checks.append(
            (
                "protein",
                composition.protein_pct,
                _f(profile.protein_min),
                _f(profile.protein_max),
            )
        )
    checks += [
        (
            "sweetness",
            sweetness.pod,
            _f(profile.sweetness_min),
            _f(profile.sweetness_max),
        ),
        (
            "serving_temp",
            freezing.serving_temperature_c
            if freezing.serving_temperature_c is not None
            else 0.0,
            temp_min,
            temp_max,
        ),
    ]

    results: list[MetricComparison] = []
    for metric, value, tmin, tmax in checks:
        status = MetricStatus.in_range
        if tmin is not None and value < tmin:
            status = MetricStatus.below
        elif tmax is not None and value > tmax:
            status = MetricStatus.above
        results.append(
            MetricComparison(
                metric=metric,
                value=round(value, 2),
                target_min=tmin,
                target_max=tmax,
                status=status,
            )
        )
    return results


def _off_target(value: float, tmin: float | None, tmax: float | None) -> float:
    """How far off target: 0 at the centre of a range, 1 at its edge, 2 one
    half-range beyond. One-sided limits score 1 at the limit, scaled by a
    quarter of the limit. Mirrors the frontend's colour scale."""
    if tmin is not None and tmax is not None:
        half = max((tmax - tmin) / 2.0, 1e-6)
        return abs(value - (tmin + tmax) / 2.0) / half
    limit = tmin if tmin is not None else tmax
    if limit is None:
        return 0.0
    scale = max(abs(limit) * 0.25, 0.5)
    over = (tmin - value) if tmin is not None else (value - limit)
    return max(0.0, 1.0 + over / scale)


def profile_fit_penalty(comparisons: list[MetricComparison]) -> float:
    """Lower is a better fit. Being outside a range costs quadratically, so one
    badly-missed metric outweighs several near-misses; a small term prefers
    centred values. PAC counts half: composition decides the style, while the
    freezing target mostly reflects the machine. Serving temperature is the
    same judgement as PAC, as is frozen_pct, so both are skipped."""
    total = 0.0
    for c in comparisons:
        if c.metric in ("serving_temp", "frozen_pct"):
            continue
        s = _off_target(c.value, c.target_min, c.target_max)
        weight = 0.5 if c.metric == "pac" else 1.0
        total += weight * (max(0.0, s - 1.0) ** 2 + 0.1 * min(s, 1.0))
    return total


def suggest_profile(
    composition: CompositionResult,
    sweetness: SweetnessResult,
    freezing: FreezingResult,
    pac: PACResult,
    profiles: Sequence[TargetProfile],
    serving_method_id: str | None = None,
) -> tuple[TargetProfile, list[MetricComparison]] | None:
    """The profile this recipe fits best, with its comparisons. Each candidate
    is judged as it would be served: the given serving method, or else that
    profile's usual one. Ties go to the earlier profile."""
    best: tuple[float, TargetProfile, list[MetricComparison]] | None = None
    for profile in profiles:
        comparisons = compare_to_target(
            composition,
            sweetness,
            freezing,
            profile,
            pac,
            resolve_serving(serving_method_id, profile),
        )
        penalty = profile_fit_penalty(comparisons)
        if best is None or penalty < best[0] - 1e-9:
            best = (penalty, profile, comparisons)
    return (best[1], best[2]) if best else None


def _f(val: float | None) -> float | None:
    """Convert Numeric/Decimal to float safely."""
    return float(val) if val is not None else None


def resolve_serving_id(
    serving_method_id: str | None, profile: TargetProfile | None
) -> str | None:
    """The serving method in effect: the one chosen, else the profile's usual one."""
    if serving_method(serving_method_id) is not None:
        return serving_method_id
    if profile is not None and serving_method(profile.default_serving_method):
        return profile.default_serving_method
    return None


def resolve_serving(
    serving_method_id: str | None, profile: TargetProfile | None
) -> ServingTarget | None:
    method = serving_method(resolve_serving_id(serving_method_id, profile))
    return method.target if method else None


def calculate(
    items: list[tuple[Ingredient, float]],
    target_profile: TargetProfile | None = None,
    serving_size_g: float = settings.serving_size_g,
    candidate_profiles: Sequence[TargetProfile] | None = None,
    serving_method_id: str | None = None,
) -> CalculateResponse:
    """Run the full calculation pipeline.

    With no target_profile but some candidate_profiles, compares against the
    best-fitting candidate and reports it as suggested_profile_id. With no
    serving method, the profile's usual one is used and reported back.
    """
    composition = calculate_composition(items)
    pac = calculate_pac(items)
    freezing_result = calculate_freezing(pac, composition)
    sweetness = calculate_sweetness(items)
    nutrition = calculate_nutrition(items, serving_size_g)

    target_comparison = None
    suggested_profile_id = None
    judged_profile = target_profile
    if target_profile is not None:
        target_comparison = compare_to_target(
            composition,
            sweetness,
            freezing_result,
            target_profile,
            pac,
            resolve_serving(serving_method_id, target_profile),
        )
    elif candidate_profiles:
        suggestion = suggest_profile(
            composition,
            sweetness,
            freezing_result,
            pac,
            candidate_profiles,
            serving_method_id,
        )
        if suggestion is not None:
            judged_profile = suggestion[0]
            suggested_profile_id = suggestion[0].id
            target_comparison = suggestion[1]

    return CalculateResponse(
        composition=composition,
        pac=pac,
        freezing=freezing_result,
        sweetness=sweetness,
        nutrition=nutrition,
        target_comparison=target_comparison,
        suggested_profile_id=suggested_profile_id,
        serving_method=resolve_serving_id(serving_method_id, judged_profile),
    )
