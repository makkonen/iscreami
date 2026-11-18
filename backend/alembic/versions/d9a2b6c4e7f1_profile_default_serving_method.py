"""add usual serving method to target profiles

Revision ID: d9a2b6c4e7f1
Revises: c3e8f5a1d2b4
Create Date: 2026-11-18 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9a2b6c4e7f1"
down_revision: str | Sequence[str] | None = "c3e8f5a1d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("target_profiles", sa.Column("default_serving_method", sa.Text))


def downgrade() -> None:
    op.drop_column("target_profiles", "default_serving_method")
