"""Milk salts: added salt counts in PAC; low-mineral milk solids count less in freezing."""

from __future__ import annotations

import pytest

from api.services.calculator import calculate_composition
from api.services.pac import ingredient_pac, msnf_for_freezing, salt_sodium_mg
from tests.conftest import make_ingredient


class TestMilkSalts:
    def test_milk_sodium_is_not_counted_twice(self):
        milk = make_ingredient(msnf_pct=8.7, sodium_mg=40.0, lactose_pct=4.8)
        assert salt_sodium_mg(milk) == pytest.approx(0.0)
        assert ingredient_pac(milk) == pytest.approx(4.8)
        assert msnf_for_freezing(milk) == pytest.approx(8.7, abs=0.01)

    def test_added_salt_counts_as_nacl(self):
        cottage = make_ingredient(msnf_pct=16.8, sodium_mg=345.0, lactose_pct=3.54)
        extra = 345.0 - 4.6 * 16.8
        assert salt_sodium_mg(cottage) == pytest.approx(extra)
        assert ingredient_pac(cottage) == pytest.approx(
            3.54 + extra / 1000 * 2.58 * 585 / 100
        )

    def test_egg_sodium_counts_in_full(self):
        egg_white = make_ingredient(sodium_mg=166.0, glucose_pct=0.71)
        assert salt_sodium_mg(egg_white) == pytest.approx(166.0)

    def test_whey_isolate_counts_by_its_milk_salts(self):
        wpi = make_ingredient(msnf_pct=91.0, sodium_mg=161.0, water_pct=5.0)
        assert msnf_for_freezing(wpi) == pytest.approx(161.0 / 4.6)
        comp = calculate_composition(
            [(wpi, 10.0), (make_ingredient(water_pct=100.0), 90.0)]
        )
        assert comp.msnf_pct == pytest.approx(9.1)
        assert comp.msnf_for_freezing_pct == pytest.approx(3.5, abs=0.01)

    def test_no_sodium_figure_means_ordinary_milk_solids(self):
        cream = make_ingredient(msnf_pct=5.8, sodium_mg=None)
        assert msnf_for_freezing(cream) == pytest.approx(5.8)
        assert msnf_for_freezing(make_ingredient(msnf_pct=5.8, sodium_mg=0.0)) == 5.8
