import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => {
  res.send("LegalBot running");
});

app.post("/slack/events", async (req, res) => {

  if (req.body.type === "url_verification") {
    return res.send({ challenge: req.body.challenge });
  }

  const event = req.body.event;

  if (!event || event.bot_id) {
    return res.sendStatus(200);
  }

  const userMessage = event.text;
  const channel = event.channel;
  const thread_ts = event.ts;

  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.2",
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

// Most reliable: use output_text if available, otherwise fallback
const reply =
  data?.output_text
  || data?.output?.[0]?.content?.[0]?.text
  || data?.output?.[0]?.content?.[0]?.value
  || "I couldn't generate a response. Please escalate to Compliance/Legal.";

// Optional: log once to inspect shape in Render logs
console.log("OpenAI response keys:", Object.keys(data || {}));

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      channel,
      text: "⚠️ Not legal advice. Consult compliance before acting.\n\n" + reply,
      thread_ts
    })
  });

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("LegalBot running");
});
