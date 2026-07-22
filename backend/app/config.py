"""Centralised environment/config access."""
import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"

    UPLIFT_API_KEY: str = os.getenv("UPLIFT_API_KEY", "")
    UPLIFT_VOICE_ID: str = os.getenv("UPLIFT_VOICE_ID", "v_8eelc901")
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    PORT: int = int(os.getenv("PORT", "8000"))
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()
    ]

    EMBEDDING_MODEL: str = "nomic-embed-text-v1.5"  # local via fastembed
    EMBEDDING_DIMENSIONS: int = 768
    LLM_MODEL: str = os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile")
    VISION_MODEL: str = os.getenv(
        "GROQ_VISION_MODEL", "qwen/qwen3.6-27b"
    )
    MCQ_TEXT_MODEL: str = os.getenv("GROQ_MCQ_TEXT_MODEL", "llama-3.1-8b-instant")
    MCQ_VISION_MODEL: str = os.getenv("GROQ_MCQ_VISION_MODEL", "qwen/qwen3.6-27b")
    WHISPER_MODEL: str = "whisper-large-v3"

    UPLIFT_BASE: str = "https://api.upliftai.org/v1"

    @property
    def supabase_ready(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_KEY)

    @property
    def groq_ready(self) -> bool:
        return bool(self.GROQ_API_KEY)

    @property
    def gemini_ready(self) -> bool:
        return bool(self.GEMINI_API_KEY)

    @property
    def uplift_ready(self) -> bool:
        return bool(self.UPLIFT_API_KEY)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
