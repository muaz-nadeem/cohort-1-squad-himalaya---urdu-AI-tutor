"""Centralised environment/config access."""
import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


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
    TOPIC_GATE_MODEL: str = os.getenv("TOPIC_GATE_MODEL", "llama-3.1-8b-instant")
    MCQ_TEXT_MODEL: str = os.getenv("MCQ_TEXT_MODEL", "gpt-4o-mini")
    MCQ_VISION_MODEL: str = os.getenv("MCQ_VISION_MODEL", "gpt-4o-mini")
    WHISPER_MODEL: str = "whisper-large-v3"

    UPLIFT_BASE: str = "https://api.upliftai.org/v1"

    @property
    def supabase_ready(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_KEY)

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
