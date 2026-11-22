"""Ingredient CRUD routes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import joinedload, selectinload

from api.db import NOT_FOUND_RESPONSE, DbSession, apply_updates, commit_or_conflict
from api.models import Ingredient, IngredientAlias, IngredientCategory
from api.schemas import (
    IngredientCategoryOut,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    PaginatedIngredients,
)

router = APIRouter(prefix="/ingredients", tags=["ingredients"])

# Eager-load the relationships every ingredient endpoint needs. Shared so the
# query options can't drift between list/get/update endpoints.
_INGREDIENT_LOAD_OPTIONS = (
    joinedload(Ingredient.category),
    selectinload(Ingredient.aliases),
)


# Sources imported in bulk from food databases.
BULK_SOURCES = ("usda", "nzfcdb")


@router.get("", response_model=PaginatedIngredients)
def list_ingredients(
    db: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    category_id: int | None = None,
    source: str | None = None,
    # Leave out bulk imports (USDA, NZFCDB): just your own and the built-in ones.
    exclude_bulk: bool = False,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    stmt = select(Ingredient).options(*_INGREDIENT_LOAD_OPTIONS)

    if q:
        alias_subq = select(IngredientAlias.ingredient_id).where(
            IngredientAlias.alias.ilike(f"%{q}%")
        )
        stmt = stmt.where(
            or_(Ingredient.name.ilike(f"%{q}%"), Ingredient.id.in_(alias_subq))
        )
        # Relevance scoring: exact prefix > word boundary > substring match
        # Then sort by name length (shorter is better) and alphabetically
        relevance_score = case(
            (Ingredient.name.ilike(f"{q}%"), 3),  # Starts with query
            (Ingredient.name.ilike(f"% {q}%"), 2),  # Word boundary
            else_=1,  # Substring match
        )
        # Bulk imports (USDA, NZFCDB) run to thousands of entries; matches from
        # your own and the built-in ingredients come first.
        source_rank = case(
            (Ingredient.source.in_(BULK_SOURCES), 2),
            (Ingredient.source == "seed", 1),
            else_=0,
        )
        stmt = stmt.order_by(
            source_rank,
            relevance_score.desc(),
            func.length(Ingredient.name).asc(),
            Ingredient.name,
        )
    else:
        stmt = stmt.order_by(Ingredient.name)

    if category_id is not None:
        stmt = stmt.where(Ingredient.category_id == category_id)
    if source is not None:
        stmt = stmt.where(Ingredient.source == source)
    if exclude_bulk:
        stmt = stmt.where(Ingredient.source.not_in(BULK_SOURCES))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0

    stmt = stmt.offset(offset).limit(limit)
    items = list(db.scalars(stmt).unique().all())

    return PaginatedIngredients(total=total, items=items)  # type: ignore[arg-type]


@router.get(
    "/{ingredient_id}", response_model=IngredientOut, responses=NOT_FOUND_RESPONSE
)
def get_ingredient(ingredient_id: uuid.UUID, db: DbSession):
    ingredient = db.get(
        Ingredient,
        ingredient_id,
        options=_INGREDIENT_LOAD_OPTIONS,
    )
    if not ingredient:
        raise HTTPException(404, "Ingredient not found")
    return ingredient


@router.post("", response_model=IngredientOut, status_code=201)
def create_ingredient(data: IngredientCreate, db: DbSession):
    payload = data.model_dump()
    alias_names: list[str] = payload.pop("aliases", [])
    ingredient = Ingredient(**payload)
    ingredient.aliases = [IngredientAlias(alias=a) for a in alias_names]
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient, attribute_names=["category", "aliases"])
    return ingredient


def _sync_aliases(ingredient: Ingredient, names: list[str]) -> None:
    """Make the ingredient's aliases match names, keeping the rows that stay.

    Replacing the whole list would insert the new rows before deleting the
    old ones, so saving an unchanged alias broke the unique constraint.
    """
    wanted = list(dict.fromkeys(names))
    ingredient.aliases = [a for a in ingredient.aliases if a.alias in wanted]
    have = {a.alias for a in ingredient.aliases}
    ingredient.aliases.extend(IngredientAlias(alias=n) for n in wanted if n not in have)


@router.put(
    "/{ingredient_id}", response_model=IngredientOut, responses=NOT_FOUND_RESPONSE
)
def update_ingredient(ingredient_id: uuid.UUID, data: IngredientUpdate, db: DbSession):
    ingredient = db.get(
        Ingredient,
        ingredient_id,
        options=_INGREDIENT_LOAD_OPTIONS,
    )
    if not ingredient:
        raise HTTPException(404, "Ingredient not found")

    payload = data.model_dump(exclude_unset=True)
    alias_names: list[str] | None = payload.pop("aliases", None)

    apply_updates(ingredient, payload)

    if alias_names is not None:
        _sync_aliases(ingredient, alias_names)

    db.commit()
    db.refresh(ingredient, attribute_names=["category", "aliases"])
    return ingredient


@router.delete("/{ingredient_id}", status_code=204, responses=NOT_FOUND_RESPONSE)
def delete_ingredient(ingredient_id: uuid.UUID, db: DbSession):
    ingredient = db.get(Ingredient, ingredient_id)
    if not ingredient:
        raise HTTPException(404, "Ingredient not found")
    db.delete(ingredient)
    commit_or_conflict(
        db, "Ingredient is used in one or more recipes and cannot be deleted"
    )


# --- Categories ---

cat_router = APIRouter(prefix="/ingredient-categories", tags=["ingredients"])


@cat_router.get("", response_model=list[IngredientCategoryOut])
def list_categories(db: DbSession):
    return db.scalars(
        select(IngredientCategory).order_by(IngredientCategory.name)
    ).all()
