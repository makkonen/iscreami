"""Tests for the calculator orchestration layer and sub-calculator functions."""

from __future__ import annotations

import uuid

import pytest

from api.schemas import (
    CompositionResult,
    FreezingResult,
    MetricComparison,
    MetricStatus,
    PACResult,
    SweetnessResult,
)
from api.services.calculator import (
    calculate,
    calculate_freezing,
    calculate_nutrition,
    calculate_pac,
    calculate_sweetness,
    compare_to_target,
    pac_mix_for_serving_temp,
    pac_water_for_frozen_pct,
    profile_fit_penalty,
    suggest_profile,
)
from api.services.freezing import frozen_water_fraction
from api.services.serving import ServingTarget
from api.settings import settings
from tests.conftest import make_ingredient, make_profile


def _make_composition(**kwargs):
    defaults = {
        "total_weight_g": 1000.0,
        "water_pct": 60.0,
        "total_solids_pct": 40.0,
        "total_fat_pct": 10.0,
        "saturated_fat_pct": 6.0,
        "trans_fat_pct": 0.0,
        "milk_fat_pct": 10.0,
        "msnf_pct": 9.0,
        "total_sugar_pct": 15.0,
        "protein_pct": 3.0,
        "carbohydrate_pct": 20.0,
        "fiber_pct": 0.0,
        "alcohol_pct": 0.0,
        "stabilizer_pct": 0.3,
        "emulsifier_pct": 0.2,
    }
    defaults.update(kwargs)
    # Ordinary milk solids unless a test says otherwise.
    defaults.setdefault("msnf_for_freezing_pct", defaults["msnf_pct"])
    return CompositionResult(**defaults)


def _make_sweetness(pod=18.0):
    return SweetnessResult(pod=pod, sweetener_breakdown=[])


def _make_freezing(serving_temp: float | None = -12.0):
    return FreezingResult(
        freezing_point_c=-2.5,
        serving_temperature_c=serving_temp,
        curve=[],
    )


class TestCalculatePAC:
    def test_returns_pac_result_schema(self):

        sugar = make_ingredient(sucrose_pct=100.0, water_pct=0.0)
        result = calculate_pac([(sugar, 100.0)])  # type: ignore[arg-type]
        assert isinstance(result, PACResult)
        assert result.pac_mix > 0

    def test_no_water_pac_water_is_none(self):

        fat = make_ingredient(total_fat_pct=100.0)
        result = calculate_pac([(fat, 100.0)])  # type: ignore[arg-type]
        assert result.pac_water is None

    def test_values_are_rounded(self):

        sugar = make_ingredient(sucrose_pct=99.8, water_pct=0.03)
        water = make_ingredient(water_pct=100.0)
        result = calculate_pac([(sugar, 200.0), (water, 800.0)])  # type: ignore[arg-type]
        # Values should be rounded to 2 decimal places
        assert result.pac_mix == round(result.pac_mix, 2)


class TestCalculateFreezing:
    def test_zero_pac_gives_zero_freezing_point(self):

        comp = _make_composition(water_pct=60.0, total_solids_pct=40.0)
        result = calculate_freezing(PACResult(pac_mix=0.0, pac_water=0.0), comp)
        assert result.freezing_point_c == pytest.approx(0.0)
        assert result.serving_temperature_c is None

    def test_none_pac_water_gives_zero_freezing_point(self):

        comp = _make_composition()
        result = calculate_freezing(PACResult(pac_mix=5.0, pac_water=None), comp)
        assert result.freezing_point_c == pytest.approx(0.0)
        assert result.serving_temperature_c is None

    def test_positive_pac_gives_negative_freezing_point(self):

        comp = _make_composition(water_pct=80.0)
        result = calculate_freezing(PACResult(pac_mix=15.0, pac_water=25.0), comp)
        assert result.freezing_point_c < 0.0
        assert result.serving_temperature_c is not None
        assert result.serving_temperature_c < result.freezing_point_c

    def test_curve_is_populated(self):

        comp = _make_composition(water_pct=80.0)
        result = calculate_freezing(PACResult(pac_mix=15.0, pac_water=25.0), comp)
        assert len(result.curve) > 0


