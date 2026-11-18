"""Tests for the recipe balancer."""

from __future__ import annotations

from decimal import Decimal

import pytest

from api.services.balancer import BalanceGoal, BalanceRow, balance
from tests.conftest import make_ingredient, make_profile


def cream():
    return make_ingredient(
        name="Cream",
        water_pct=58.0,
        total_fat_pct=36.0,
        milk_fat_pct=36.0,
        msnf_pct=5.5,
        protein_pct=2.0,
        lactose_pct=3.0,
        energy_kj_per_100g=1450.0,
    )


def milk():
    return make_ingredient(
        name="Milk",
        water_pct=88.0,
        total_fat_pct=3.3,
        milk_fat_pct=3.3,
        msnf_pct=8.7,
        protein_pct=3.3,
        lactose_pct=4.8,
        energy_kj_per_100g=270.0,
    )


def sugar():
    return make_ingredient(
        name="Sugar",
        water_pct=0.0,
        sucrose_pct=100.0,
        total_sugar_pct=100.0,
        energy_kj_per_100g=1650.0,
    )


def skim_powder():
    return make_ingredient(
        name="Skim milk powder",
        water_pct=3.0,
        msnf_pct=96.0,
        protein_pct=35.0,
        lactose_pct=50.0,
        energy_kj_per_100g=1500.0,
    )


def whey():
    return make_ingredient(
        name="Whey isolate",
        water_pct=5.0,
        protein_pct=90.0,
        energy_kj_per_100g=1550.0,
    )


def profile(**kw):
    ranges = dict(
        total_fat_min=10.0,
        total_fat_max=14.0,
        total_solids_min=36.0,
        total_solids_max=42.0,
        msnf_max=12.0,
        sweetness_min=14.0,
        sweetness_max=18.0,
    )
    ranges.update(kw)
    return make_profile(**ranges)


def rows(*pairs, locked=()):
    return [BalanceRow(ing, w, i in locked) for i, (ing, w) in enumerate(pairs)]


def by_metric(result):
    return {c.metric: c for c in result.result.target_comparison or []}


class TestBalance:
    def test_brings_an_out_of_range_mix_into_range_at_the_same_size(self):
        # Fat ~8.5% and solids ~28%: both low, but reachable within half-to-double.
        start = rows(
            (cream(), 200.0), (milk(), 700.0), (sugar(), 100.0), (skim_powder(), 20.0)
        )
        result = balance(start, profile(), keep_batch_size=True)

        assert result.unmet == []
        assert sum(result.weights) == pytest.approx(1020.0, abs=0.1)
        fat = by_metric(result)["total_fat"]
        assert 10.0 - 1e-6 <= fat.value <= 14.0 + 1e-6

    def test_locked_ingredients_keep_their_weight(self):
        start = rows((cream(), 100.0), (milk(), 800.0), (sugar(), 100.0), locked={1})
        result = balance(start, profile(total_solids_min=None, total_solids_max=None))
        assert result.weights[1] == pytest.approx(800.0)

    def test_typical_use_limits_stop_ingredients_moving_further_out(self):
        salt = make_ingredient(
            name="Salt", water_pct=0.0, sodium_mg=39340.0, usage_max_pct=0.3
        )
        # Salt starts well inside its cap and PAC is low, so salt (a strong PAC
        # source) is tempting, but it may only rise to 0.3% of the mix.
        start = rows((cream(), 300.0), (milk(), 550.0), (sugar(), 100.0), (salt, 1.0))
        brief = profile(serving_temp_min=-16.0, serving_temp_max=-14.0)
        result = balance(start, brief, allow_big_changes=True)
        assert result.weights[3] <= 0.003 * sum(result.weights) + 0.01

    def test_typical_use_limits_never_force_an_ingredient_back(self):
        # The recipe already uses more allulose than its cap; that's evidence it
        # works, so balancing must not cut it (it may even add more).
        allulose = make_ingredient(
            name="Allulose",
            water_pct=0.0,
            pac_override=190.0,
            pod_override=70.0,
            usage_max_pct=8.0,
        )
        start = rows((cream(), 300.0), (milk(), 600.0), (allulose, 100.0))
        result = balance(start, profile(sweetness_min=12.0))
        assert result.weights[2] >= 100.0 - 0.01

    def test_impossible_brief_returns_nearest_recipe_and_reports_unmet(self):
        # Milk and sugar alone can't reach 10% fat.
        start = rows((milk(), 850.0), (sugar(), 150.0))
        result = balance(start, profile(total_solids_min=None, total_solids_max=None))
        unmet = {c.metric for c in result.unmet}
        assert "total_fat" in unmet
        assert 850.0 - 0.1 <= sum(result.weights) <= 1150.0 + 0.1  # batch may move 15%

    def test_goals_steer_the_answer(self):
        start = rows(
            (cream(), 250.0), (milk(), 550.0), (sugar(), 150.0), (whey(), 30.0)
        )
        brief = profile(total_fat_min=6.0, protein_min=4.0, protein_max=12.0)
        lean = balance(start, brief, goal=BalanceGoal.min_kcal)
        rich = balance(start, brief, goal=BalanceGoal.closest)
        protein = balance(start, brief, goal=BalanceGoal.max_protein)

        def kcal(r):
            return r.result.nutrition.per_100g["energy_kj"]

        assert kcal(lean) <= kcal(rich) + 1e-6
        assert (
            by_metric(protein)["protein"].value
            >= by_metric(rich)["protein"].value - 1e-6
        )

    def test_fixed_limits_never_rule_out_the_starting_recipe(self):
        # Both gums ask for at least 60% of the mix; impossible together, but
        # limits always include where the recipe starts, so it still solves.
        gum = make_ingredient(
            name="Gum", water_pct=0.0, stabilizer_pct=100.0, usage_min_pct=60.0
        )
        other = make_ingredient(
            name="Other gum", water_pct=0.0, stabilizer_pct=100.0, usage_min_pct=60.0
        )
        result = balance(rows((gum, 10.0), (other, 10.0)), profile())
        assert sum(result.weights) == pytest.approx(20.0, abs=0.01)


