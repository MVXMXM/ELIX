const DEFAULTS = {
  apiKey: "",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function buildPrompt(text, level, freeform) {
  const audienceLine = freeform
    ? `Explain the highlighted text for this persona/audience: ${freeform}`
    : `Explain this like the reader is ${level} years old.`;

  return [
    "You are ELIX, a clear and friendly explainer.",
    audienceLine,
    "Adopt that persona's likely knowledge, tone, and concerns.",
    "Keep the answer focused on the highlighted text.",
    "Use plain language. Avoid jargon unless you briefly define it.",
    "Be concise: a short paragraph or a few short bullets.",
    "",
    "Highlighted text:",
    text,
  ].join("\n");
}

async function explainText({ text, level, freeform }) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error("Add your OpenAI API key in ELIX options first.");
  }

  if (!text?.trim()) {
    throw new Error("No text selected.");
  }

  const baseUrl = settings.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content: buildPrompt(text.trim(), level, freeform?.trim()),
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message || `API request failed (${response.status})`;
    throw new Error(message);
  }

  const explanation = data?.choices?.[0]?.message?.content?.trim();
  if (!explanation) {
    throw new Error("The model returned an empty response.");
  }

  return explanation;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ELIX_EXPLAIN") {
    return;
  }

  explainText(message.payload)
    .then((explanation) => sendResponse({ ok: true, explanation }))
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || String(error) })
    );

  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
