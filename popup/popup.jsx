import { SettingsPanel, SettingsPanelControlRow, SettingsPanelDropdownRow, Switch } from "@mvxmxm/maxos";
import "@mvxmxm/maxos/switch.css";
import "@mvxmxm/maxos/menu.css";
import "@mvxmxm/maxos/settings-panel.css";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const home = document.querySelector("#home");
const settings = document.querySelector("#settings");
const addApiKey = document.querySelector("#add-api-key");
const embedded = window.parent !== window;
const settingsRoot = createRoot(settings);
const status = document.querySelector("#status");
const models = [
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
];
const defaults = { model: models[0].id, mediaEnabled: false };

let savedSettings;

function Settings({ abbreviation }) {
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState(savedSettings.model);
  const savingModel = useRef(false);
  const [mediaEnabled, setMediaEnabled] = useState(savedSettings.mediaEnabled === true);
  const [savingMedia, setSavingMedia] = useState(false);

  async function changeMediaEnabled(next) {
    if (savingMedia) return;
    setMediaEnabled(next);
    setSavingMedia(true);
    await savePreference("mediaEnabled", next);
    setMediaEnabled(savedSettings.mediaEnabled === true);
    setSavingMedia(false);
  }

  return (
    <SettingsPanel aria-label="Settings">
      <SettingsPanelControlRow
        label="API key"
        icon={
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/>
            <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>
          </svg>
        }
      >
        <span className="api-key-row">
          <code id="masked-api-key" aria-label="Masked API key">{abbreviation}</code>
          <button className="key-action" type="button" aria-label="Edit API Key" title="Edit API Key" onClick={openKeyEditor}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3a2.8 2.8 0 0 1 4 4L8 19l-5 2 2-5Z" /><path d="m14.5 4.5 4 4" /></svg>
          </button>
          <button className="key-action" type="button" aria-label="Delete API Key" title="Delete API Key" onClick={event => openKeyEditor(event, true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7m4-7v7" /></svg>
          </button>
        </span>
      </SettingsPanelControlRow>
      <SettingsPanelDropdownRow
        label="Model"
        labelId="model-label"
        icon={<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 3v3m6-3v3m-6 12v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3" /></svg>}
        items={models}
        value={model}
        open={modelOpen}
        onOpenChange={open => {
          if (!open || !savingModel.current) setModelOpen(open);
        }}
        onChange={async next => {
          if (savingModel.current) return;
          savingModel.current = true;
          settings.querySelector(".maxos-settings-panel-dropdown")?.focus();
          await savePreference("model", next);
          setModel(savedSettings.model);
          savingModel.current = false;
        }}
      />
      <SettingsPanelControlRow label="Media input (alpha)" labelId="media-label" onClick={() => changeMediaEnabled(!mediaEnabled)} icon={<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="1" /><path d="m4 17 5-4 4 3 4-5 4 5" /></svg>}>
        <Switch aria-labelledby="media-label" checked={mediaEnabled} disabled={savingMedia} onCheckedChange={changeMediaEnabled} />
      </SettingsPanelControlRow>
    </SettingsPanel>
  );
}

document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;

async function refreshKeyActions() {
  const abbreviation = await chrome.runtime.sendMessage({ type: "ELIX_API_KEY_STATUS" });
  const hasApiKey = typeof abbreviation === "string" && abbreviation.length > 0;
  const focused = document.activeElement;
  home.querySelector(".instructions").textContent = hasApiKey
    ? "Highlight any text on your screen for an in-situ explanation."
    : "Please add an API key to get started.";
  addApiKey.hidden = hasApiKey;
  settings.hidden = !hasApiKey;
  settingsRoot.render(hasApiKey ? <Settings abbreviation={abbreviation} /> : null);
  if (!hasApiKey && settings.contains(focused)) addApiKey.focus();
  if (hasApiKey && focused === addApiKey) home.querySelector("a").focus();
}

async function openKeyEditor(event, remove = false) {
  const button = event.currentTarget;
  status.textContent = "";
  button.disabled = true;
  try {
    const opened = await chrome.runtime.sendMessage({ type: "ELIX_OPEN_API_KEY", remove });
    if (!opened) throw new Error("API key editor unavailable");
  } catch {
    status.textContent = "Could not open the API key editor. Try again.";
  } finally {
    button.disabled = false;
  }
}

addApiKey.addEventListener("click", openKeyEditor);

async function loadSettings() {
  try {
    savedSettings = await chrome.storage.sync.get(defaults);
    if (!models.some(({ id }) => id === savedSettings.model)) savedSettings.model = defaults.model;
    await refreshKeyActions();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && (changes.apiKey || changes.dataConsent)) {
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

async function initialize() {
  if (embedded) {
    const allowed = await chrome.runtime.sendMessage({
      type: "ELIX_AUTHORIZE_PANEL",
      token: location.hash.slice(1),
    }).catch(() => false);
    if (!allowed) return;

    document.documentElement.classList.add("embedded");
    const content = document.body;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(content.getBoundingClientRect().height);
      window.parent.postMessage({ type: "ELIX_PANEL_HEIGHT", height }, "*");
    });
    observer.observe(content);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !settings.querySelector('[aria-expanded="true"]')) {
        event.preventDefault();
        window.parent.postMessage({ type: "ELIX_CLOSE_PANEL" }, "*");
      }
    });
  }

  await loadSettings();
}

initialize();
