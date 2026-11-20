"""Tests for ingredient update routes."""

from __future__ import annotations

from api.routes.ingredients import create_ingredient, update_ingredient
from api.schemas import IngredientCreate, IngredientUpdate


def test_rename_keeps_unchanged_aliases(test_db):
    """Saving with the aliases it already has used to break their unique key."""
    ing = create_ingredient(
        IngredientCreate(
            name="Stabilizer blend", aliases=["4:2:1 stabilizer", "LBG blend"]
        ),
        test_db,
    )
    renamed = update_ingredient(
        ing.id,
        IngredientUpdate(name="Gum blend", aliases=["4:2:1 stabilizer", "LBG blend"]),
        test_db,
    )
    assert renamed.name == "Gum blend"
    assert sorted(a.alias for a in renamed.aliases) == ["4:2:1 stabilizer", "LBG blend"]

    changed = update_ingredient(
        ing.id,
        IngredientUpdate(aliases=["LBG blend", "house blend", "house blend"]),
        test_db,
    )
    assert sorted(a.alias for a in changed.aliases) == ["LBG blend", "house blend"]
