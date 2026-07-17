require("dotenv").config();
const { assistantConfig } = require("../server/assistant-config");

const UPLIFT_API = "https://api.upliftai.org/v1";

async function updateAssistant() {
  const apiKey = process.env.UPLIFT_API_KEY;
  const assistantId = process.env.UPLIFT_ASSISTANT_ID;

  if (!apiKey || !assistantId) {
    console.error("Set UPLIFT_API_KEY and UPLIFT_ASSISTANT_ID in .env first.");
    process.exit(1);
  }

  console.log(`Updating assistant ${assistantId}...\n`);

  const res = await fetch(`${UPLIFT_API}/realtime-assistants/${assistantId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config: assistantConfig.config,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Uplift API error (${res.status}): ${body}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log("Assistant updated successfully!");
  console.log(`  Greeting: ${data.config.agent.greetingInstructions}`);
}

updateAssistant().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
