const examples = {
  5: "Pick some words you don’t understand. ELIX tells you what they mean in simple words, right where you’re reading.",
  10: "Highlight something confusing. ELIX explains it on the same page, and you can choose how much detail you want.",
  15: "ELIX uses what you highlight to explain it alongside the original text. Pick a level to adjust the vocabulary and depth.",
  20: "ELIX uses the selected passage as input and displays its explanation in context. The chosen level sets the assumed background knowledge and amount of detail.",
};

function connectExample() {
  let onMessage;
  let timer;
  return {
    onMessage: { addListener(listener) { onMessage = listener; } },
    onDisconnect: { addListener() {} },
    disconnect() { clearTimeout(timer); },
    postMessage({ payload: { level, freeform } }) {
      const example = level === "other"
        ? `For ${freeform}: Imagine pointing to a sentence and asking someone beside you what it means. ELIX gives you an explanation on the page, at the level you pick.`
        : examples[level];
      timer = setTimeout(() => {
        onMessage({ type: "chunk", text: example });
        onMessage({ type: "done" });
      }, 300);
    },
  };
}

export async function createDemoBrowser() {
  const response = await fetch(new URL("../manifest.json", import.meta.url));
  const manifest = await response.json();
  const preferences = {};

  return {
    runtime: {
      getManifest: () => manifest,
      connect: connectExample,
    },
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...preferences }),
        set: async (patch) => Object.assign(preferences, patch),
      },
      onChanged: { addListener() {} },
    },
  };
}
