"""star ratings for recipes; half stars for batches

Revision ID: e7f2c4a8b1d6
Revises: d5e1b3f7a9c2
Create Date: 2026-11-19 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7f2c4a8b1d6"
down_revision: str | Sequence[str] | None = "d5e1b3f7a9c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("rating", sa.Numeric(2, 1), nullable=True))
    op.alter_column(
        "recipe_batches",
        "overall",
        type_=sa.Numeric(2, 1),
        existing_type=sa.Integer,
        postgresql_using="overall::numeric(2,1)",
    )


def downgrade() -> None:
    op.alter_column(
        "recipe_batches",
        "overall",
        type_=sa.Integer,
        existing_type=sa.Numeric(2, 1),
        postgresql_using="round(overall)::integer",
    )
    op.drop_column("recipes", "rating")
