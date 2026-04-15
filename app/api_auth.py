import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import create_access_token, generate_code, hash_code, send_login_code_email, verify_code, get_password_hash, verify_password
from app.db import get_db
from app.models_db import EmailLoginCode, User

from pydantic import Field

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    username: str = Field(..., min_length=6, description="Unique username min 6 chars")
    email: EmailStr
    password: str = Field(..., min_length=8, description="Password min 8 chars")


class LoginBody(BaseModel):
    identifier: str = Field(..., description="Username or email")
    password: str


class RequestCodeBody(BaseModel):
    email: EmailStr


class VerifyCodeBody(BaseModel):
    email: EmailStr
    code: str
    name: str | None = None


def _latest_valid_code(db: Session, email: str) -> EmailLoginCode | None:
    now = dt.datetime.now(dt.timezone.utc)
    return (
        db.query(EmailLoginCode)
        .filter(
            EmailLoginCode.email == email,
            EmailLoginCode.consumed_at.is_(None),
            EmailLoginCode.expires_at > now,
        )
        .order_by(EmailLoginCode.id.desc())
        .first()
    )


@router.post("/request-code")
def request_code(body: RequestCodeBody, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Бул email боюнча колдонуучу табылган жок.")

    code = generate_code()
    code_hash = hash_code(code)
    now = dt.datetime.now(dt.timezone.utc)
    expires = now + dt.timedelta(minutes=10)

    db.add(EmailLoginCode(email=body.email, code_hash=code_hash, expires_at=expires))
    db.commit()

    # Send email (Gmail SMTP app password recommended)
    try:
        send_login_code_email(to_email=body.email, code=code)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email send failed: {e}") from e
    return {"ok": True}


@router.post("/register")
def register(body: RegisterBody, db: Session = Depends(get_db)):
    email_owner = db.query(User).filter(User.email == body.email).first()
    username_owner = db.query(User).filter(User.username == body.username).first()

    if email_owner and email_owner.is_active:
        raise HTTPException(status_code=400, detail="Бул email менен аккаунт мурунтан бар.")

    if username_owner and username_owner.is_active and username_owner.email != body.email:
        raise HTTPException(status_code=400, detail="Бул колдонуучу аты алынган.")

    if email_owner and username_owner and email_owner.id != username_owner.id:
        raise HTTPException(
            status_code=400,
            detail="Бул email жана колдонуучу аты ар башка аккаунттарга таандык.",
        )

    target_user = email_owner or username_owner

    # Create or update inactive user
    if not target_user:
        user = User(
            email=body.email,
            username=body.username,
            password_hash=get_password_hash(body.password),
            is_active=False,
        )
        db.add(user)
    else:
        target_user.email = body.email
        target_user.username = body.username
        target_user.password_hash = get_password_hash(body.password)
        target_user.is_active = False
        user = target_user

    # Generate and save code
    code = generate_code()
    code_hash = hash_code(code)
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10)

    db.add(EmailLoginCode(email=body.email, code_hash=code_hash, expires_at=expires))
    db.commit()

    try:
        send_login_code_email(to_email=body.email, code=code)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Кодду жиберүү ишке ашкан жок: {e}") from e

    return {"message": "Каттоо коду электрондук почтаңызга жөнөтүлдү."}


@router.post("/verify-registration")
def verify_registration(body: VerifyCodeBody, db: Session = Depends(get_db)):
    now = dt.datetime.now(dt.timezone.utc)
    row = _latest_valid_code(db, body.email)

    if not row or not verify_code(body.code.strip(), row.code_hash):
        raise HTTPException(status_code=400, detail="Туура эмес же мөөнөтү өткөн код.")

    row.consumed_at = now

    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Колдонуучу табылган жок.")

    user.is_active = True
    db.commit()

    return {
        "ok": True,
        "message": "Каттоо ийгиликтүү аяктады. Эми сырсөз менен кириңиз.",
    }


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(
            or_(User.username == body.identifier, User.email == body.identifier)
        )
        .first()
    )
    if user and not user.is_active:
        raise HTTPException(status_code=403, detail="Аккаунт ырасталган эмес. Email кодун текшериңиз.")

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail="Логин же сырсөз туура эмес.")

    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "username": user.username, "email": user.email},
    }


@router.post("/verify-code")
def verify(body: VerifyCodeBody, db: Session = Depends(get_db)):
    now = dt.datetime.now(dt.timezone.utc)
    row = _latest_valid_code(db, body.email)

    if not row or not verify_code(body.code.strip(), row.code_hash):
        raise HTTPException(status_code=400, detail="Туура эмес же мөөнөтү өткөн код.")

    row.consumed_at = now
    
    # Find and activate user
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Колдонуучу табылган жок.")
    
    user.is_active = True
    db.commit()

    if not user.password_hash:
        raise HTTPException(status_code=400, detail="Бул колдонуучу үчүн сырсөз коюлган эмес.")

    return {
        "ok": True,
        "message": "Код ырасталды. Эми сырсөз менен кириңиз.",
    }