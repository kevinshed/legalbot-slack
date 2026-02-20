import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Simple health check
app.get("/", (req, res) => {
  res.send("LegalBot running ✅");
});

// Helper: pull text out of Responses API payload safely
function extractResponseText(data) {
  if (!data) return null;

  // Best-case
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Fallback: walk output blocks
  const outputs = Array.isArray(data.output) ? data.output : [];
  const parts = [];

  for (const out of outputs) {
    const content = Array.isArray(out.content) ? out.content : [];
    for (const c of content) {
      // Common shapes
      if (typeof c?.text === "string" && c.text.trim()) parts.push(c.text.trim());
      if (typeof c?.value === "string" && c.value.trim()) parts.push(c.value.trim());
      if (typeof c?.content === "string" && c.content.trim()) parts.push(c.content.trim());

      // Sometimes nested
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) {
        parts.push(c.text.trim());
      }
    }
  }

  const joined = parts.join("\n\n").trim();
  return joined || null;
}

app.post("/slack/events", async (req, res) => {
  // Slack URL verification challenge
  if (req.body?.type === "url_verification") {
    return res.status(200).send({ challenge: req.body.challenge });
  }

  const event = req.body?.event;

  // Always ACK quickly so Slack doesn't timeout/retry
  res.sendStatus(200);

  // Ignore non-events / bot messages
  if (!event || event.bot_id) return;

  // Only respond to messages (and ignore edits, joins, etc.)
  if (event.type !== "message") return;
  if (event.subtype) return;

  const userMessage = (event.text || "").trim();
  if (!userMessage) return;

  const channel = event.channel;
  const thread_ts = event.ts;

  try {
    // Call OpenAI (use a model your API key is very likely to have)
    const aiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `
You are LegalBot, an internal legal/compliance assistant for a telehealth clinic.

Rules:
- Provide general informational guidance only (not legal advice).
- If high-risk (lawsuit/subpoena/DEA/state board complaint/HIPAA breach/termination),
  do not advise and instruct escalation to Compliance/Legal.
- Be concise, practical, and structured (bullets when helpful).
- If unclear, ask 1-2 clarifying questions.
`,
          },
          { role: "user", content: userMessage },
        ],
      }),
    });

    const data = await aiResp.json();

    // Log errors/details to Render logs (helps debug)
    if (!aiResp.ok || data?.error) {
      console.error("OpenAI HTTP status:", aiResp.status);
      console.error("OpenAI error payload:", JSON.stringify(data, null, 2));
    }

    const reply =
      extractResponseText(data) ||
      "I couldn't generate a response. Please escalate to Compliance/Legal.";

    const finalText =
      "⚠️ Not legal advice. Consult compliance before acting.\n\n" + reply;

    // Post back to Slack in a thread
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: finalText,
        thread_ts,
      }),
    });

    const slackData = await slackResp.json();
    if (!slackData.ok) {
      console.error("Slack postMessage error:", JSON.stringify(slackData, null, 2));
    }
  } catch (err) {
    console.error("LegalBot runtime error:", err);

    // Try to notify in Slack if something blows up
    try {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: event.channel,
          text:
            "⚠️ Not legal advice. Consult compliance before acting.\n\nLegalBot hit an internal error generating a response. Please try again or escalate to Compliance/Legal.",
          thread_ts: event.ts,
        }),
      });
    } catch (e) {
      console.error("Failed to post Slack fallback message:", e);
    }
  }
});

// Render sets PORT dynamically; do NOT hardcode 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LegalBot listening on port ${PORT}`);
});
