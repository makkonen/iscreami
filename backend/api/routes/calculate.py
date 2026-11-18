"""Stateless calculator endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from api.db import NOT_FOUND_RESPONSE, DbSession
from api.models import Ingredient, TargetProfile
from api.schemas import CalculateRequest, CalculateResponse, ServingMethodOut
from api.services.calculator import calculate
from api.services.serving import SERVING_METHODS

router = APIRouter(tags=["calculator"])


@router.post(
    "/calculate", response_model=CalculateResponse, responses=NOT_FOUND_RESPONSE
)
def calculate_recipe(data: CalculateRequest, db: DbSession):
    """Calculate all metrics for a set of ingredients and weights."""
    # Load ingredients from DB
    ingredient_ids = [i.ingredient_id for i in data.ingredients]

    rows = db.scalars(select(Ingredient).where(Ingredient.id.in_(ingredient_ids))).all()
    ingredients_by_id = {ing.id: ing for ing in rows}

    for ing_id in ingredient_ids:
        if ing_id not in ingredients_by_id:
            raise HTTPException(404, f"Ingredient {ing_id} not found")

    items = [
        (ingredients_by_id[i.ingredient_id], i.weight_grams)
        for i in data.ingredients
        if not i.is_addin
    ]
    addins = [
        (ingredients_by_id[i.ingredient_id], i.weight_grams)
        for i in data.ingredients
        if i.is_addin
    ]

    target_profile = None
    if data.target_profile_id is not None:
        target_profile = db.get(TargetProfile, data.target_profile_id)
        if not target_profile:
            raise HTTPException(
                404, f"Target profile {data.target_profile_id} not found"
            )

    candidates = None
    if target_profile is None and data.suggest_profile:
        candidates = db.scalars(
            select(TargetProfile).order_by(TargetProfile.name)
        ).all()

    return calculate(
        items=items,
        target_profile=target_profile,
        serving_size_g=data.serving_size_g,
        candidate_profiles=candidates,
        serving_method_id=data.serving_method,
        addins=addins,
    )


@router.get("/serving-methods", response_model=list[ServingMethodOut])
def list_serving_methods():
    """How a recipe can be served; each sets an eating temperature and firmness."""
    return [
        ServingMethodOut(
            id=m.id,
            label=m.label,
            group=m.group,
            description=m.description,
            eating_temp_c=m.target.eating_temp_c,
            frozen_pct_min=m.target.frozen_pct_min,
            frozen_pct_max=m.target.frozen_pct_max,
        )
        for m in SERVING_METHODS
    ]
