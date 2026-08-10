require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

const REALTIME_SERVER_SECRET = process.env.REALTIME_SERVER_SECRET || "";
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser / same-origin tools with no Origin header
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const UPLIFT_API = "https://api.upliftai.org/v1";
const API_KEY = process.env.UPLIFT_API_KEY;
const ASSISTANT_ID = process.env.UPLIFT_ASSISTANT_ID;
const RAG_API_URL = process.env.RAG_API_URL;
const PORT = process.env.PORT || 3001;

function b64urlJson(segment) {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return JSON.parse(Buffer.from(padded + pad, "base64").toString("utf8"));
}

function verifySupabaseJwt(token) {
  if (!SUPABASE_JWT_SECRET || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = crypto
    .createHmac("sha256", SUPABASE_JWT_SECRET)
    .update(data)
    .digest("base64url");
  if (expected !== sigB64) return null;
  try {
    const payload = b64urlJson(payloadB64);
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    if (payload.aud && payload.aud !== "authenticated") return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const secretHeader = req.headers["x-realtime-secret"];

  if (REALTIME_SERVER_SECRET && secretHeader === REALTIME_SERVER_SECRET) {
    return next();
  }
  if (bearer && verifySupabaseJwt(bearer)) {
    return next();
  }
  return res.status(401).json({
    error:
      "Unauthorized. Send Authorization: Bearer <supabase_access_token> " +
      "or X-Realtime-Secret matching REALTIME_SERVER_SECRET.",
  });
}

// ---------------------------------------------------------------------------
// POST /api/session
// Frontend calls this to get a WebRTC token for the Uplift Realtime room.
// ---------------------------------------------------------------------------
app.post("/api/session", requireAuth, async (req, res) => {
  const { participantName = "Student" } = req.body;

  if (!ASSISTANT_ID) {
    return res
      .status(500)
      .json({ error: "UPLIFT_ASSISTANT_ID is not configured. Run npm run setup first." });
  }

  try {
    const upliftRes = await fetch(
      `${UPLIFT_API}/realtime-assistants/${ASSISTANT_ID}/createSession`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ participantName }),
      }
    );

    if (!upliftRes.ok) {
      const body = await upliftRes.text();
      return res.status(upliftRes.status).json({ error: body });
    }

    const session = await upliftRes.json();
    res.json(session);
  } catch (err) {
    console.error("Session creation failed:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/rag/search
// ---------------------------------------------------------------------------
app.post("/api/rag/search", requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  if (RAG_API_URL) {
    try {
      const ragRes = await fetch(RAG_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await ragRes.json();
      return res.json(data);
    } catch (err) {
      console.error("RAG API unreachable:", err.message);
    }
  }

  console.log(`[RAG stub] query: "${query}"`);
  res.json({
    results: [
      {
        content:
          "یہ ایک placeholder جواب ہے۔ RAG pipeline ابھی تیار نہیں ہے۔ " +
          "جب آپ کی ٹیم RAG endpoint تیار کر لے تو .env میں RAG_API_URL سیٹ کریں۔",
        source: "stub",
      },
    ],
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Realtime server on http://localhost:${PORT}`);
  console.log(`CORS origins: ${ALLOWED_ORIGINS.join(", ") || "(none)"}`);
  if (!SUPABASE_JWT_SECRET && !REALTIME_SERVER_SECRET) {
    console.warn(
      "WARNING: Set SUPABASE_JWT_SECRET or REALTIME_SERVER_SECRET — routes require auth."
    );
  }
});
