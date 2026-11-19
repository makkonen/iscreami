"""recipe batch log

Revision ID: c4d9a2e7b5f3
Revises: b8e3f1a5c7d9
Create Date: 2026-11-19 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d9a2e7b5f3"
down_revision: str | Sequence[str] | None = "b8e3f1a5c7d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recipe_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recipe_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("made_on", sa.Date, nullable=False),
        sa.Column("serving_method", sa.Text),
        sa.Column("snapshot", postgresql.JSONB, nullable=False),
        sa.Column("hardness", sa.Integer),
        sa.Column("sweetness", sa.Integer),
        sa.Column("iciness", sa.Integer),
        sa.Column("overall", sa.Integer),
        sa.Column("notes", sa.Text),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_recipe_batches_recipe_id", "recipe_batches", ["recipe_id"])


def downgrade() -> None:
    op.drop_index("ix_recipe_batches_recipe_id", table_name="recipe_batches")
    op.drop_table("recipe_batches")
