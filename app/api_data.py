from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models_db import Conversation, Message, User

router = APIRouter(prefix="/api", tags=["data"])


class ConversationOut(BaseModel):
    id: int
    title: str


class ConversationCreate(BaseModel):
    title: str = "Жаңы чат"


class ConversationUpdate(BaseModel):
    title: str


class MessageOut(BaseModel):
    id: int
    role: str
    content: str


class MessageCreate(BaseModel):
    role: str
    content: str


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "name": user.name}


@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at.isoformat()} for c in rows]


@router.post("/conversations")
def create_conversation(body: ConversationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = Conversation(user_id=user.id, title=body.title.strip() or "Жаңы чат")
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "title": c.title}


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.patch("/conversations/{conv_id}")
def rename_conversation(
    conv_id: int,
    body: ConversationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    c.title = body.title.strip() or "Чат"
    db.commit()
    return {"ok": True, "id": c.id, "title": c.title}


@router.get("/conversations/{conv_id}/messages")
def list_messages(conv_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    msgs = db.query(Message).filter(Message.conversation_id == c.id).order_by(Message.created_at.asc()).all()
    return [{"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in msgs]


@router.post("/conversations/{conv_id}/messages")
def add_message(
    conv_id: int,
    body: MessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    role = body.role.strip()
    if role not in ["user", "assistant", "system"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Empty content")
    m = Message(conversation_id=c.id, role=role, content=content)
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}

