"""add rubric to questions and study_note to sessions

Revision ID: f2a9c1d7b3e4
Revises: 1be18e5b5b0a
Create Date: 2026-09-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f2a9c1d7b3e4'
down_revision: Union[str, Sequence[str], None] = '1be18e5b5b0a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('questions', sa.Column('rubric', postgresql.JSONB(), nullable=True))
    op.add_column('sessions', sa.Column('study_note', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sessions', 'study_note')
    op.drop_column('questions', 'rubric')
