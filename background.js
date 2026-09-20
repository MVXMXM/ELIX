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
  const persona = freeform?.trim();

  if (persona) {
    return [
      "You are ELIX. Define the highlighted text fully as this persona:",
      persona,
      "Commit. Take their language, nationality, species, job, era, or medium as the actual output, not as flavor sprinkled on English.",
      "If a language or nationality is named, write the entire definition in that language.",
      "If an animal or nonhuman is named, write in their voice (meows, barks, chirps, beeps) so a human can still recover the meaning.",
      "Bend tone, vocabulary, and form as far as the persona requires. Be willing to be strange, comic, or lyrical.",
      "Do not add a translation, stage direction, or note about what you are doing.",
      "Do not repeat or quote the highlighted wording.",
      "One prominent sense only. Plain text. No markdown, headings, lists, or labels.",
      "Write only the in-persona definition.",
      "",
      "Highlighted text:",
      text,
    ].join("\n");
  }

  const childReader = Number(level) <= 10;
  const voice = childReader
    ? [
        "Voice: a children's dictionary for that age. Simple, concrete, kind.",
        "Keep the kid-friendly clarity of a picture-glossary: short words, familiar things, no baby talk and no lecture.",
        "Still a definition, not a story, chat, or pep talk.",
      ]
    : [
        "Voice: lexical, succinct, academic. Declarative sentences only.",
        "Scale the concepts and vocabulary to that reader's mental model.",
      ];

  return [
    "You are ELIX. Write a dictionary gloss of the highlighted text.",
    `Reader: a ${level}-year-old.`,
    ...voice,
    "Do not address the reader. No questions, asides, prefaces, or chatty framing.",
    "Do not use phrases such as \"imagine\", \"basically\", \"this means\", or \"in simple terms\".",
    "Do not repeat, quote, or italicize the highlighted wording; the reader can already see it.",
    "Give only the single most prominent sense. Never list alternate meanings or numbered senses.",
    "One or two sentences of plain text. No markdown, headings, lists, or labels.",
    "Write only the definition.",
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

function openOptions() {
  chrome.runtime.openOptionsPage();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ELIX_OPEN_OPTIONS") {
    openOptions();
  }
});

chrome.action.onClicked.addListener(() => {
  openOptions();
});
