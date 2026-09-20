const DEFAULTS = {
  apiKey: "",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  defaultLevel: "5",
  defaultFreeform: "",
};

const LEVELS = ["5", "10", "15", "20", "other"];

const form = document.getElementById("settings-form");
const status = document.getElementById("status");
const freeformWrap = document.getElementById("default-freeform-wrap");

function selectedLevel() {
  const value = form.elements.defaultLevel.value;
  return LEVELS.includes(value) ? value : DEFAULTS.defaultLevel;
}

function syncFreeformVisibility() {
  const isOther = selectedLevel() === "other";
  freeformWrap.hidden = !isOther;
  form.defaultFreeform.required = isOther;
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  form.apiKey.value = settings.apiKey || "";
  form.model.value = settings.model || DEFAULTS.model;
  form.baseUrl.value = settings.baseUrl || DEFAULTS.baseUrl;

  const level = LEVELS.includes(settings.defaultLevel)
    ? settings.defaultLevel
    : DEFAULTS.defaultLevel;
  const radio = form.querySelector(`input[name="defaultLevel"][value="${level}"]`);
  if (radio) radio.checked = true;
  form.defaultFreeform.value = settings.defaultFreeform || "";
  syncFreeformVisibility();
}

form.addEventListener("change", (event) => {
  if (event.target?.name === "defaultLevel") {
    syncFreeformVisibility();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const apiKey = form.apiKey.value.trim();
  const model = form.model.value.trim() || DEFAULTS.model;
  const baseUrl = form.baseUrl.value.trim() || DEFAULTS.baseUrl;
  const defaultLevel = selectedLevel();
  const defaultFreeform = form.defaultFreeform.value.trim();

  if (defaultLevel === "other" && !defaultFreeform) {
    status.textContent = "Describe the Other persona first.";
    form.defaultFreeform.focus();
    return;
  }

  await chrome.storage.sync.set({
    apiKey,
    model,
    baseUrl,
    defaultLevel,
    defaultFreeform: defaultLevel === "other" ? defaultFreeform : "",
  });
  status.textContent = "Saved.";
});

loadSettings();