class TestCalculateSweetness:
    def test_breakdown_percentages_sum_to_100(self):

        a = make_ingredient(name="A", sucrose_pct=50.0)
        b = make_ingredient(name="B", sucrose_pct=50.0)
        result = calculate_sweetness([(a, 100.0), (b, 100.0)])  # type: ignore[arg-type]

        total_pct = sum(item.pct_of_sweeteners for item in result.sweetener_breakdown)
        assert total_pct == pytest.approx(100.0)

    def test_simple_mode_fallback_in_breakdown(self):

        ing = make_ingredient(name="Syrup", total_sugar_pct=80.0)
        result = calculate_sweetness([(ing, 100.0)])  # type: ignore[arg-type]

        assert len(result.sweetener_breakdown) == 1
        assert result.sweetener_breakdown[0].ingredient_name == "Syrup"
        assert result.sweetener_breakdown[0].weight_g == pytest.approx(80.0)

    def test_no_sweetener_gives_empty_breakdown(self):

        ing = make_ingredient(name="Cream", total_fat_pct=35.0)
        result = calculate_sweetness([(ing, 100.0)])  # type: ignore[arg-type]

        assert result.sweetener_breakdown == []
        assert result.pod == pytest.approx(0.0)

    def test_pod_value(self):

        ing = make_ingredient(name="Sugar", sucrose_pct=100.0)
        result = calculate_sweetness([(ing, 100.0)])  # type: ignore[arg-type]
        assert result.pod == pytest.approx(100.0)


class TestCalculateNutrition:
    def test_per_serving_scales_from_per_100g(self):

        ing = make_ingredient(energy_kj_per_100g=400.0)
        result = calculate_nutrition([(ing, 100.0)], serving_size_g=50.0)  # type: ignore[arg-type]

        assert result.per_100g["energy_kj"] == pytest.approx(400.0)
        assert result.per_serving["energy_kj"] == pytest.approx(200.0)
        assert result.serving_size_g == pytest.approx(50.0)

    def test_two_ingredients_weighted_correctly(self):

        a = make_ingredient(energy_kj_per_100g=100.0)
        b = make_ingredient(energy_kj_per_100g=0.0)
        result = calculate_nutrition([(a, 200.0), (b, 800.0)])  # type: ignore[arg-type]

        assert result.per_100g["energy_kj"] == pytest.approx(20.0)

    def test_none_nutrients_excluded_from_sum(self):

        a = make_ingredient(protein_pct=10.0)
        b = make_ingredient()
        result = calculate_nutrition([(a, 100.0), (b, 100.0)])  # type: ignore[arg-type]

        # 10g protein from 200g mix = 5g/100g
        assert result.per_100g["protein_g"] == pytest.approx(5.0)

    def test_all_nutrient_keys_present(self):

        ing = make_ingredient()
        result = calculate_nutrition([(ing, 100.0)])  # type: ignore[arg-type]

        expected_keys = {
            "energy_kj",
            "total_fat_g",
            "saturated_fat_g",
            "trans_fat_g",
            "carbohydrate_g",
            "sugars_g",
            "fiber_g",
            "protein_g",
        }
        assert expected_keys == set(result.per_100g.keys())
        assert expected_keys == set(result.per_serving.keys())

    def test_default_serving_size_is_66g(self):

        ing = make_ingredient(energy_kj_per_100g=200.0)
        result = calculate_nutrition([(ing, 100.0)])  # type: ignore[arg-type]
        assert result.serving_size_g == pytest.approx(settings.serving_size_g)
        assert result.per_serving["energy_kj"] == pytest.approx(
            200.0 * settings.serving_size_g / 100.0
        )


