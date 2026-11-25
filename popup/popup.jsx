import { Switch } from "@mvxmxm/maxos";
import "@mvxmxm/maxos/switch.css";
import "@mvxmxm/maxos/menu.css";
import { createRoot } from "react-dom/client";

const home = document.querySelector("#home");
const settings = document.querySelector("#settings");
const addApiKey = document.querySelector("#add-api-key");
const openSettings = document.querySelector("#open-settings");
const backSettings = document.querySelector("#back-settings");
const fields = settings.querySelector("fieldset");
const model = fields.querySelector('[name="model"]');
const editApiKey = document.querySelector("#edit-api-key");
const deleteApiKey = document.querySelector("#delete-api-key");
const maskedApiKey = document.querySelector("#masked-api-key");
const embedded = window.parent !== window;
const images = createRoot(document.querySelector("#images-control"));
const status = document.querySelector("#status");
const defaults = { model: "gpt-6-luna", mediaEnabled: false };

let savedSettings;
function renderImagesSwitch(checked = savedSettings.mediaEnabled === true, disabled = false) {
  images.render(
    <Switch id="images-switch" checked={checked} disabled={disabled} onCheckedChange={async next => {
      renderImagesSwitch(next, true);
      await savePreference("mediaEnabled", next);
      renderImagesSwitch();
    }} />
  );
}

document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;

function showHome() {
  settings.hidden = true;
  home.hidden = false;
  status.textContent = "";
  (openSettings.hidden ? addApiKey : openSettings).focus();
}

async function refreshKeyActions() {
  const abbreviation = await chrome.runtime.sendMessage({ type: "ELIX_API_KEY_STATUS" });
  const hasApiKey = typeof abbreviation === "string" && abbreviation.length > 0;
  maskedApiKey.textContent = hasApiKey ? abbreviation : "";
  const focused = document.activeElement;
  home.querySelector(".instructions").textContent = hasApiKey
    ? "Highlight text on the page, then click ELIX."
    : "Please add an API key to start using ELIX.";
  openSettings.hidden = !hasApiKey;
  addApiKey.hidden = hasApiKey;
  if (!hasApiKey && !settings.hidden) {
    showHome();
  } else if (focused === addApiKey && hasApiKey) {
    openSettings.focus();
  } else if (focused === openSettings && !hasApiKey) {
    addApiKey.focus();
  }
}

openSettings.addEventListener("click", () => {
  home.hidden = true;
  settings.hidden = false;
  status.textContent = "";
  backSettings.focus();
});

async function openKeyEditor(event) {
  const button = event.currentTarget;
  const remove = button === deleteApiKey;
  if (!embedded) {
    location.assign(remove ? "api-key.html?remove=1" : "api-key.html");
    return;
  }

  button.disabled = true;
  try {
    const opened = await chrome.runtime.sendMessage({ type: "ELIX_OPEN_API_KEY", remove });
    if (!opened) throw new Error("Native popup unavailable");
  } catch {
    status.textContent = "Could not open the API key editor. Try again.";
  } finally {
    button.disabled = false;
  }
}

addApiKey.addEventListener("click", openKeyEditor);
editApiKey.addEventListener("click", openKeyEditor);
deleteApiKey.addEventListener("click", openKeyEditor);

backSettings.addEventListener("click", showHome);

async function loadSettings() {
  try {
    savedSettings = await chrome.storage.sync.get(defaults);
    model.value = savedSettings.model;
    if (!model.value) model.value = defaults.model;
    savedSettings.model = model.value;
    renderImagesSwitch();
    fields.disabled = false;
    await refreshKeyActions();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.apiKey) {
        refreshKeyActions().catch(() => {
          status.textContent = "Could not check the API key. Reopen ELIX to try again.";
        });
      }
    });
  } catch {
    status.textContent = "Could not load settings. Reopen ELIX to try again.";
  }
}

async function savePreference(name, value) {
  status.textContent = "";
  try {
    await chrome.storage.sync.set({ [name]: value });
    savedSettings[name] = value;
  } catch {
    status.textContent = "Could not save settings. Try again.";
  }
}

model.addEventListener("change", async () => {
  model.disabled = true;
  await savePreference("model", model.value);
  model.value = savedSettings.model;
  model.disabled = false;
});

async function initialize() {
  if (embedded) {
    const allowed = await chrome.runtime.sendMessage({
      type: "ELIX_AUTHORIZE_PANEL",
      token: location.hash.slice(1),
    }).catch(() => false);
    if (!allowed) return;

    document.documentElement.classList.add("embedded");
    const panel = document.querySelector(".maxos-menu");
    const observer = new ResizeObserver(() => {
      const { marginTop, marginBottom } = getComputedStyle(panel);
      const height = Math.ceil(panel.getBoundingClientRect().height +
        parseFloat(marginTop) + parseFloat(marginBottom));
      window.parent.postMessage({ type: "ELIX_PANEL_HEIGHT", height }, "*");
    });
    observer.observe(panel);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        window.parent.postMessage({ type: "ELIX_CLOSE_PANEL" }, "*");
      }
    });
  }

  await loadSettings();
}

initialize();
