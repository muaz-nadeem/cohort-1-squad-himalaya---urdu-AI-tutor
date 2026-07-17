require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const UPLIFT_API = "https://api.upliftai.org/v1";
const API_KEY = process.env.UPLIFT_API_KEY;
const ASSISTANT_ID = process.env.UPLIFT_ASSISTANT_ID;
const RAG_API_URL = process.env.RAG_API_URL;
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// POST /api/session
// Frontend calls this to get a WebRTC token for the Uplift Realtime room.
// ---------------------------------------------------------------------------
app.post("/api/session", async (req, res) => {
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
    // session = { token, wsUrl, roomName }
    res.json(session);
  } catch (err) {
    console.error("Session creation failed:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/rag/search
// The frontend tool handler calls this when the Uplift agent invokes
// the search_biology_books tool via RPC.
//
// Expects: { query: string }
// Returns: { results: Array<{ content, source, page? }> }
// ---------------------------------------------------------------------------
app.post("/api/rag/search", async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  // If the RAG pipeline is live, proxy to it
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

  // Fallback: return a placeholder so you can test the voice flow
  // before the RAG pipeline is ready
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

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    assistantConfigured: !!ASSISTANT_ID,
    ragConnected: !!RAG_API_URL,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`  Assistant ID : ${ASSISTANT_ID || "(not set — run npm run setup)"}`);
  console.log(`  RAG endpoint : ${RAG_API_URL || "(stub mode — set RAG_API_URL in .env)"}`);
});