class TestCompareToTarget:
    def test_all_in_range(self):

        profile = make_profile(
            total_solids_min=35.0,
            total_solids_max=45.0,
            total_fat_min=8.0,
            total_fat_max=12.0,
        )
        results = compare_to_target(
            _make_composition(), _make_sweetness(), _make_freezing(), profile
        )  # type: ignore[arg-type]
        by_metric = {r.metric: r for r in results}
        assert by_metric["total_solids"].status == MetricStatus.in_range
        assert by_metric["total_fat"].status == MetricStatus.in_range

    def test_below_minimum(self):

        profile = make_profile(total_solids_min=50.0)
        results = compare_to_target(
            _make_composition(), _make_sweetness(), _make_freezing(), profile
        )  # type: ignore[arg-type]
        by_metric = {r.metric: r for r in results}
        assert by_metric["total_solids"].status == MetricStatus.below

    def test_above_maximum(self):

        profile = make_profile(total_fat_max=5.0)
        results = compare_to_target(
            _make_composition(), _make_sweetness(), _make_freezing(), profile
        )  # type: ignore[arg-type]
        by_metric = {r.metric: r for r in results}
        assert by_metric["total_fat"].status == MetricStatus.above

    def test_no_bounds_is_in_range(self):

        profile = make_profile()  # all None
        results = compare_to_target(
            _make_composition(), _make_sweetness(), _make_freezing(), profile
        )  # type: ignore[arg-type]
        for r in results:
            assert r.status == MetricStatus.in_range

    def test_all_metrics_present(self):

        profile = make_profile()
        results = compare_to_target(
            _make_composition(),
            _make_sweetness(),
            _make_freezing(),
            profile,  # type: ignore[arg-type]
            PACResult(pac_mix=25.0, pac_water=41.7),
        )
        metrics = {r.metric for r in results}
        assert metrics == {
            "pac",
            "total_solids",
            "total_fat",
            "milk_fat",
            "msnf",
            "stabilizer",
            "emulsifier",
            "sweetness",
            "serving_temp",
        }

    def test_protein_judged_only_when_profile_sets_it(self):
        plain = compare_to_target(
            _make_composition(), _make_sweetness(), _make_freezing(), make_profile()
        )  # type: ignore[arg-type]
        assert "protein" not in {r.metric for r in plain}

        profile = make_profile(protein_min=10.0, protein_max=16.0)
        results = compare_to_target(
            _make_composition(protein_pct=3.0),
            _make_sweetness(),
            _make_freezing(),
            profile,  # type: ignore[arg-type]
        )
        protein = next(r for r in results if r.metric == "protein")
        assert protein.status == MetricStatus.below
        assert protein.target_min == pytest.approx(10.0)

    def test_sugar_is_not_judged(self):
        # Freezing is judged by PAC; grams of sugar would penalise non-sugar sweeteners.
        profile = make_profile(sugar_min=14.0, sugar_max=18.0)
        results = compare_to_target(
            _make_composition(total_sugar_pct=2.0),
            _make_sweetness(),
            _make_freezing(),
            profile,  # type: ignore[arg-type]
        )
        assert "sugar" not in {r.metric for r in results}

    def test_pac_range_derived_from_serving_temp(self):
        profile = make_profile(serving_temp_min=-14.0, serving_temp_max=-11.0)
        results = compare_to_target(
            _make_composition(),
            _make_sweetness(),
            _make_freezing(),
            profile,  # type: ignore[arg-type]
            PACResult(pac_mix=25.0, pac_water=41.7),
        )
        pac = next(r for r in results if r.metric == "pac")
        # Warmer serving temperature (-11) needs less PAC than colder (-14).
        assert pac.target_min is not None and pac.target_max is not None
        assert 0 < pac.target_min < pac.target_max

    def test_pac_for_serving_temp_round_trips(self):
        comp = _make_composition(water_pct=62.0, msnf_pct=10.0)
        pac_mix = pac_mix_for_serving_temp(-13.0, comp.msnf_pct, comp.water_pct)
        assert pac_mix is not None
        freezing = calculate_freezing(
            PACResult(pac_mix=pac_mix, pac_water=pac_mix / comp.water_pct * 100), comp
        )
        assert freezing.serving_temperature_c == pytest.approx(-13.0, abs=0.05)

    def test_serving_temp_none_treated_as_zero(self):

        profile = make_profile(serving_temp_min=-5.0, serving_temp_max=5.0)
        results = compare_to_target(
            _make_composition(),
            _make_sweetness(),
            _make_freezing(serving_temp=None),
            profile,  # type: ignore[arg-type]
        )
        by_metric = {r.metric: r for r in results}
        assert by_metric["serving_temp"].value == pytest.approx(0.0)
        assert by_metric["serving_temp"].status == MetricStatus.in_range

    def test_metric_comparison_includes_value_and_bounds(self):

        profile = make_profile(total_fat_min=5.0, total_fat_max=15.0)
        results = compare_to_target(
            _make_composition(), _make_sweetness(), _make_freezing(), profile
        )  # type: ignore[arg-type]
        fat = next(r for r in results if r.metric == "total_fat")
        assert fat.target_min == pytest.approx(5.0)
        assert fat.target_max == pytest.approx(15.0)
        assert fat.value == pytest.approx(10.0)


