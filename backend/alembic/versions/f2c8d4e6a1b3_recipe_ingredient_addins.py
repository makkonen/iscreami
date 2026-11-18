"""allow add-ins on recipe ingredients

Revision ID: f2c8d4e6a1b3
Revises: e4f1a7b3c9d2
Create Date: 2026-11-18 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2c8d4e6a1b3"
down_revision: str | Sequence[str] | None = "e4f1a7b3c9d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recipe_ingredients",
        sa.Column("is_addin", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    # Postgres' default name for the initial unnamed unique constraint.
    op.drop_constraint(
        "recipe_ingredients_recipe_id_ingredient_id_key",
        "recipe_ingredients",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_recipe_ingredient_addin",
        "recipe_ingredients",
        ["recipe_id", "ingredient_id", "is_addin"],
    )


def downgrade() -> None:
    op.execute("DELETE FROM recipe_ingredients WHERE is_addin")
    op.drop_constraint(
        "uq_recipe_ingredient_addin", "recipe_ingredients", type_="unique"
    )
    op.create_unique_constraint(
        "recipe_ingredients_recipe_id_ingredient_id_key",
        "recipe_ingredients",
        ["recipe_id", "ingredient_id"],
    )
    op.drop_column("recipe_ingredients", "is_addin")
