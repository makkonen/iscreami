"""Tests for ingredient update routes."""

from __future__ import annotations

from api.models import Ingredient
from api.routes.ingredients import (
    create_ingredient,
    list_ingredients,
    update_ingredient,
)
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


def test_exclude_bulk_leaves_out_food_database_imports(test_db):
    for name, source in [
        ("Mine", "manual"),
        ("Built in", "seed"),
        ("Imported", "icc4"),
        ("USDA milk", "usda"),
        ("NZ milk", "nzfcdb"),
    ]:
        test_db.add(Ingredient(name=name, source=source))
    test_db.flush()
    page = list_ingredients(test_db, exclude_bulk=True, limit=200)
    assert sorted(i.name for i in page.items) == ["Built in", "Imported", "Mine"]
    assert page.total == 3
