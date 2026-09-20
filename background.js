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

async function* readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const takeTokens = function* (text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      const token = json?.choices?.[0]?.delta?.content;
      if (token) yield token;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      yield* takeTokens(buffer);
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    yield* takeTokens(parts.join("\n"));
  }
}

async function explainTextStream({ text, level, freeform }, signal, onChunk) {
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
    signal,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.4,
      stream: true,
      messages: [
        {
          role: "user",
          content: buildPrompt(text.trim(), level, freeform?.trim()),
        },
      ],
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data?.error?.message || `API request failed (${response.status})`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("The model returned an empty response.");
  }

  for await (const token of readSse(response)) {
    onChunk(token);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "elix-explain") {
    return;
  }

  const abort = new AbortController();
  let open = true;

  function post(payload) {
    if (!open) return;
    try {
      port.postMessage(payload);
    } catch {
      open = false;
      abort.abort();
    }
  }

  port.onDisconnect.addListener(() => {
    open = false;
    abort.abort();
  });

  port.onMessage.addListener((message) => {
    if (message?.type !== "ELIX_EXPLAIN") {
      return;
    }

    explainTextStream(message.payload, abort.signal, (text) => {
      post({ type: "chunk", text });
    })
      .then(() => {
        if (abort.signal.aborted) return;
        post({ type: "done" });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || abort.signal.aborted) return;
        post({
          type: "error",
          error: error?.message || String(error),
        });
      });
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
