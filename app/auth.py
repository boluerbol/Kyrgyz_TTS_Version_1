import datetime as dt
import hashlib
import os
import secrets
import smtplib
from email.message import EmailMessage
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

# --- Configuration ---
JWT_SECRET = os.getenv("JWT_SECRET", "dev-change-me")
JWT_ALG = "HS256"
JWT_EXPIRES_MIN = int(os.getenv("JWT_EXPIRES_MIN", "43200"))  # 30 days

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)

# Use bcrypt for passwords. The deprecated="auto" handles older hashes if you migrate.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- Password Security ---

def get_password_hash(password: str) -> str:
    """
    Hashes the password using SHA-256 first to bypass the 72-byte bcrypt limit,
    then hashes the result with bcrypt.
    """
    # Pre-hash to fix the "ValueError: password cannot be longer than 72 bytes"
    pre_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return pwd_context.hash(pre_hash)

def verify_password(plain_password: str, password_hash: str) -> bool:
    """
    Verifies the pre-hashed password against the stored bcrypt hash.
    """
    if not password_hash:
        return False
    pre_hash = hashlib.sha256(plain_password.encode("utf-8")).hexdigest()
    return pwd_context.verify(pre_hash, password_hash)

# --- OTP (Login Code) Security ---

def hash_code(code: str) -> str:
    """
    Hashes short-lived OTP codes using a pepper (JWT_SECRET).
    """
    payload = f"{JWT_SECRET}:{code}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

def verify_code(code: str, code_hash: str) -> bool:
    expected = hash_code(code)
    return secrets.compare_digest(expected, code_hash)

def generate_code() -> str:
    # 6-digit numeric string
    return f"{secrets.randbelow(1000000):06d}"

# --- JWT Token Management ---

def create_access_token(*, user_id: int, email: str) -> str:
    now = dt.datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(minutes=JWT_EXPIRES_MIN)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        return None

# --- Email Communications ---

def send_login_code_email(*, to_email: str, code: str) -> None:
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM):
        # In development, you might want to just print the code instead of raising an error
        print(f"DEBUG: Login code for {to_email} is {code}")
        return

    smtp_password = SMTP_PASSWORD.replace(" ", "")

    msg = EmailMessage()
    msg["Subject"] = "Kyrgyz AI Login Code"
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(
        f"Салам!\n\nКирүү кодуңуз: {code}\n\nБул код 10 мүнөт ичинде жарактуу.\n"
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, smtp_password)
            server.send_message(msg)
    except Exception as e:
        # Production logging should capture this
        print(f"Failed to send email: {e}")
        raise RuntimeError("Email delivery failed.")