"""recipe instructions

Revision ID: d5e1b3f7a9c2
Revises: c4d9a2e7b5f3
Create Date: 2026-11-19 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e1b3f7a9c2"
down_revision: str | Sequence[str] | None = "c4d9a2e7b5f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("instructions", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "instructions")
