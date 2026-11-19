"""Batch log: each time a recipe was made, and how it turned out."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from api.db import NOT_FOUND_RESPONSE, DbSession, apply_updates
from api.models import Recipe, RecipeBatch
from api.schemas import BatchCreate, BatchOut, BatchUpdate

router = APIRouter(prefix="/recipes/{recipe_id}/batches", tags=["batches"])


def _get_batch(db, recipe_id: uuid.UUID, batch_id: uuid.UUID) -> RecipeBatch:
    batch = db.get(RecipeBatch, batch_id)
    if not batch or batch.recipe_id != recipe_id:
        raise HTTPException(404, "Batch not found")
    return batch


@router.get("", response_model=list[BatchOut], responses=NOT_FOUND_RESPONSE)
def list_batches(recipe_id: uuid.UUID, db: DbSession):
    if db.get(Recipe, recipe_id) is None:
        raise HTTPException(404, "Recipe not found")
    stmt = (
        select(RecipeBatch)
        .where(RecipeBatch.recipe_id == recipe_id)
        .order_by(RecipeBatch.made_on.desc(), RecipeBatch.created_at.desc())
    )
    return list(db.scalars(stmt).all())


@router.post("", response_model=BatchOut, status_code=201, responses=NOT_FOUND_RESPONSE)
def create_batch(recipe_id: uuid.UUID, data: BatchCreate, db: DbSession):
    if db.get(Recipe, recipe_id) is None:
        raise HTTPException(404, "Recipe not found")
    batch = RecipeBatch(
        recipe_id=recipe_id,
        **data.model_dump(exclude={"snapshot"}),
        snapshot=data.snapshot.model_dump(mode="json"),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


@router.put("/{batch_id}", response_model=BatchOut, responses=NOT_FOUND_RESPONSE)
def update_batch(
    recipe_id: uuid.UUID, batch_id: uuid.UUID, data: BatchUpdate, db: DbSession
):
    batch = _get_batch(db, recipe_id, batch_id)
    apply_updates(batch, data.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(batch)
    return batch


@router.delete("/{batch_id}", status_code=204, responses=NOT_FOUND_RESPONSE)
def delete_batch(recipe_id: uuid.UUID, batch_id: uuid.UUID, db: DbSession):
    batch = _get_batch(db, recipe_id, batch_id)
    db.delete(batch)
    db.commit()
