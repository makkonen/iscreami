"""Paprika recipe export: a .paprikarecipe file is gzipped JSON in Paprika's own format."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import uuid
from typing import TYPE_CHECKING

from api.services.calculator import calculate_nutrition

if TYPE_CHECKING:
    from api.models import Recipe

# Paprika matches recipes by uid, so re-importing the same recipe updates it.
_UID_NAMESPACE = uuid.UUID("0f6d1c64-6b8a-4c55-9a43-7f9e0c1f2b37")
KJ_PER_KCAL = 4.184


def _grams(g: float) -> str:
    if g < 3:
        return f"{g:.2f}".rstrip("0").rstrip(".")
    if g < 10:
        return f"{g:.1f}".rstrip("0").rstrip(".")
    return f"{g:.0f}"


def _nutrition_text(recipe: Recipe) -> str:
    items = [(ri.ingredient, float(ri.weight_grams)) for ri in recipe.ingredients]
    if not items:
        return ""
    n = calculate_nutrition(items).per_100g
    return "\n".join(
        [
            "Per 100 g:",
            f"Calories: {n['energy_kj'] / KJ_PER_KCAL:.0f} kcal ({n['energy_kj']:.0f} kJ)",
            f"Fat: {n['total_fat_g']:.1f} g (saturated {n['saturated_fat_g']:.1f} g)",
            f"Carbohydrates: {n['carbohydrate_g']:.1f} g (sugars {n['sugars_g']:.1f} g, fiber {n['fiber_g']:.1f} g)",
            f"Protein: {n['protein_g']:.1f} g",
        ]
    )


def paprika_recipe(recipe: Recipe) -> dict:
    """The recipe in Paprika's JSON format."""
    mix = [ri for ri in recipe.ingredients if not ri.is_addin]
    addins = [ri for ri in recipe.ingredients if ri.is_addin]
    lines = [f"{_grams(float(ri.weight_grams))} g {ri.ingredient.name}" for ri in mix]
    if addins:
        lines += ["", "Add-ins (fold in after freezing):"]
        lines += [
            f"{_grams(float(ri.weight_grams))} g {ri.ingredient.name}" for ri in addins
        ]
    total = sum(float(ri.weight_grams) for ri in recipe.ingredients)
    rec = {
        "uid": str(uuid.uuid5(_UID_NAMESPACE, f"iscreami:{recipe.id}")).upper(),
        "name": recipe.name,
        "ingredients": "\n".join(lines),
        "directions": recipe.instructions or "",
        "notes": recipe.description or "",
        "nutritional_info": _nutrition_text(recipe),
        "description": "",
        "servings": f"{total:.0f} g" if total else "",
        "prep_time": "",
        "cook_time": "",
        "total_time": "",
        "difficulty": "",
        "source": "iscreami",
        "source_url": recipe.source_url or "",
        "image_url": None,
        "photo": None,
        "photo_hash": None,
        "photo_large": None,
        "photo_data": None,
        "photos": [],
        # Paprika rates in whole stars; halves round up.
        "rating": int(float(recipe.rating) + 0.5) if recipe.rating is not None else 0,
        "categories": ["Ice Cream", *(recipe.tags or [])],
        "created": recipe.created_at.strftime("%Y-%m-%d %H:%M:%S")
        if recipe.created_at
        else "",
        "on_favorites": False,
    }
    rec["hash"] = (
        hashlib.sha256(json.dumps(rec, sort_keys=True).encode()).hexdigest().upper()
    )
    return rec


def paprika_file(recipe: Recipe) -> bytes:
    """A .paprikarecipe file: the recipe's Paprika JSON, gzipped."""
    return gzip.compress(
        json.dumps(paprika_recipe(recipe), ensure_ascii=False).encode("utf-8")
    )


def paprika_filename(recipe: Recipe) -> str:
    safe = re.sub(r"[^\w\- ]+", "", recipe.name).strip() or "recipe"
    return f"{safe}.paprikarecipe"
