"""Tests for the batch log routes."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from api.routes.batches import create_batch, delete_batch, list_batches, update_batch
from api.schemas import BatchCreate, BatchSnapshot, BatchUpdate
from tests.conftest import make_ingredient_orm, make_recipe_orm


def _snapshot(ingredient) -> BatchSnapshot:
    return BatchSnapshot.model_validate(
        {
            "ingredients": [
                {
                    "ingredient_id": str(ingredient.id),
                    "name": ingredient.name,
                    "weight_grams": 120.5,
                }
            ],
            "metrics": {"pac": 24.1, "frozen_pct": None},
        }
    )


class TestBatches:
    def test_log_list_update_delete(self, test_db):
        milk = make_ingredient_orm(test_db, name="Milk")
        recipe = make_recipe_orm(test_db, ingredients=[(milk, 100.0, None)])

        older = create_batch(
            recipe.id,
            BatchCreate(made_on=date(2026, 11, 1), snapshot=_snapshot(milk)),
            test_db,
        )
        newer = create_batch(
            recipe.id,
            BatchCreate(
                made_on=date(2026, 11, 15),
                hardness=1,
                overall=4,
                notes="A touch firm",
                snapshot=_snapshot(milk),
            ),
            test_db,
        )
        assert newer.snapshot["ingredients"][0]["weight_grams"] == 120.5
        assert [b.id for b in list_batches(recipe.id, test_db)] == [newer.id, older.id]

        updated = update_batch(recipe.id, older.id, BatchUpdate(sweetness=-1), test_db)
        assert updated.sweetness == -1
        assert updated.made_on == date(2026, 11, 1)

        delete_batch(recipe.id, older.id, test_db)
        assert [b.id for b in list_batches(recipe.id, test_db)] == [newer.id]

    def test_batch_belongs_to_recipe(self, test_db):
        milk = make_ingredient_orm(test_db, name="Milk")
        a = make_recipe_orm(test_db, name="A")
        b = make_recipe_orm(test_db, name="B")
        batch = create_batch(
            a.id,
            BatchCreate(made_on=date(2026, 11, 1), snapshot=_snapshot(milk)),
            test_db,
        )
        with pytest.raises(HTTPException) as exc_info:
            delete_batch(b.id, batch.id, test_db)
        assert exc_info.value.status_code == 404

    def test_unknown_recipe(self, test_db):
        with pytest.raises(HTTPException) as exc_info:
            list_batches(uuid.uuid4(), test_db)
        assert exc_info.value.status_code == 404

    def test_rating_bounds(self):
        with pytest.raises(ValueError):
            BatchUpdate(hardness=3)
        with pytest.raises(ValueError):
            BatchUpdate(overall=0)
