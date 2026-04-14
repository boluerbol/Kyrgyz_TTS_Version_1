from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.db import Base
import datetime as dt

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=True)
    name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

    # Optional relationships
    conversations = relationship("Conversation", back_populates="user")


class EmailLoginCode(Base):
    __tablename__ = "email_login_codes"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    code_hash = Column(String, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index('ix_email_login_codes_email_code', 'email', 'code_hash'),)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=False, default="Жаңы чат")
    created_at = Column(DateTime(timezone=True), default=dt.datetime.now(dt.timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=dt.datetime.now(dt.timezone.utc), onupdate=dt.datetime.now(dt.timezone.utc))

    # Relationships
    user = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", order_by="Message.created_at")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user, assistant, system
    content = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=dt.datetime.now(dt.timezone.utc))

    conversation = relationship("Conversation", back_populates="messages")

