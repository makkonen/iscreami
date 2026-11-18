"""Tests for the recipe balancer."""

from __future__ import annotations

from decimal import Decimal

import pytest

from api.services.balancer import BalanceError, BalanceGoal, BalanceRow, balance
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
        result = balance(start, profile())

        assert result.unmet == []
        assert sum(result.weights) == pytest.approx(1020.0, abs=0.1)
        fat = by_metric(result)["total_fat"]
        assert 10.0 - 1e-6 <= fat.value <= 14.0 + 1e-6

    def test_locked_ingredients_keep_their_weight(self):
        start = rows((cream(), 100.0), (milk(), 800.0), (sugar(), 100.0), locked={1})
        result = balance(start, profile(total_solids_min=None, total_solids_max=None))
        assert result.weights[1] == pytest.approx(800.0)

    def test_typical_use_limits_are_respected(self):
        salt = make_ingredient(
            name="Salt", water_pct=0.0, sodium_mg=39340.0, usage_max_pct=0.3
        )
        start = rows((cream(), 300.0), (milk(), 550.0), (sugar(), 150.0), (salt, 10.0))
        result = balance(start, profile())
        total = sum(result.weights)
        assert result.weights[3] <= 0.003 * total + 0.01

    def test_impossible_brief_returns_nearest_recipe_and_reports_unmet(self):
        # Milk and sugar alone can't reach 10% fat.
        start = rows((milk(), 850.0), (sugar(), 150.0))
        result = balance(start, profile(total_solids_min=None, total_solids_max=None))
        unmet = {c.metric for c in result.unmet}
        assert "total_fat" in unmet
        assert sum(result.weights) == pytest.approx(1000.0, abs=0.1)

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

    def test_conflicting_fixed_limits_raise(self):
        gum = make_ingredient(
            name="Gum", water_pct=0.0, stabilizer_pct=100.0, usage_min_pct=60.0
        )
        other = make_ingredient(
            name="Other gum", water_pct=0.0, stabilizer_pct=100.0, usage_min_pct=60.0
        )
        with pytest.raises(BalanceError):
            balance(rows((gum, 10.0), (other, 10.0)), profile())


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
    assert sum(result.weights) == pytest.approx(1050.0, abs=0.1)


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
