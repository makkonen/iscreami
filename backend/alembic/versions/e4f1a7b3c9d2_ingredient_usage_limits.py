"""add typical-use limits to ingredients

Revision ID: e4f1a7b3c9d2
Revises: d9a2b6c4e7f1
Create Date: 2026-11-18 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f1a7b3c9d2"
down_revision: str | Sequence[str] | None = "d9a2b6c4e7f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ingredients", sa.Column("usage_min_pct", sa.Numeric(6, 3)))
    op.add_column("ingredients", sa.Column("usage_max_pct", sa.Numeric(6, 3)))


def downgrade() -> None:
    op.drop_column("ingredients", "usage_max_pct")
    op.drop_column("ingredients", "usage_min_pct")
