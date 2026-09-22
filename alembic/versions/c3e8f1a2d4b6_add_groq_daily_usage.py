"""add groq_daily_usage

Revision ID: c3e8f1a2d4b6
Revises: b7d4e2a1c9f8
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e8f1a2d4b6'
down_revision: Union[str, Sequence[str], None] = 'b7d4e2a1c9f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'groq_daily_usage',
        sa.Column('day', sa.Date(), primary_key=True),
        sa.Column('calls', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tokens', sa.BigInteger(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('groq_daily_usage')