def test_database_decimals_are_handled():
    # ORM rows carry Numeric columns as Decimal.
    dec_cream = make_ingredient(
        name="Cream",
        water_pct=Decimal("58"),
        total_fat_pct=Decimal("36"),
        milk_fat_pct=Decimal("36"),
        msnf_pct=Decimal("5.5"),
        energy_kj_per_100g=Decimal("1450"),
        usage_max_pct=Decimal("80"),
    )
    result = balance(
        rows((dec_cream, 300.0), (milk(), 600.0), (sugar(), 150.0)), profile()
    )
    assert 892.5 - 0.1 <= sum(result.weights) <= 1207.5 + 0.1  # batch may move 15%


def test_ingredients_stay_within_half_to_double_by_default():
    # Fat 10-14% can't be reached from this start without big changes.
    start = rows((cream(), 50.0), (milk(), 850.0), (sugar(), 150.0))
    brief = profile(
        total_solids_min=None,
        total_solids_max=None,
        sweetness_min=None,
        sweetness_max=None,
    )
    moderate = balance(start, brief)
    for before, after in zip((50.0, 850.0, 150.0), moderate.weights, strict=True):
        assert before * 0.5 - 0.01 <= after <= before * 2 + 0.01
    assert "total_fat" in {c.metric for c in moderate.unmet}

    free = balance(start, brief, allow_big_changes=True)
    assert free.unmet == []


def test_closest_fix_can_just_add_an_ingredient():
    # Slightly under on sweetness: the smallest fix is a little more sugar,
    # growing the batch, not trading other ingredients away.
    start = rows((cream(), 300.0), (milk(), 600.0), (sugar(), 120.0))
    brief = profile(
        total_solids_min=None,
        total_solids_max=None,
        sweetness_min=13.0,
        sweetness_max=20.0,
    )
    result = balance(start, brief)
    assert result.unmet == []
    assert result.weights[0] == pytest.approx(300.0, abs=0.01)
    assert result.weights[1] == pytest.approx(600.0, abs=0.01)
    assert result.weights[2] > 120.0
    # Aims a little inside the range rather than on its edge.
    assert by_metric(result)["sweetness"].value > 13.0 + 0.1


def test_unreachable_targets_do_not_distort_the_answer():
    # No ingredient here has any emulsifier, so its floor can't be met; that must
    # not push the batch around (it used to shrink it to make the gap look smaller).
    start = rows((cream(), 300.0), (milk(), 600.0), (sugar(), 120.0))
    brief = profile(
        total_solids_min=None,
        total_solids_max=None,
        sweetness_min=13.0,
        sweetness_max=20.0,
        emulsifier_min=0.1,
        emulsifier_max=0.4,
    )
    result = balance(start, brief)
    assert result.weights[0] == pytest.approx(300.0, abs=0.01)
    assert result.weights[1] == pytest.approx(600.0, abs=0.01)
    assert {c.metric for c in result.unmet} == {"emulsifier"}
