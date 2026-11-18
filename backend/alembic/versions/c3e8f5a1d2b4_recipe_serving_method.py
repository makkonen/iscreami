"""add serving method to recipes

Revision ID: c3e8f5a1d2b4
Revises: b7d41c2e9a10
Create Date: 2026-11-18 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e8f5a1d2b4"
down_revision: str | Sequence[str] | None = "b7d41c2e9a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("serving_method", sa.Text))


def downgrade() -> None:
    op.drop_column("recipes", "serving_method")
