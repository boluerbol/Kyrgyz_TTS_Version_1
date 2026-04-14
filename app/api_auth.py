import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
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


@router.post("/request-code")
def request_code(body: RequestCodeBody, db: Session = Depends(get_db)):
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
    # Check if user already exists
    existing_user = db.query(User).filter(
        (User.email == body.email) | (User.username == body.username)
    ).first()
    
    if existing_user and existing_user.is_active:
        raise HTTPException(status_code=400, detail="Колдонуучу мурунтан эле катталган.")

    # Create or update inactive user
    if not existing_user:
        user = User(
            email=body.email,
            username=body.username,
            password_hash=get_password_hash(body.password),
            is_active=False 
        )
        db.add(user)
    else:
        # Update details if they are trying to register again while inactive
        existing_user.username = body.username
        existing_user.password_hash = get_password_hash(body.password)
        user = existing_user

    # Generate and save code
    code = generate_code()
    code_hash = hash_code(code)
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10)

    db.add(EmailLoginCode(email=body.email, code_hash=code_hash, expires_at=expires))
    db.commit()

    # Send the email
    send_login_code_email(to_email=body.email, code=code)

    return {"message": "Каттоо коду электрондук почтаңызга жөнөтүлдү."}

@router.post("/verify-registration")
def verify_registration(body: VerifyCodeBody, db: Session = Depends(get_db)):
    now = dt.datetime.now(dt.timezone.utc)
    
    # 1. Find the latest code for this email
    row = db.query(EmailLoginCode).filter(
        EmailLoginCode.email == body.email,
        EmailLoginCode.consumed_at == None,
        EmailLoginCode.expires_at > now
    ).order_by(EmailLoginCode.id.desc()).first()

    if not row or not verify_code(body.code.strip(), row.code_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    # 2. Mark code as used
    row.consumed_at = now
    
    # 3. Activate the user
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User record not found.")
    
    user.is_active = True
    db.commit()

    # 4. Return JWT token
    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "username": user.username, "email": user.email}
    }
@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(
            (User.username == body.identifier) | (User.email == body.identifier)
        )
        .first()
    )
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail="Invalid credentials")

    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "username": user.username, "email": user.email},
    }


@router.post("/verify-code")
def verify(body: VerifyCodeBody, db: Session = Depends(get_db)):
    now = dt.datetime.now(dt.timezone.utc)
    
    row = db.query(EmailLoginCode).filter(
        EmailLoginCode.email == body.email,
        EmailLoginCode.consumed_at == None
    ).order_by(EmailLoginCode.id.desc()).first()

    if not row or row.expires_at < now or not verify_code(body.code.strip(), row.code_hash):
        raise HTTPException(status_code=400, detail="Туура эмес же мөөнөтү өткөн код.")

    row.consumed_at = now
    
    # Find and activate user
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Колдонуучу табылган жок.")
    
    user.is_active = True
    db.commit()

    # Generate login token
    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "username": user.username, "email": user.email}
    }