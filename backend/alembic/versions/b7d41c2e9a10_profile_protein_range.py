"""add protein range to target profiles

Revision ID: b7d41c2e9a10
Revises: 64eaea837bc3
Create Date: 2026-11-18 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d41c2e9a10"
down_revision: str | Sequence[str] | None = "64eaea837bc3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("target_profiles", sa.Column("protein_min", sa.Numeric(6, 2)))
    op.add_column("target_profiles", sa.Column("protein_max", sa.Numeric(6, 2)))


def downgrade() -> None:
    op.drop_column("target_profiles", "protein_max")
    op.drop_column("target_profiles", "protein_min")
