"""SQLAlchemy ORM models for iscreami."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class IngredientCategory(Base):
    __tablename__ = "ingredient_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    ingredients: Mapped[list["Ingredient"]] = relationship(back_populates="category")


# The six sugar breakdown fields on Ingredient. Single source of truth —
# PAC/POD calculation (services/pac.py, services/sweetness.py) and the
# sweetener breakdown (services/calculator.py) all derive from this, so
# adding a new sugar can't silently miss one of the three consumers.
SUGAR_FIELDS: tuple[str, ...] = (
    "sucrose",
    "glucose",
    "fructose",
    "lactose",
    "maltose",
    "galactose",
)


class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingredient_categories.id")
    )
    source: Mapped[str] = mapped_column(Text, default="manual")
    source_id: Mapped[str | None] = mapped_column(Text)

    # Composition per 100g
    water_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    total_fat_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    saturated_fat_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    trans_fat_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    protein_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    carbohydrate_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    fiber_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    total_sugar_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    energy_kj_per_100g: Mapped[float | None] = mapped_column(Numeric(10, 4))
    alcohol_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    sodium_mg: Mapped[float | None] = mapped_column(Numeric(10, 4))

    # Sugar breakdown per 100g (nullable — advanced mode)
    sucrose_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    glucose_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    fructose_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    lactose_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    maltose_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    galactose_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))

    # Dairy-specific
    milk_fat_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    msnf_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))

    # Chocolate-specific
    cocoa_butter_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    cocoa_solids_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))

    # Stabilizer/emulsifier content per 100g
    stabilizer_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))
    emulsifier_pct: Mapped[float | None] = mapped_column(Numeric(8, 4))

    # Optional manual overrides
    pac_override: Mapped[float | None] = mapped_column(Numeric(10, 4))
    pod_override: Mapped[float | None] = mapped_column(Numeric(10, 4))

    # Typical use as % of the whole mix (e.g. salt up to 0.3%). Guardrails for
    # the in-spec weight band and balancing, beyond what the profile judges.
    usage_min_pct: Mapped[float | None] = mapped_column(Numeric(6, 3))
    usage_max_pct: Mapped[float | None] = mapped_column(Numeric(6, 3))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[IngredientCategory | None] = relationship(
        back_populates="ingredients"
    )
    aliases: Mapped[list["IngredientAlias"]] = relationship(
        back_populates="ingredient", cascade="all, delete-orphan"
    )
    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="ingredient"
    )


def sugar_contributions_per_100g(ingredient: Ingredient) -> list[tuple[str, float]]:
    """Sugar contribution as (name, g per 100g) pairs for PAC/POD calculation.

    Uses the per-sugar breakdown when any field is populated (zeroes ignored);
    otherwise falls back to treating ``total_sugar_pct`` as pure sucrose.
    Returns an empty list when no sugar data is present.
    """
    sugar_fields = {name: getattr(ingredient, f"{name}_pct") for name in SUGAR_FIELDS}
    if any(v is not None for v in sugar_fields.values()):
        return [
            (name, float(pct))
            for name, pct in sugar_fields.items()
            if pct is not None and pct > 0
        ]
    if ingredient.total_sugar_pct is not None:
        return [("sucrose", float(ingredient.total_sugar_pct))]
    return []


class IngredientAlias(Base):
    __tablename__ = "ingredient_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        nullable=False,
    )
    alias: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (UniqueConstraint("ingredient_id", "alias"),)

    ingredient: Mapped["Ingredient"] = relationship(back_populates="aliases")


class TargetProfile(Base):
    __tablename__ = "target_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)

    serving_temp_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    serving_temp_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    sweetness_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    sweetness_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    total_solids_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    total_solids_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    total_fat_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    total_fat_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    milk_fat_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    milk_fat_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    sugar_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    sugar_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    alcohol_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    alcohol_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    msnf_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    msnf_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    stabilizer_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    stabilizer_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    emulsifier_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    emulsifier_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    protein_min: Mapped[float | None] = mapped_column(Numeric(6, 2))
    protein_max: Mapped[float | None] = mapped_column(Numeric(6, 2))
    # How this style is usually served; recipes on "auto" serving use it.
    default_serving_method: Mapped[str | None] = mapped_column(Text)

    recipes: Mapped[list["Recipe"]] = relationship(back_populates="target_profile")


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-form notes about the recipe (shown as "Notes").
    description: Mapped[str | None] = mapped_column(Text)
    # How to make it, for recipes that need more than mixing and freezing.
    instructions: Mapped[str | None] = mapped_column(Text)
    recipe_type: Mapped[str | None] = mapped_column(Text)
    # How it will be served (e.g. eat right away, scoop later); sets the freezing target.
    serving_method: Mapped[str | None] = mapped_column(Text)
    target_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("target_profiles.id")
    )
    # The recipe this one was duplicated from, so variants can be traced back.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="SET NULL")
    )
    # Free-form tags; "/" nests them, e.g. "Status/Retired" or "Base/Chocolate".
    tags: Mapped[list[str]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=list,
        server_default="[]",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    target_profile: Mapped[TargetProfile | None] = relationship(
        back_populates="recipes"
    )
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
        order_by="RecipeIngredient.sort_order",
    )
    batches: Mapped[list["RecipeBatch"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    # The same ingredient may appear once in the mix and once as an add-in.
    __table_args__ = (
        UniqueConstraint(
            "recipe_id", "ingredient_id", "is_addin", name="uq_recipe_ingredient_addin"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
    )
    weight_grams: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Add-ins (mix-ins, ripples, toppings) are folded in after freezing: they
    # count toward nutrition but not toward the mix's balance or freezing.
    is_addin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    recipe: Mapped[Recipe] = relationship(back_populates="ingredients")
    ingredient: Mapped[Ingredient] = relationship(back_populates="recipe_ingredients")


class RecipeBatch(Base):
    """One time a recipe was made: what went in, and how it turned out."""

    __tablename__ = "recipe_batches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recipes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    made_on: Mapped[date] = mapped_column(Date, nullable=False)
    serving_method: Mapped[str | None] = mapped_column(Text)
    # The weights and key metrics as made, which may differ from the saved recipe.
    snapshot: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False
    )
    # -2 far too soft / not sweet enough .. 0 right .. +2 far too hard / sweet.
    hardness: Mapped[int | None] = mapped_column(Integer)
    sweetness: Mapped[int | None] = mapped_column(Integer)
    # 0 smooth .. 3 very icy.
    iciness: Mapped[int | None] = mapped_column(Integer)
    # 1..5 overall.
    overall: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    recipe: Mapped[Recipe] = relationship(back_populates="batches")
