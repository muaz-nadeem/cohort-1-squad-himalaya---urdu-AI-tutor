"""Supabase Auth JWT verification for FastAPI dependencies."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Optional

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .config import settings

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: Optional[str] = None


def _decode_access_token(token: str) -> AuthUser:
    secret = settings.SUPABASE_JWT_SECRET
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth is not configured (SUPABASE_JWT_SECRET missing).",
        )
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return AuthUser(user_id=str(sub), email=payload.get("email"))


async def get_current_user(
    credentials: Annotated[
        Optional[HTTPAuthorizationCredentials], Depends(_bearer)
    ] = None,
    access_token: Annotated[Optional[str], Query()] = None,
) -> AuthUser:
    """Verify Bearer header, or `access_token` query (for <audio> media streams)."""
    token: Optional[str] = None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    elif access_token:
        token = access_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_access_token(token)


async def require_student(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    """Authenticated user that already has a students row."""
    student = db.get_student(user.user_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found. Complete signup first.",
        )
    return student


def assert_same_student(user: AuthUser, student_id: Optional[str]) -> str:
    """Return the authenticated user id; reject mismatched client-supplied ids."""
    if student_id and student_id != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="student_id does not match authenticated user",
        )
    return user.user_id


def public_question(q: dict) -> dict:
    """Strip answer keys / explanations from a question row for list APIs."""
    out = {k: v for k, v in q.items() if k not in ("correct_option", "explanation")}
    return out


def public_questions(qs: list[dict]) -> list[dict]:
    return [public_question(q) for q in qs]


def public_question_set(payload: dict) -> dict:
    """Copy a question-set response and strip secrets from nested questions."""
    out = dict(payload)
    if isinstance(out.get("questions"), list):
        out["questions"] = public_questions(out["questions"])
    return out
