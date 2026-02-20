import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => {
  res.send("LegalBot running ✅");
});

// Extract text safely from OpenAI response
function extractText(data) {
  if (!data) return null;

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const parts = [];
    for (const o of data.output) {
      if (!Array.isArray(o.content)) continue;
      for (const c of o.content) {
        if (typeof c.text === "string") parts.push(c.text);
        if (typeof c.value === "string") parts.push(c.value);
      }
    }
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }

  return null;
}

app.post("/slack/events", async (req, res) => {

  // Slack verification
  if (req.body?.type === "url_verification") {
    return res.status(200).send({ challenge: req.body.challenge });
  }

  const event = req.body?.event;

  // ALWAYS ACK immediately so Slack doesn’t timeout
  res.sendStatus(200);

  if (!event || event.bot_id) return;
  if (event.type !== "message") return;
  if (event.subtype) return;

  const userMessage = event.text?.trim();
  if (!userMessage) return;

  const channel = event.channel;
  const thread_ts = event.ts;

  try {

    const ai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",   // safe default model
        input: [
          {
            role: "system",
            content: `
You are LegalBot, an internal legal/compliance assistant.

You provide informational guidance only.
Never provide definitive legal advice.
If high risk, recommend escalation to compliance/legal team.
Be concise and professional.
`
          },
          {
            role: "user",
            content: userMessage
          }
        ]
      })
    });

    const data = await ai.json();

    // THIS IS THE IMPORTANT LOGGING
    console.log("OPENAI FULL RESPONSE:", JSON.stringify(data, null, 2));

    if (!ai.ok || data?.error) {
      console.error("OpenAI ERROR:", JSON.stringify(data, null, 2));
    }

    const reply =
      extractText(data) ||
      "I couldn't generate a response. Please escalate to Compliance/Legal.";

    const finalText =
      "⚠️ Not legal advice. Consult compliance before acting.\n\n" + reply;

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channel,
        text: finalText,
        thread_ts
      })
    });

  } catch (err) {
    console.error("LegalBot runtime error:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LegalBot listening on port ${PORT}`);
});
