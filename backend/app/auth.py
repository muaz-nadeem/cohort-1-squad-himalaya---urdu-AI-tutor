"""Supabase Auth JWT verification for FastAPI dependencies."""
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from . import db
from .config import settings

_bearer = HTTPBearer(auto_error=False)

# Asymmetric algs used by newer Supabase signing keys.
_ASYMMETRIC = {"RS256", "ES256", "ES384", "ES512", "EdDSA"}


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: Optional[str] = None


@lru_cache(maxsize=1)
def _jwks_client() -> Optional[PyJWKClient]:
    base = (settings.SUPABASE_URL or "").rstrip("/")
    if not base:
        return None
    return PyJWKClient(
        f"{base}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
        lifespan=600,
    )


def _auth_user_from_payload(payload: dict) -> AuthUser:
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return AuthUser(user_id=str(sub), email=payload.get("email"))


def _decode_with_jwks(token: str) -> Optional[dict]:
    client = _jwks_client()
    if client is None:
        return None
    try:
        key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            key.key,
            algorithms=list(_ASYMMETRIC | {"HS256"}),
            audience="authenticated",
        )
    except Exception:
        return None


def _decode_with_shared_secret(token: str) -> Optional[dict]:
    secret = (settings.SUPABASE_JWT_SECRET or "").strip()
    if not secret:
        return None
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError:
        return None


def _verify_with_supabase_auth(token: str) -> Optional[AuthUser]:
    """Ask Supabase Auth if this access token is still valid (works for any signing key)."""
    base = (settings.SUPABASE_URL or "").rstrip("/")
    api_key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not base or not api_key:
        return None
    try:
        res = httpx.get(
            f"{base}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": api_key,
            },
            timeout=8.0,
        )
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    data = res.json() or {}
    user_id = data.get("id")
    if not user_id:
        return None
    return AuthUser(user_id=str(user_id), email=data.get("email"))


def _decode_access_token(token: str) -> AuthUser:
    """Verify a Supabase user access token.

    Order: JWKS (new asymmetric keys) → JWT secret (legacy HS256) → Auth /user API.
    """
    if not settings.SUPABASE_URL and not settings.SUPABASE_JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth is not configured.",
        )

    payload = _decode_with_jwks(token) or _decode_with_shared_secret(token)
    if payload is not None:
        return _auth_user_from_payload(payload)

    user = _verify_with_supabase_auth(token)
    if user is not None:
        return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def login_with_password(email: str, password: str) -> dict:
    """Validate email/password via Supabase Auth. Used by POST /api/auth/login."""
    email = (email or "").strip()
    if not email or "@" not in email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password are required.",
        )
    base = (settings.SUPABASE_URL or "").rstrip("/")
    api_key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not base or not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth is not configured.",
        )
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            res = await http.post(
                f"{base}/auth/v1/token",
                params={"grant_type": "password"},
                headers={
                    "apikey": api_key,
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"email": email, "password": password},
            )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the login service. Try again in a moment.",
        ) from None

    payload = {}
    try:
        payload = res.json() if res.content else {}
    except ValueError:
        payload = {}

    if res.status_code != 200:
        raw = " ".join(
            str(payload.get(k) or "")
            for k in ("error_code", "error", "error_description", "msg", "message")
        ).lower()
        if "email_not_confirmed" in raw or "email not confirmed" in raw:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Confirm your email before signing in.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    access_token = payload.get("access_token")
    refresh_token = payload.get("refresh_token")
    user = payload.get("user") or {}
    if not access_token or not refresh_token or not user.get("id"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Login service returned an incomplete session.",
        )
    meta = user.get("user_metadata") or {}
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": payload.get("expires_in"),
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": meta.get("name"),
        },
    }


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
