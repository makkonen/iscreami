"""link duplicated recipes to the recipe they came from

Revision ID: a6b2d8e4f0c1
Revises: f2c8d4e6a1b3
Create Date: 2026-11-19 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6b2d8e4f0c1"
down_revision: str | Sequence[str] | None = "f2c8d4e6a1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_recipes_parent_id",
        "recipes",
        "recipes",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_recipes_parent_id", "recipes", type_="foreignkey")
    op.drop_column("recipes", "parent_id")
