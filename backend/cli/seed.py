"""Seed database with default categories, target profiles, and common ingredients."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import typer
from sqlalchemy import select

from api.db import SessionLocal
from api.models import Ingredient, IngredientAlias, IngredientCategory, TargetProfile

app = typer.Typer()

_INGREDIENTS_FILE = Path(__file__).parent / "seed-ingredients.json"
_PROFILE_NAMESPACE = uuid.UUID("6f2790bd-e765-4066-b9cf-38510df50c53")
_INGREDIENT_NAMESPACE = uuid.UUID("899fcfe0-50c6-48f3-9e55-b98b19a28f2b")

CATEGORIES = [
    ("dairy", "Dairy"),
    ("egg", "Egg"),
    ("sweetener", "Sweetener"),
    ("stabilizer", "Stabilizer"),
    ("emulsifier", "Emulsifier"),
    ("alcohol", "Alcohol"),
    ("fat_oil", "Fat & Oil"),
    ("fruit", "Fruit"),
    ("chocolate", "Chocolate"),
    ("flavoring", "Flavoring"),
    ("nuts-seeds", "Nuts & Seeds"),
    ("other", "Other"),
]


# Target profiles describe a style: what's in the mix, plus how that style is
# usually served (see api/services/serving.py). The serving method sets the
# freezing target; a recipe can pick its own, otherwise its profile's usual one
# applies. Defaults reflect a Creami user: regular ice cream is spun, hardened
# at -18 C and tempered before scooping, while lean low-fat and high-protein
# bases are eaten straight off a lite spin (they would be rock-hard at -18 C).
#
# Profiles describe what the calculator can measure. It can't tell yogurt from
# milk (cultures and acidity aren't modelled), so frozen yogurt is a low-fat
# mix by composition; tag recipes Style/Frozen yogurt to find them.
#
# Sherbet and sorbet follow the US standards: sherbet has 1-2% milk fat, at
# least 1% milk solids-not-fat and 2-5% total milk solids (21 CFR 135.140);
# water ice, the nearest standard to sorbet, has no milk or milk-derived
# ingredient at all (21 CFR 135.160).
#
# Sources: Goff & Hartel composition tables, including frozen yogurt (see
# docs/ref/reddit-guide.md); the Ninja Creami guidance there; US nutrition labels
# (e.g. Haagen-Dazs vanilla: 16% fat, 19% sugars; Halo Top vanilla: 2.4% fat,
# 5.9% protein); and mharlass/icecream-calculator's note that a shaved frozen
# puck tolerates lower fat and higher solids than churning.
#
# Stabilizer ranges are for the hydrocolloids themselves (LBG, guar,
# carrageenan, xanthan), as the stabilizer metric counts them. The 0.2-0.5%
# often quoted is for commercial stabilizer/emulsifier blends, which include
# emulsifier and usually a sugar carrier. Pure gums run lower: locust bean gum
# about 0.1-0.2% of the mix, carrageenan 0.01-0.05% alongside it. Sorbets and
# sherbets, with little protein or fat for body, take a little more; protein-
# rich mixes less.
#
# Emulsifier ranges are maximums only: none is fine, especially in a Creami,
# which doesn't whip in much air. Added emulsifiers run 0.1-0.3% of the mix in
# total (mono- and diglycerides 0.1-0.2%, polysorbate 80 just 0.02-0.04%).
# Egg yolk counts at its lecithin share, but is a weaker emulsifier and a
# custard's yolk can far exceed these without harm; like stabilizer, the
# emulsifier target is advisory and never counted as an issue.
#
# Sugar ranges are deliberately left unset: freezing is judged by PAC and
# sweetness by POD, which also covers non-sugar sweeteners. MSNF is uncapped
# for high-protein styles: the cap guards against lactose crystallising, and
# protein isolates carry little lactose.
def _profile(name: str, **ranges: float | str) -> dict:
    return {"id": uuid.uuid5(_PROFILE_NAMESPACE, name), "name": name, **ranges}


TARGET_PROFILES = [
    _profile(
        "Ice cream",
        default_serving_method="tempered",
        sweetness_min=12.0,
        sweetness_max=20.0,
        total_solids_min=36.0,
        total_solids_max=44.0,
        total_fat_min=10.0,
        total_fat_max=18.0,
        milk_fat_max=18.0,
        msnf_max=12.0,
        stabilizer_min=0.1,
        stabilizer_max=0.3,
        emulsifier_max=0.3,
    ),
    _profile(
        "Gelato",
        default_serving_method="tempered",
        sweetness_min=16.0,
        sweetness_max=22.0,
        total_solids_min=33.0,
        total_solids_max=44.0,
        total_fat_min=4.0,
        total_fat_max=10.0,
        milk_fat_max=10.0,
        msnf_max=12.0,
        stabilizer_min=0.1,
        stabilizer_max=0.3,
        emulsifier_max=0.3,
    ),
    _profile(
        # A dairy base with little fat; frozen yogurt by composition. The MSNF
        # floor keeps sherbets and sorbets out.
        "Low-fat",
        default_serving_method="creami_lite",
        sweetness_min=13.0,
        sweetness_max=20.0,
        total_solids_min=22.0,
        total_solids_max=34.0,
        total_fat_min=0.0,
        total_fat_max=6.0,
        milk_fat_max=6.0,
        msnf_min=6.0,
        msnf_max=14.0,
        stabilizer_min=0.1,
        stabilizer_max=0.35,
        emulsifier_max=0.3,
    ),
    _profile(
        "High-protein",
        default_serving_method="creami_lite",
        sweetness_min=13.0,
        sweetness_max=20.0,
        total_solids_min=28.0,
        total_solids_max=40.0,
        total_fat_min=0.0,
        total_fat_max=5.0,
        milk_fat_max=5.0,
        protein_min=8.0,
        protein_max=18.0,
        stabilizer_min=0.05,
        stabilizer_max=0.3,
        emulsifier_max=0.3,
    ),
    _profile(
        "Sherbet",
        default_serving_method="tempered",
        sweetness_min=20.0,
        sweetness_max=28.0,
        total_solids_min=26.0,
        total_solids_max=35.0,
        total_fat_min=1.0,
        total_fat_max=3.0,
        milk_fat_min=1.0,
        milk_fat_max=2.0,
        # With 1-2% milk fat, this keeps total milk solids near 2-5%.
        msnf_min=1.0,
        msnf_max=3.5,
        stabilizer_min=0.15,
        stabilizer_max=0.4,
        emulsifier_max=0.2,
    ),
    _profile(
        # Also covers ice pops: they're sorbet mixes frozen still and eaten hard,
        # so choose the Popsicle serving rather than a separate style. Water
        # ices run 22-32% solids and 20-23% sugar; sorbets 25-35% and 20-30%.
        "Sorbet",
        default_serving_method="tempered",
        sweetness_min=16.0,
        sweetness_max=30.0,
        total_solids_min=22.0,
        total_solids_max=34.0,
        total_fat_min=0.0,
        total_fat_max=2.0,
        # No dairy at all.
        milk_fat_max=0.0,
        msnf_max=0.0,
        stabilizer_min=0.15,
        stabilizer_max=0.45,
        emulsifier_max=0.1,
    ),
]


# Common ice cream ingredients with composition data
# Loaded from seed_ingredients.json — add new entries there, not here.
def _load_ingredients() -> list[dict]:
    return json.loads(_INGREDIENTS_FILE.read_text(encoding="utf-8"))


@app.command("all")
def seed_all() -> None:
    """Seed categories, target profiles, and common ingredients."""
    db = SessionLocal()
    try:
        _seed_categories(db)
        _seed_profiles(db)
        _seed_ingredients(db)
        db.commit()
        typer.echo("Seed complete.")
    finally:
        db.close()


@app.command("categories")
def seed_categories_cmd() -> None:
    """Seed ingredient categories only."""
    db = SessionLocal()
    try:
        _seed_categories(db)
        db.commit()
        typer.echo("Categories seeded.")
    finally:
        db.close()


def _seed_categories(db) -> None:
    for slug, name in CATEGORIES:
        exists = db.scalar(
            select(IngredientCategory).where(IngredientCategory.slug == slug)
        )
        if not exists:
            db.add(IngredientCategory(name=name, slug=slug))
            typer.echo(f"  + category: {name}")


def _seed_profiles(db) -> None:
    for profile_data in TARGET_PROFILES:
        exists = db.scalar(
            select(TargetProfile).where(TargetProfile.name == profile_data["name"])
        )
        if not exists:
            db.add(TargetProfile(**profile_data))
            typer.echo(f"  + profile: {profile_data['name']}")


def _seed_ingredients(db) -> None:
    # Build slug → id map
    categories = db.scalars(select(IngredientCategory)).all()
    slug_to_id = {c.slug: c.id for c in categories}

    for ing_data in _load_ingredients():
        source_id = ing_data["name"]
        exists = db.scalar(
            select(Ingredient).where(
                Ingredient.source == "seed",
                Ingredient.source_id == source_id,
            )
        )
        if exists:
            continue

        data = dict(ing_data)
        cat_slug = data.pop("category_slug", None)
        if cat_slug and cat_slug in slug_to_id:
            data["category_id"] = slug_to_id[cat_slug]
        data["source"] = "seed"
        data["source_id"] = source_id
        # Generate deterministic UUID based on source + source_id pattern
        data["id"] = uuid.uuid5(_INGREDIENT_NAMESPACE, f"seed:{source_id}")
        aliases = data.pop("aliases", [])

        ingredient = Ingredient(**data)
        ingredient.aliases = [IngredientAlias(alias=a) for a in aliases]
        db.add(ingredient)
        typer.echo(f"  + ingredient: {data['name']}")
