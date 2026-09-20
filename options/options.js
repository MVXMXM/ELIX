const DEFAULTS = {
  apiKey: "",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
};

const form = document.getElementById("settings-form");
const status = document.getElementById("status");

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  form.apiKey.value = settings.apiKey || "";
  form.model.value = settings.model || DEFAULTS.model;
  form.baseUrl.value = settings.baseUrl || DEFAULTS.baseUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const apiKey = form.apiKey.value.trim();
  const model = form.model.value.trim() || DEFAULTS.model;
  const baseUrl = form.baseUrl.value.trim() || DEFAULTS.baseUrl;

  await chrome.storage.sync.set({ apiKey, model, baseUrl });
  status.textContent = "Saved.";
});

loadSettings();