class TestCalculate:
    def test_basic_calculation(self):

        sugar = make_ingredient(
            name="Sugar",
            sucrose_pct=99.8,
            water_pct=0.03,
            total_sugar_pct=99.8,
            carbohydrate_pct=99.98,
            energy_kj_per_100g=1619.2,
        )
        milk = make_ingredient(
            name="Whole Milk",
            water_pct=87.99,
            total_fat_pct=3.25,
            milk_fat_pct=3.25,
            msnf_pct=8.76,
            protein_pct=3.15,
            carbohydrate_pct=4.80,
            total_sugar_pct=5.05,
            lactose_pct=4.81,
            glucose_pct=0.07,
            sodium_mg=43.0,
            energy_kj_per_100g=255.2,
        )
        items = [(sugar, 150.0), (milk, 850.0)]
        result = calculate(items)  # type: ignore[arg-type]

        assert result.composition.total_weight_g == pytest.approx(1000.0)
        assert result.composition.total_solids_pct > 20
        assert result.pac.pac_mix > 10
        assert result.freezing.freezing_point_c < 0
        assert result.sweetness.pod > 10
        assert result.nutrition.per_100g["energy_kj"] > 0

    def test_with_target_profile(self):

        sugar = make_ingredient(
            name="Sugar", sucrose_pct=99.8, water_pct=0.03, total_sugar_pct=99.8
        )
        milk = make_ingredient(
            name="Milk",
            water_pct=87.99,
            lactose_pct=4.81,
            glucose_pct=0.07,
            sodium_mg=43.0,
        )
        profile = make_profile(total_solids_min=10.0, total_solids_max=50.0)

        result = calculate([(sugar, 150.0), (milk, 850.0)], target_profile=profile)  # type: ignore[arg-type]

        assert result.target_comparison is not None
        metrics = {c.metric for c in result.target_comparison}
        assert "total_solids" in metrics
        assert "sweetness" in metrics

    def test_no_target_profile_gives_none_comparison(self):

        ing = make_ingredient(name="Water", water_pct=100.0)
        result = calculate([(ing, 500.0)])  # type: ignore[arg-type]
        assert result.target_comparison is None

    def test_custom_serving_size(self):

        ing = make_ingredient(
            name="Sugar", sucrose_pct=100.0, energy_kj_per_100g=1600.0
        )
        result = calculate([(ing, 100.0)], serving_size_g=33.0)  # type: ignore[arg-type]
        assert result.nutrition.serving_size_g == pytest.approx(33.0)
        assert result.nutrition.per_serving["energy_kj"] == pytest.approx(528.0)


