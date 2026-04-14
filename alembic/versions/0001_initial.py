"""Initial migration.

Revision ID: 0001
Revises: 
Create Date: 2024

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # No changes needed - tables already created by metadata.create_all()
    pass


def downgrade():
    op.drop_table('messages')
    op.drop_table('conversations')
    op.drop_table('email_login_codes')
    op.drop_table('users')

