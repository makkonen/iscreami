"""Stateless calculator endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from api.db import NOT_FOUND_RESPONSE, DbSession
from api.models import Ingredient, TargetProfile
from api.schemas import (
    BalancedIngredient,
    BalanceRequest,
    BalanceResponse,
    CalculateRequest,
    CalculateResponse,
    ServingMethodOut,
)
from api.services.balancer import BalanceError, BalanceRow, balance
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


@router.post("/balance", response_model=BalanceResponse, responses=NOT_FOUND_RESPONSE)
def balance_recipe(data: BalanceRequest, db: DbSession):
    """Adjust the unlocked mix weights to bring the recipe into its targets."""
    ids = {i.ingredient_id for i in data.ingredients}
    found = {
        ing.id: ing
        for ing in db.scalars(select(Ingredient).where(Ingredient.id.in_(ids))).all()
    }
    missing = ids - found.keys()
    if missing:
        raise HTTPException(404, f"Ingredient {next(iter(missing))} not found")

    mix = [i for i in data.ingredients if not i.is_addin]
    addins = [
        (found[i.ingredient_id], i.weight_grams) for i in data.ingredients if i.is_addin
    ]
    if not any(i.weight_grams > 0 for i in mix):
        raise HTTPException(400, "Add some mix ingredients before balancing")

    if data.target_profile_id is not None:
        profile = db.get(TargetProfile, data.target_profile_id)
        if not profile:
            raise HTTPException(
                404, f"Target profile {data.target_profile_id} not found"
            )
    else:
        candidates = db.scalars(
            select(TargetProfile).order_by(TargetProfile.name)
        ).all()
        current = calculate(
            [
                (found[i.ingredient_id], i.weight_grams)
                for i in mix
                if i.weight_grams > 0
            ],
            candidate_profiles=candidates,
            serving_method_id=data.serving_method,
        )
        profile = next(
            (p for p in candidates if p.id == current.suggested_profile_id), None
        )
        if profile is None:
            raise HTTPException(400, "No target profile to balance against")

    rows = [BalanceRow(found[i.ingredient_id], i.weight_grams, i.locked) for i in mix]
    try:
        balanced = balance(
            rows, profile, data.serving_method, data.goal, data.allow_big_changes
        )
    except BalanceError as e:
        raise HTTPException(422, str(e)) from e

    new_weights = iter(balanced.weights)
    out = [
        BalancedIngredient(
            ingredient_id=i.ingredient_id,
            is_addin=i.is_addin,
            weight_grams=i.weight_grams if i.is_addin else next(new_weights),
        )
        for i in data.ingredients
    ]
    result = calculate(
        [
            (found[o.ingredient_id], o.weight_grams)
            for o in out
            if not o.is_addin and o.weight_grams > 0
        ],
        target_profile=profile,
        serving_method_id=data.serving_method,
        addins=addins,
    )
    return BalanceResponse(
        profile_id=profile.id, ingredients=out, unmet=balanced.unmet, result=result
    )
