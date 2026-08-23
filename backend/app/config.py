"""Centralised environment/config access."""
import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _parse_origins(raw: str) -> list[str]:
    """Split CORS origins; strip whitespace and trailing slashes."""
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def _parse_hosts(raw: str) -> list[str]:
    return [h.strip() for h in raw.split(",") if h.strip()]


class Settings:
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"

    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"

    UPLIFT_API_KEY: str = os.getenv("UPLIFT_API_KEY", "")
    UPLIFT_VOICE_ID: str = os.getenv("UPLIFT_VOICE_ID", "v_8eelc901")

    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    ELEVENLABS_MODEL: str = os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    ELEVENLABS_BASE: str = "https://api.elevenlabs.io/v1"

    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    # Prefer service role; fall back to legacy SUPABASE_KEY for local scripts.
    SUPABASE_SERVICE_ROLE_KEY: str = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
        or ""
    )
    # Legacy JWT secret (HS256). Newer projects may use asymmetric signing keys;
    # auth.py also verifies via JWKS / Auth /user when this is wrong or unused.
    SUPABASE_JWT_SECRET: str = (os.getenv("SUPABASE_JWT_SECRET") or "").strip()
    PORT: int = int(os.getenv("PORT", "8000"))

    # development | production — production refuses wildcard CORS
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development").strip().lower()

    # Comma-separated frontend origins. Default keeps local Next.js working.
    # Production: set exact Vercel/custom domains — never use * in production.
    # Example: https://your-app.vercel.app,https://uraan.app
    CORS_ORIGINS: list[str] = _parse_origins(
        os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    )

    # Optional: comma-separated hostnames for TrustedHostMiddleware
    # e.g. api.uraan.app,*.awsapprunner.com
    TRUSTED_HOSTS: list[str] = _parse_hosts(os.getenv("TRUSTED_HOSTS", ""))

    # Reject oversized mic clips (voice endpoints)
    MAX_AUDIO_UPLOAD_MB: float = float(os.getenv("MAX_AUDIO_UPLOAD_MB", "10"))

    EMBEDDING_MODEL: str = "nomic-embed-text-v1.5"  # local via fastembed
    EMBEDDING_DIMENSIONS: int = 768
    # Optional: remote Nomic Atlas embeddings when fastembed is not installed
    # (e.g. slim Render deploy). Same model/dims as ingested textbook chunks.
    NOMIC_API_KEY: str = os.getenv("NOMIC_API_KEY", "").strip()
    NOMIC_EMBED_URL: str = os.getenv(
        "NOMIC_EMBED_URL", "https://api-atlas.nomic.ai/v1/embedding/text"
    ).strip()
    # Groq retired llama-3.3-70b-versatile on 2026-08-16; gpt-oss-120b is the replacement.
    LLM_MODEL: str = os.getenv("GROQ_LLM_MODEL", "openai/gpt-oss-120b")
    # Ask Textbook + MCQ explanations (OpenAI). gpt-4o-mini is the lightest
    # production chat model already used for MCQ ingest.
    EXPLAIN_LLM_MODEL: str = os.getenv("EXPLAIN_LLM_MODEL", "gpt-4o-mini")
    VISION_MODEL: str = os.getenv(
        "GROQ_VISION_MODEL", "qwen/qwen3.6-27b"
    )
    # Groq retired llama-3.1-8b-instant on 2026-08-16; gpt-oss-20b is the replacement.
    TOPIC_GATE_MODEL: str = os.getenv("TOPIC_GATE_MODEL", "openai/gpt-oss-20b")
    MCQ_TEXT_MODEL: str = os.getenv("MCQ_TEXT_MODEL", "gpt-4o-mini")
    MCQ_VISION_MODEL: str = os.getenv("MCQ_VISION_MODEL", "gpt-4o-mini")
    WHISPER_MODEL: str = "whisper-large-v3"
    # Same as server/assistant-config.js stt.default.language — without this,
    # Whisper auto-detects Urdu speech as Hindi and writes Devanagari.
    WHISPER_LANGUAGE: str = os.getenv("WHISPER_LANGUAGE", "ur")

    UPLIFT_BASE: str = "https://api.upliftai.org/v1"

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT in {"production", "prod"}

    @property
    def max_audio_bytes(self) -> int:
        return int(self.MAX_AUDIO_UPLOAD_MB * 1024 * 1024)

    @property
    def cors_allow_origins(self) -> list[str]:
        """Origins passed to CORSMiddleware (never '*' in production)."""
        origins = list(self.CORS_ORIGINS)
        if "*" in origins:
            if self.is_production:
                print(
                    "  [config] WARNING: CORS_ORIGINS=* is not allowed in production; "
                    "falling back to empty list — set explicit Vercel/frontend URLs"
                )
                return []
            return ["*"]
        return origins

    @property
    def cors_allow_credentials(self) -> bool:
        # Browsers reject Access-Control-Allow-Origin: * with credentials
        return "*" not in self.cors_allow_origins

    @property
    def SUPABASE_KEY(self) -> str:
        """Alias used by db.get_client — always the service role key."""
        return self.SUPABASE_SERVICE_ROLE_KEY

    @property
    def supabase_ready(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_SERVICE_ROLE_KEY)

    @property
    def auth_ready(self) -> bool:
        # Local HS256 secret, or URL+service role (JWKS / Auth /user fallback).
        return bool(self.SUPABASE_JWT_SECRET) or self.supabase_ready

    @property
    def groq_ready(self) -> bool:
        return bool(self.GROQ_API_KEY)

    @property
    def openai_ready(self) -> bool:
        return bool(self.OPENAI_API_KEY) and self.OPENAI_API_KEY != "your_openai_api_key"

    @property
    def gemini_ready(self) -> bool:
        return bool(self.GEMINI_API_KEY)

    @property
    def uplift_ready(self) -> bool:
        return bool(self.UPLIFT_API_KEY)

    @property
    def elevenlabs_ready(self) -> bool:
        return bool(self.ELEVENLABS_API_KEY)

    @property
    def tts_ready(self) -> bool:
        """True if any TTS provider is configured."""
        return self.elevenlabs_ready or self.uplift_ready


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