class TestSuggestProfile:
    def _profiles(self):
        ice_cream = make_profile(
            name="Ice cream",
            total_fat_min=10.0,
            total_fat_max=18.0,
            total_solids_min=36.0,
            total_solids_max=42.0,
        )
        high_protein = make_profile(
            name="High-protein",
            total_fat_min=0.0,
            total_fat_max=5.0,
            protein_min=10.0,
            protein_max=18.0,
        )
        return ice_cream, high_protein

    def test_picks_closest_composition(self):
        ice_cream, high_protein = self._profiles()
        lean = _make_composition(
            total_fat_pct=1.5, protein_pct=14.0, total_solids_pct=35.0
        )
        best, _ = suggest_profile(
            lean,
            _make_sweetness(),
            _make_freezing(),
            PACResult(pac_mix=21.0, pac_water=33.0),
            [ice_cream, high_protein],  # type: ignore[list-item]
        )
        assert best is high_protein

        rich = _make_composition(
            total_fat_pct=15.0, protein_pct=4.0, total_solids_pct=39.0
        )
        best, comparisons = suggest_profile(
            rich,
            _make_sweetness(),
            _make_freezing(),
            PACResult(pac_mix=25.0, pac_water=41.0),
            [ice_cream, high_protein],  # type: ignore[list-item]
        )
        assert best is ice_cream
        assert {c.metric for c in comparisons} >= {"total_fat", "total_solids"}

    def test_penalty_prefers_centred_and_punishes_misses(self):
        centred = [
            MetricComparison(
                metric="total_fat",
                value=12.0,
                target_min=10.0,
                target_max=14.0,
                status=MetricStatus.in_range,
            )
        ]
        edge = [
            MetricComparison(
                metric="total_fat",
                value=14.0,
                target_min=10.0,
                target_max=14.0,
                status=MetricStatus.in_range,
            )
        ]
        way_out = [
            MetricComparison(
                metric="total_fat",
                value=20.0,
                target_min=10.0,
                target_max=14.0,
                status=MetricStatus.above,
            )
        ]
        assert (
            profile_fit_penalty(centred)
            < profile_fit_penalty(edge)
            < profile_fit_penalty(way_out)
        )

    def test_explicit_profile_wins_over_suggestion(self):
        ice_cream, high_protein = self._profiles()
        sugar = make_ingredient(
            name="Sugar", sucrose_pct=99.8, water_pct=0.03, total_sugar_pct=99.8
        )
        milk = make_ingredient(
            name="Milk", water_pct=88.0, total_fat_pct=3.3, protein_pct=3.2
        )
        result = calculate(
            [(sugar, 150.0), (milk, 850.0)],  # type: ignore[list-item]
            target_profile=high_protein,
            candidate_profiles=[ice_cream, high_protein],  # type: ignore[list-item]
        )
        assert result.suggested_profile_id is None
        assert "protein" in {c.metric for c in result.target_comparison or []}


class TestServingTarget:
    PAC = PACResult(pac_mix=25.0, pac_water=41.7)

    def _compare(self, serving):
        return {
            r.metric: r
            for r in compare_to_target(
                _make_composition(),
                _make_sweetness(),
                _make_freezing(),
                make_profile(serving_temp_min=-14.0, serving_temp_max=-12.0),  # type: ignore[arg-type]
                self.PAC,
                serving,
            )
        }

    def test_scoopable_at_minus_12_matches_75pct_benchmark(self):
        # 70-78% frozen at -12 C straddles the classic "75% frozen at -12 C".
        r = self._compare(ServingTarget(-12.0, 70.0, 78.0))
        temp = r["serving_temp"]
        assert temp.target_min < -12.0 < temp.target_max
        assert r["frozen_pct"].target_min == 70.0

    def test_colder_or_softer_service_needs_more_pac(self):
        scoop = self._compare(ServingTarget(-12.0, 70.0, 78.0))["pac"]
        freezer = self._compare(ServingTarget(-18.0, 70.0, 78.0))["pac"]
        spun = self._compare(ServingTarget(-10.0, 52.0, 64.0))["pac"]
        assert freezer.target_min > scoop.target_max
        assert spun.target_min > scoop.target_min

    def test_frozen_pct_round_trips(self):
        comp = _make_composition()
        pw = pac_water_for_frozen_pct(-10.0, 60.0, comp.msnf_pct, comp.water_pct)
        r = self._compare(ServingTarget(-10.0, 50.0, 70.0))
        assert pw > 0
        assert r["frozen_pct"].value == pytest.approx(
            100 * frozen_water_fraction(-10.0, 41.7, comp.msnf_pct, comp.water_pct),
            abs=0.01,
        )


