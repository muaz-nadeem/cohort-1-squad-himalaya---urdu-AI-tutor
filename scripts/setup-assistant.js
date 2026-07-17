require("dotenv").config();
const { assistantConfig } = require("../server/assistant-config");

const UPLIFT_API = "https://api.upliftai.org/v1";

async function setupAssistant() {
  const apiKey = process.env.UPLIFT_API_KEY;
  if (!apiKey || apiKey === "sk_api_your_key_here") {
    console.error("Set UPLIFT_API_KEY in your .env file first.");
    process.exit(1);
  }

  console.log("Creating assistant on Uplift AI...\n");

  const res = await fetch(`${UPLIFT_API}/realtime-assistants`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistantConfig),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Uplift API error (${res.status}): ${body}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log("Assistant created successfully!\n");
  console.log(`  Name : ${data.name}`);
  console.log(`  ID   : ${data.realtimeAssistantId}\n`);
  console.log("Next step — add this to your .env file:\n");
  console.log(`  UPLIFT_ASSISTANT_ID=${data.realtimeAssistantId}\n`);
}

setupAssistant().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
