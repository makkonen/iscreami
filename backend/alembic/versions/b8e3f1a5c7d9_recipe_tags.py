"""recipe tags

Revision ID: b8e3f1a5c7d9
Revises: a6b2d8e4f0c1
Create Date: 2026-11-19 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e3f1a5c7d9"
down_revision: str | Sequence[str] | None = "a6b2d8e4f0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column(
            "tags",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("recipes", "tags")