class TestServingResolution:
    def _items(self):
        sugar = make_ingredient(
            name="Sugar", sucrose_pct=99.8, water_pct=0.03, total_sugar_pct=99.8
        )
        milk = make_ingredient(
            name="Milk", water_pct=88.0, total_fat_pct=3.3, msnf_pct=8.8
        )
        return [(sugar, 150.0), (milk, 850.0)]

    def test_profile_usual_serving_applies_on_auto(self):
        profile = make_profile(default_serving_method="creami_lite")
        result = calculate(self._items(), target_profile=profile)  # type: ignore[arg-type]
        assert result.serving_method == "creami_lite"
        frozen = next(
            c for c in result.target_comparison or [] if c.metric == "frozen_pct"
        )
        assert (frozen.target_min, frozen.target_max) == (53.0, 67.0)

    def test_chosen_serving_overrides_profile(self):
        profile = make_profile(default_serving_method="creami_lite")
        result = calculate(
            self._items(), target_profile=profile, serving_method_id="popsicle"
        )  # type: ignore[arg-type]
        assert result.serving_method == "popsicle"

    def test_unknown_or_missing_serving_falls_back_to_profile_window(self):
        profile = make_profile(serving_temp_min=-14.0, serving_temp_max=-12.0)
        result = calculate(
            self._items(), target_profile=profile, serving_method_id="nope"
        )  # type: ignore[arg-type]
        assert result.serving_method is None
        assert "frozen_pct" not in {c.metric for c in result.target_comparison or []}

    def test_suggestion_reports_the_suggested_styles_serving(self):
        lean = make_profile(
            id=uuid.uuid4(),
            name="Lean",
            total_fat_max=5.0,
            default_serving_method="creami_lite",
        )
        rich = make_profile(
            id=uuid.uuid4(),
            name="Rich",
            total_fat_min=10.0,
            default_serving_method="tempered",
        )
        result = calculate(self._items(), candidate_profiles=[rich, lean])  # type: ignore[list-item]
        assert result.suggested_profile_id == lean.id
        assert result.serving_method == "creami_lite"


class TestAddins:
    def test_addins_count_for_nutrition_not_mix(self):
        sugar = make_ingredient(
            name="Sugar",
            sucrose_pct=99.8,
            water_pct=0.03,
            total_sugar_pct=99.8,
            energy_kj_per_100g=1619.0,
        )
        milk = make_ingredient(
            name="Milk", water_pct=88.0, total_fat_pct=3.3, energy_kj_per_100g=255.0
        )
        nuts = make_ingredient(
            name="Pecans", water_pct=3.5, total_fat_pct=72.0, energy_kj_per_100g=2889.0
        )
        base = [(sugar, 150.0), (milk, 850.0)]

        plain = calculate(base)  # type: ignore[arg-type]
        with_nuts = calculate(base, addins=[(nuts, 100.0)])  # type: ignore[list-item]

        # The mix is unchanged...
        assert with_nuts.composition == plain.composition
        assert with_nuts.pac == plain.pac
        assert with_nuts.sweetness.pod == plain.sweetness.pod
        # ...but nutrition includes the add-in.
        assert (
            with_nuts.nutrition.per_100g["total_fat_g"]
            > plain.nutrition.per_100g["total_fat_g"]
        )
        assert (
            with_nuts.nutrition.per_100g["energy_kj"]
            > plain.nutrition.per_100g["energy_kj"]
        )


class TestDairyMinimums:
    """Milk fat and MSNF minimums are judged, not just maximums."""

    def test_sherbet_needs_some_dairy(self):
        profile = make_profile(
            milk_fat_min=1.0, milk_fat_max=2.0, msnf_min=1.0, msnf_max=3.5
        )
        by_metric = {
            c.metric: c
            for c in compare_to_target(
                _make_composition(milk_fat_pct=0.0, msnf_pct=0.0),
                _make_sweetness(),
                _make_freezing(),
                profile,  # type: ignore[arg-type]
            )
        }
        assert (by_metric["milk_fat"].target_min, by_metric["milk_fat"].target_max) == (
            1.0,
            2.0,
        )
        assert by_metric["milk_fat"].status == MetricStatus.below
        assert by_metric["msnf"].status == MetricStatus.below


def test_no_profile_suggested_without_a_mix():
    """A recipe of add-ins only has nothing to fit a style to."""
    result = calculate([], candidate_profiles=[make_profile(name="Sorbet")])  # type: ignore[list-item]
    assert result.suggested_profile_id is None
