"""Tests for recipe API routes."""

from __future__ import annotations

import asyncio
import io
from unittest.mock import MagicMock

import pytest
from starlette.datastructures import UploadFile

from api.routes.recipes import import_recipes


class TestImportRecipes:
    """Tests for POST /recipes/import."""

    def test_none_size_rejected(self):
        """UploadFile with size=None should return 400.

        When UploadFile.size is None (possible with chunked transfer
        encoding or missing Content-Length header), the handler must
        reject the request before attempting to read the file.
        """
        file = UploadFile(
            file=io.BytesIO(b"{}"),
            size=None,
            filename="test.json",
        )
        db = MagicMock()

        with pytest.raises(Exception) as exc_info:
            asyncio.run(import_recipes(file=file, db=db))

        assert exc_info.value.status_code == 400  # type: ignore[union-attr]
        assert (
            "size could not be determined" in exc_info.value.detail.lower()  # type: ignore[union-attr]
        )


class TestRecipeParent:
    """Duplicates remember the recipe they were made from."""

    def test_create_with_parent(self, test_db):
        from api.routes.recipes import create_recipe
        from api.schemas import RecipeCreate
        from tests.conftest import make_recipe_orm

        parent = make_recipe_orm(test_db, name="Base")
        child = create_recipe(
            RecipeCreate(name="Base (copy)", parent_id=parent.id), test_db
        )
        assert child.parent_id == parent.id

    def test_missing_parent_rejected(self, test_db):
        import uuid

        from fastapi import HTTPException

        from api.routes.recipes import create_recipe
        from api.schemas import RecipeCreate

        with pytest.raises(HTTPException) as exc_info:
            create_recipe(RecipeCreate(name="Orphan", parent_id=uuid.uuid4()), test_db)
        assert exc_info.value.status_code == 400


class TestRecipeTags:
    """Tags are tidied on the way in and saved with the recipe."""

    def test_normalize_tags(self):
        from api.schemas import normalize_tags

        assert normalize_tags(
            [" Status / Testing ", "status/testing", "Base//Chocolate", "", " / "]
        ) == ["Base/Chocolate", "Status/Testing"]
        assert normalize_tags(None) is None

    def test_create_and_update_tags(self, test_db):
        from api.routes.recipes import create_recipe, update_recipe
        from api.schemas import RecipeCreate, RecipeUpdate

        recipe = create_recipe(
            RecipeCreate(name="Tagged", tags=["Protein", "Status/Testing"]), test_db
        )
        assert recipe.tags == ["Protein", "Status/Testing"]
        updated = update_recipe(
            recipe.id, RecipeUpdate(tags=["Status/Keeper"]), test_db
        )
        assert updated.tags == ["Status/Keeper"]
        assert updated.name == "Tagged"


class TestRecipeText:
    """Notes and instructions are separate and can be edited on their own."""

    def test_instructions_and_notes(self, test_db):
        from api.routes.recipes import create_recipe, update_recipe
        from api.schemas import RecipeCreate, RecipeUpdate

        recipe = create_recipe(
            RecipeCreate(name="Pistachio", description="Notes", instructions="Steep"),
            test_db,
        )
        assert (recipe.description, recipe.instructions) == ("Notes", "Steep")
        updated = update_recipe(
            recipe.id, RecipeUpdate(instructions="Steep overnight"), test_db
        )
        assert (updated.description, updated.instructions) == (
            "Notes",
            "Steep overnight",
        )


class TestRatings:
    """Ratings are 1-5 stars in half stars."""

    def test_half_stars_save(self, test_db):
        from api.routes.recipes import create_recipe, update_recipe
        from api.schemas import RecipeCreate, RecipeUpdate

        recipe = create_recipe(RecipeCreate(name="Rated", rating=3.5), test_db)
        assert float(recipe.rating) == 3.5
        cleared = update_recipe(recipe.id, RecipeUpdate(rating=None), test_db)
        assert cleared.rating is None

    def test_rejects_off_scale(self):
        from api.schemas import BatchUpdate, RecipeUpdate

        for bad in (0.5, 5.5, 3.2):
            with pytest.raises(ValueError):
                RecipeUpdate(rating=bad)
        with pytest.raises(ValueError):
            BatchUpdate(overall=4.25)
        assert BatchUpdate(overall=4.5).overall == 4.5
