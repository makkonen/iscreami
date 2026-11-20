"""recipe source link

Revision ID: f9a3b5c7d2e4
Revises: e7f2c4a8b1d6
Create Date: 2026-11-20 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a3b5c7d2e4"
down_revision: str | Sequence[str] | None = "e7f2c4a8b1d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("source_url", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "source_url")
