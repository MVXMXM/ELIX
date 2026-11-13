(() => {
  const HOST_ID = "elix-root";
  const version = chrome.runtime.getManifest?.()?.version || "";
  const LEVELS = ["5", "10", "15", "20"];
  const MODELS = ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"];
  const DEFAULT_LEVEL = "5";
  const DEFAULT_MODEL = "gpt-6-luna";
  const OVERLAY_FADE_MS = 220;
  // In-page highlight menus mount after mouseup; wait before placing the chip.
  const MENU_WAIT_MS = 220;
  const MENU_LATE_MS = 180;
  const TIP_GAP = 8;
  const MENU_PROXIMITY = 64;
  const VIEW_MARGIN = 8;
  // A long highlight already carries its meaning. Shorter ones get a passage.
  const CONTEXT_SKIP_AT = 280;
  const CONTEXT_CAP = 400;
  const CONTEXT_FETCH = 700;
  const CONTEXT_WIDEN_BELOW = 80;
  const CONTEXT_MIN_EXTRA = 12;
  const CONTEXT_BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dd, dt, pre, caption";

  let host = null;
  let shadow = null;
  let promptBar = null;
  let output = null;
  let scrim = null;
  let veil = null;
  let marks = null;
  let focusCatcher = null;
  let tip = null;
  let lastText = "";
  let lastImage = "";
  let mediaEnabled = false;
  let mediaTarget = null;
  let mediaHideTimer = null;
  let captureSession = null;
  let captureLayer = null;
  let capturePreview = null;
  let lastContext = "";
  let lastRect = null;
  let lastHoles = [];
  let lastRange = null;
  let showTimer = null;
  let menuObserver = null;
  let watchedNodes = [];
  let tipSize = { width: 56, height: 28 };
  let scrollLocked = false;
  let pinningScroll = false;
  let savedScrollX = 0;
  let savedScrollY = 0;
  let previousScrollLockStyles = {
    htmlOverflow: "",
    bodyOverflow: "",
    htmlScrollbarGutter: "",
    bodyPaddingInlineEnd: "",
  };
  let explainPort = null;
  let overlayFadeTimer = null;
  let explainDefaults = { defaultLevel: DEFAULT_LEVEL, defaultFreeform: "" };
  let settingsState = { apiKey: "", model: DEFAULT_MODEL, mediaEnabled: false };
  let hasApiKey = false;

  function isEventFromUi(event) {
    if (!host) return false;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.includes(host) || event.target === host;
  }

  function isOverlayOpen() {
    return Boolean(promptBar && !promptBar.classList.contains("hidden"));
  }

  function isTipOpen() {
    return Boolean(tip && !tip.classList.contains("hidden"));
  }

  function overlayField(event) {
    if (!promptBar) return null;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const fromPath = path.find((node) => node instanceof Element && node.matches("input, select, textarea"));
    const active = shadow?.activeElement;
    const field = fromPath || (active instanceof Element && active.matches("input, select, textarea") ? active : null);
    if (!field || !promptBar.contains(field)) return null;
    return field;
  }

  function isOtherInputEvent(event) {
    if (!promptBar) return false;
    const input = promptBar.querySelector(".other input");
    if (!input) return false;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.includes(input) || shadow?.activeElement === input;
  }

  function isScrollKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return (
      event.key === " " ||
      event.key === "PageDown" ||
      event.key === "PageUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End"
    );
  }

  function insertOtherSpace() {
    const input = promptBar?.querySelector(".other input");
    if (!input || input.disabled) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(" ", start, end, "end");
  }

  function stopHostKeys(event) {
    if (event.type === "keydown" && event.key === "Escape" && (captureSession || isOverlayOpen())) {
      event.preventDefault();
      event.stopPropagation();
      if (captureSession) {
        cancelMediaCapture();
        return;
      }
      if (settingsEl()?.classList.contains("open")) {
        setSettingsOpen(false);
        return;
      }
      hideOverlay();
      return;
    }

    if (!isOverlayOpen()) {
      return;
    }
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    const field = overlayField(event);
    if (field && !field.matches(".other input")) return;

    // Enter and Space are composed, so a page capture listener would act on
    // them before the Other field's own handler runs.
    if (isOtherInputEvent(event) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type === "keydown") {
        submitOther();
      }
      return;
    }

    if (isOtherInputEvent(event) && event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type === "keydown") {
        insertOtherSpace();
      }
      return;
    }

    if (!isOtherInputEvent(event) && isScrollKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  function preventPageScroll(event) {
    if (isEventFromUi(event)) {
      return;
    }
    event.preventDefault();
  }

  function pinScroll() {
    if (!scrollLocked || pinningScroll) {
      return;
    }
    if (window.scrollX === savedScrollX && window.scrollY === savedScrollY) {
      return;
    }
    pinningScroll = true;
    window.scrollTo(savedScrollX, savedScrollY);
    pinningScroll = false;
  }

  function syncOverlayToSelection() {
    if (!isOverlayOpen() || !lastRange) return;
    try {
      const rect = boxFromRect(lastRange.getBoundingClientRect());
      if (!rect.width && !rect.height) return;
      const holes = [...lastRange.getClientRects()]
        .map(boxFromRect)
        .filter((box) => box.width && box.height);
      lastRect = rect;
      lastHoles = holes.length ? holes : [rect];
      updateSpotlight();
      positionOverlay(lastRect);
    } catch {
      // Range can detach if the host page rewrites the highlighted nodes.
    }
  }

  function getRootScrollbarWidth() {
    return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  }

  function supportsStableScrollbarGutter() {
    return typeof CSS !== "undefined" && CSS.supports?.("scrollbar-gutter: stable");
  }

  function lockScroll() {
    if (scrollLocked) {
      return;
    }

    scrollLocked = true;
    savedScrollX = window.scrollX;
    savedScrollY = window.scrollY;
    const rootClientWidth = document.documentElement.clientWidth;
    const scrollbarWidth = getRootScrollbarWidth();
    const canReserveScrollbarGutter = supportsStableScrollbarGutter();
    previousScrollLockStyles = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      htmlScrollbarGutter: document.documentElement.style.scrollbarGutter,
      bodyPaddingInlineEnd: document.body.style.paddingInlineEnd,
    };

    if (
      scrollbarWidth > 0 &&
      canReserveScrollbarGutter &&
      !/\bstable\b/.test(previousScrollLockStyles.htmlScrollbarGutter)
    ) {
      document.documentElement.style.scrollbarGutter = "stable";
    }
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const layoutExpansion = document.documentElement.clientWidth - rootClientWidth;
    if (scrollbarWidth > 0 && !canReserveScrollbarGutter && layoutExpansion > 0) {
      const padding = getComputedStyle(document.body).paddingInlineEnd;
      document.body.style.paddingInlineEnd = `calc(${padding} + ${layoutExpansion}px)`;
    }

    document.addEventListener("wheel", preventPageScroll, { passive: false });
    document.addEventListener("touchmove", preventPageScroll, { passive: false });
  }

  function unlockScroll() {
    if (!scrollLocked) {
      return;
    }

    scrollLocked = false;
    document.documentElement.style.overflow = previousScrollLockStyles.htmlOverflow;
    document.body.style.overflow = previousScrollLockStyles.bodyOverflow;
    document.documentElement.style.scrollbarGutter =
      previousScrollLockStyles.htmlScrollbarGutter;
    document.body.style.paddingInlineEnd = previousScrollLockStyles.bodyPaddingInlineEnd;
    document.removeEventListener("wheel", preventPageScroll);
    document.removeEventListener("touchmove", preventPageScroll);
    window.scrollTo(savedScrollX, savedScrollY);
  }

  function ensureUi() {
    if (host && document.documentElement.contains(host)) {
      return;
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    host.style.top = "0";
    host.style.left = "0";
    host.style.width = "0";
    host.style.height = "0";

    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }

        .scrim {
          position: fixed;
          inset: 0;
          pointer-events: none;
          cursor: default;
        }

        .veil {
          position: fixed;
          inset: 0;
          pointer-events: auto;
          background: rgba(255, 255, 255, 0);
          backdrop-filter: blur(0);
          -webkit-backdrop-filter: blur(0);
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-size: 100% 100%;
          mask-size: 100% 100%;
          -webkit-mask-source-type: luminance;
          mask-mode: luminance;
          transition:
            background ${OVERLAY_FADE_MS}ms ease,
            backdrop-filter ${OVERLAY_FADE_MS}ms ease,
            -webkit-backdrop-filter ${OVERLAY_FADE_MS}ms ease;
        }

        .scrim.open .veil {
          background: rgba(255, 255, 255, 0.58);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .marks {
          position: fixed;
          inset: 0;
          pointer-events: none;
        }

        .mark {
          position: fixed;
          background: rgba(232, 196, 104, 0.5);
        }

        .focus-catcher {
          position: fixed;
          background: transparent;
        }

        .prompt-bar,
        .output {
          position: fixed;
          z-index: 1;
          color: #111;
          font: 14px/1.4 "IBM Plex Sans", "Segoe UI", sans-serif;
          opacity: 0;
          transform: translateY(4px);
          transition:
            opacity ${OVERLAY_FADE_MS}ms ease,
            transform ${OVERLAY_FADE_MS}ms ease;
        }

        .prompt-bar.open,
        .output.open {
          opacity: 1;
          transform: none;
        }

        .prompt-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 10px;
          max-width: min(560px, calc(100vw - 24px));
        }

        .prompt {
          margin: 0;
          color: #111;
          font: 600 14px/1.3 "IBM Plex Sans", "Segoe UI", sans-serif;
        }

        .choices {
          position: relative;
          display: flex;
          min-width: 0;
          max-width: 100%;
        }

        .levels {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          max-width: 100%;
        }

        .choices:has(.other.open) .levels {
          visibility: hidden;
        }

        button.level {
          appearance: none;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background: rgba(255, 255, 255, 0.55);
          color: #111;
          border-radius: 999px;
          padding: 6px 10px;
          font: 600 12px/1 "IBM Plex Sans", "Segoe UI", sans-serif;
          cursor: pointer;
        }

        button.level:hover {
          background: rgba(17, 17, 17, 0.06);
          border-color: #111;
        }

        button.icon {
          appearance: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          padding: 0;
          border: 1px solid rgba(17, 17, 17, 0.22);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.55);
          color: #111;
          cursor: pointer;
          flex: none;
        }

        button.icon:hover {
          background: rgba(17, 17, 17, 0.06);
          border-color: #111;
        }

        button.icon:focus-visible {
          outline: 2px solid #111;
          outline-offset: 2px;
        }

        button.level[aria-pressed="true"] {
          background: #111;
          color: #fff;
          border-color: #111;
        }

        button.level[aria-pressed="true"]:hover {
          background: #222;
        }

        button.level[data-action="other"] {
          max-width: min(11rem, calc(100vw - 15.5rem));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .other {
          display: none;
          position: absolute;
          inset: 0;
          align-items: center;
          gap: 6px;
        }

        .other.open { display: flex; }

        .settings {
          display: none;
          position: fixed;
          z-index: 2;
          flex-direction: column;
          gap: 8px;
          width: min(220px, calc(100vw - 16px));
          padding: 10px;
          border: 1px solid rgba(17, 17, 17, 0.14);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
          color: #111;
        }

        .settings.open { display: flex; }

        .settings-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: -2px -2px 0;
        }

        .settings-version {
          margin: 0;
          color: rgba(17, 17, 17, 0.45);
          font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
          letter-spacing: 0.04em;
        }

        .settings button.icon {
          width: 22px;
          height: 22px;
        }

        .setting {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
          min-width: 0;
          color: #111;
          font: 600 12px/1 "IBM Plex Sans", "Segoe UI", sans-serif;
        }

        .settings input,
        .settings select {
          width: 100%;
          height: 32px;
          min-width: 0;
          box-sizing: border-box;
          border-radius: 10px;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background: rgba(255, 255, 255, 0.72);
          color: #111;
          font: 12px/1.3 "IBM Plex Sans", "Segoe UI", sans-serif;
        }

        .settings input {
          padding: 0 10px;
        }

        .settings input[name="apiKey"] {
          -webkit-text-security: disc;
        }

        .settings input[name="apiKey"]::placeholder {
          -webkit-text-security: none;
        }

        .settings select {
          padding: 0 28px 0 10px;
          appearance: none;
          cursor: pointer;
          background-color: rgba(255, 255, 255, 0.72);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='none' stroke='%23111' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' d='M2.5 4.5 6 8l3.5-3.5'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
        }

        .settings input::placeholder {
          color: rgba(17, 17, 17, 0.45);
        }

        .check {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #111;
          font: 600 12px/1 "IBM Plex Sans", "Segoe UI", sans-serif;
          cursor: pointer;
        }

        .check input {
          flex: none;
          width: 14px;
          height: 14px;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 2px;
          background: transparent;
          accent-color: #111;
        }

        .other input {
          flex: 1 1 auto;
          width: 0;
          height: 26px;
          min-width: 0;
          border-radius: 999px;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background: rgba(255, 255, 255, 0.72);
          color: #111;
          padding: 0 10px;
          font: 12px/1.3 "IBM Plex Sans", "Segoe UI", sans-serif;
          text-overflow: ellipsis;
        }

        .other input::placeholder {
          color: rgba(17, 17, 17, 0.45);
        }

        .output {
          max-width: min(420px, calc(100vw - 24px));
          max-height: min(48vh, 420px);
          overflow: auto;
          font: 15px/1.5 "IBM Plex Sans", "Segoe UI", sans-serif;
        }

        .result, .error, .status {
          white-space: pre-wrap;
        }

        .error { color: #b42318; }
        .status { color: rgba(17, 17, 17, 0.5); }
        .result { color: #111; }

        .tip {
          position: fixed;
          appearance: none;
          border: 1px solid rgba(244, 241, 234, 0.12);
          background: #171a1d;
          color: #e8c468;
          font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 7px 10px;
          border-radius: 999px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          cursor: pointer;
          user-select: none;
        }

        .tip:hover {
          background: #22262b;
          border-color: rgba(232, 196, 104, 0.7);
        }

        @keyframes elix-tip-in {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: none; }
        }

        .tip:not(.hidden) {
          animation: elix-tip-in 140ms ease-out;
        }

        .hidden { display: none !important; }
      </style>

      <div class="scrim hidden" part="scrim">
        <div class="veil"></div>
        <div class="marks"></div>
      </div>
      <div class="focus-catcher hidden"></div>
      <button type="button" class="tip hidden" aria-label="Explain with ELIX">ELIX</button>

      <div class="prompt-bar hidden">
        <p class="prompt">Explain like I'm…</p>
        <div class="choices">
          <div class="levels"></div>
          <div class="other">
            <input type="text" aria-label="Persona or audience" placeholder="e.g. French / a cat / a tired parent" />
            <button type="button" class="icon" data-action="accept-other" aria-label="Accept">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3.5 8.5 6.5 11.5 12.5 4.5"/>
              </svg>
            </button>
            <button type="button" class="icon" data-action="close-other" aria-label="Cancel">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div class="output hidden">
        <div class="status hidden"></div>
        <div class="result hidden"></div>
        <div class="error hidden"></div>
      </div>
      <div class="settings">
        <div class="settings-top">
          <p class="settings-version">${version ? `v${version}` : ""}</p>
          <button type="button" class="icon" data-action="close-settings" aria-label="Close">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8"/>
            </svg>
          </button>
        </div>
        <label class="setting">
          <span>API key</span>
          <input type="text" name="apiKey" aria-label="API key" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="sk-..." />
        </label>
        <label class="setting">
          <span>Model</span>
          <select name="model" aria-label="Model">
            <option value="gpt-6-luna">GPT-6 Luna</option>
            <option value="gpt-6.1-terra">GPT-6.1 Terra</option>
            <option value="gpt-6.1-sol">GPT-6.1 Sol</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" name="mediaEnabled" />
          <span>Images</span>
        </label>
      </div>
    `;

    scrim = shadow.querySelector(".scrim");
    veil = shadow.querySelector(".veil");
    marks = shadow.querySelector(".marks");
    focusCatcher = shadow.querySelector(".focus-catcher");
    tip = shadow.querySelector(".tip");
    promptBar = shadow.querySelector(".prompt-bar");
    output = shadow.querySelector(".output");

    const levels = shadow.querySelector(".levels");

    for (const level of LEVELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "level";
      button.textContent = level;
      button.dataset.level = level;
      button.setAttribute("aria-pressed", "false");
      levels.appendChild(button);
    }

    const otherBtn = document.createElement("button");
    otherBtn.type = "button";
    otherBtn.className = "level";
    otherBtn.textContent = "Other";
    otherBtn.dataset.action = "other";
    otherBtn.setAttribute("aria-pressed", "false");
    otherBtn.setAttribute("aria-expanded", "false");
    levels.appendChild(otherBtn);

    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "icon";
    gear.dataset.action = "open-settings";
    gear.setAttribute("aria-label", "Settings");
    gear.setAttribute("aria-expanded", "false");
    gear.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
      '<circle cx="12" cy="12" r="3"/>' +
      "</g></svg>";
    levels.appendChild(gear);

    scrim.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    scrim.addEventListener("click", () => hideOverlay());

    focusCatcher.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    focusCatcher.addEventListener("click", () => hideOverlay());

    // Keep clicks in the overlay from placing a caret on the page.
    const swallowMouse = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    promptBar.addEventListener("mousedown", swallowMouse);
    output.addEventListener("mousedown", swallowMouse);

    promptBar.addEventListener("click", onPromptClick);

    for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    }

    const otherInput = promptBar.querySelector(".other input");
    const settings = shadow.querySelector(".settings");
    const keyInput = settings.querySelector('input[name="apiKey"]');
    const modelSelect = settings.querySelector('select[name="model"]');
    const mediaInput = settings.querySelector('input[name="mediaEnabled"]');
    otherInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      submitOther();
    });
    otherInput.addEventListener("keyup", (event) => event.stopPropagation());
    otherInput.addEventListener("keypress", (event) => event.stopPropagation());
    otherInput.addEventListener("focus", () => pinScroll());

    // Allow typing in the freeform field (mousedown preventDefault would block focus).
    otherInput.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    settings.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      if (!event.target.closest("input, select, textarea")) event.preventDefault();
    });
    settings.addEventListener("click", onPromptClick);
    keyInput.addEventListener("focus", () => pinScroll());
    keyInput.addEventListener("change", commitApiKey);
    keyInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      commitApiKey();
    });
    modelSelect.addEventListener("change", () => {
      persistSettings({ model: supportedModel(modelSelect.value) });
    });
    mediaInput.addEventListener("change", () => {
      persistSettings({ mediaEnabled: mediaInput.checked });
    });

    tip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    tip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (mediaTarget) startMediaCapture();
      else openOverlay();
    });

    document.documentElement.appendChild(host);
    measureTip();
  }

  function measureTip() {
    if (!tip) return;
    tip.classList.remove("hidden");
    tip.style.visibility = "hidden";
    tip.style.top = "0px";
    tip.style.left = "0px";
    tipSize = {
      width: Math.max(44, Math.ceil(tip.offsetWidth)),
      height: Math.max(24, Math.ceil(tip.offsetHeight)),
    };
    tip.style.visibility = "";
    tip.classList.add("hidden");
  }

  function holeFromRect(rect) {
    const top = Math.max(0, rect.top);
    const left = Math.max(0, rect.left);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);

    return {
      top,
      left,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function updateSpotlight() {
    const rects = (lastHoles.length ? lastHoles : lastRect ? [lastRect] : [])
      .map(holeFromRect)
      .filter((hole) => hole.width > 0 && hole.height > 0);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cuts = rects
      .map((hole) => {
        const top = Math.round(hole.top);
        const left = Math.round(hole.left);
        const width = Math.max(1, Math.round(hole.width));
        const height = Math.max(1, Math.round(hole.height));
        return `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="black"/>`;
      })
      .join("");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">` +
      `<rect width="100%" height="100%" fill="white"/>` +
      cuts +
      `</svg>`;
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    veil.style.webkitMaskImage = mask;
    veil.style.maskImage = mask;
    paintMarks(rects);

    const bounds = lastRect ? holeFromRect(lastRect) : rects[0];
    if (!bounds) return;

    Object.assign(focusCatcher.style, {
      top: `${Math.round(bounds.top)}px`,
      left: `${Math.round(bounds.left)}px`,
      width: `${Math.round(bounds.width)}px`,
      height: `${Math.round(bounds.height)}px`,
    });
  }

  function paintMarks(rects) {
    if (!marks) return;

    while (marks.children.length > rects.length) {
      marks.lastElementChild.remove();
    }

    rects.forEach((hole, index) => {
      let mark = marks.children[index];
      if (!mark) {
        mark = document.createElement("div");
        mark.className = "mark";
        marks.appendChild(mark);
      }
      Object.assign(mark.style, {
        top: `${Math.round(hole.top)}px`,
        left: `${Math.round(hole.left)}px`,
        width: `${Math.round(hole.width)}px`,
        height: `${Math.round(hole.height)}px`,
      });
    });
  }

  function clearPageSelection() {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
  }

  function fadeOpen(el) {
    if (!el) return;
    if (!el.classList.contains("hidden") && el.classList.contains("open")) {
      return;
    }
    el.classList.remove("hidden");
    el.classList.remove("open");
    void el.offsetWidth;
    el.classList.add("open");
  }

  function showStatus(text) {
    const status = output.querySelector(".status");
    const result = output.querySelector(".result");
    const error = output.querySelector(".error");
    status.textContent = text || "";
    status.classList.toggle("hidden", !text);
    result.classList.add("hidden");
    error.classList.add("hidden");
    if (text) {
      fadeOpen(output);
    } else {
      output.classList.remove("open");
      output.classList.add("hidden");
    }
  }

  function showResult(text) {
    const status = output.querySelector(".status");
    const result = output.querySelector(".result");
    const error = output.querySelector(".error");
    fadeOpen(output);
    status.classList.add("hidden");
    error.classList.add("hidden");
    result.textContent = text;
    result.classList.toggle("hidden", !text);
  }

  function showError(text) {
    const status = output.querySelector(".status");
    const result = output.querySelector(".result");
    const error = output.querySelector(".error");
    fadeOpen(output);
    status.classList.add("hidden");
    result.classList.add("hidden");
    error.textContent = text;
    error.classList.remove("hidden");
  }

  function abortExplain() {
    if (!explainPort) return;
    const port = explainPort;
    explainPort = null;
    try {
      port.disconnect();
    } catch {
      // Port may already be gone if the worker went idle mid-stream.
    }
  }

  function requestExplain(level, freeform) {
    if (!hasApiKey) {
      setSettingsOpen(true);
      return;
    }

    if (!lastText.trim() && !lastImage) {
      showError("No text or image captured from the selection.");
      return;
    }

    abortExplain();
    output.querySelector(".result").textContent = "";
    showStatus("Thinking…");

    let port;
    try {
      port = chrome.runtime.connect({ name: "elix-explain" });
    } catch (error) {
      showError(error?.message || String(error));
      return;
    }

    explainPort = port;
    let explanation = "";

    port.onMessage.addListener((message) => {
      if (port !== explainPort) return;

      if (message.type === "chunk") {
        explanation += message.text;
        showResult(explanation);
        return;
      }

      if (message.type === "done") {
        if (!explanation.trim()) {
          showError("The model returned an empty response.");
        }
        explainPort = null;
        try {
          port.disconnect();
        } catch {
          // Already closed after the final chunk.
        }
        return;
      }

      if (message.type === "error") {
        showError(message.error || "Something went wrong.");
        explainPort = null;
        try {
          port.disconnect();
        } catch {
          // Already closed after the error.
        }
      }
    });

    port.onDisconnect.addListener(() => {
      if (port !== explainPort) return;
      explainPort = null;
      const err = chrome.runtime.lastError?.message;
      if (err) showError(err);
    });

    port.postMessage({
      type: "ELIX_EXPLAIN",
      payload: { text: lastText, imageDataUrl: lastImage || undefined, context: lastContext, level, freeform },
    });
  }

  function normalizeLevel(level) {
    if (LEVELS.includes(String(level))) return String(level);
    if (level === "other") return "other";
    return DEFAULT_LEVEL;
  }

  function markSelectedLevel(level) {
    if (!promptBar) return;
    const current = normalizeLevel(level);
    promptBar.querySelectorAll("button.level").forEach((button) => {
      const selected =
        button.dataset.level === current ||
        (current === "other" && button.dataset.action === "other");
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  async function refreshExplainDefaults() {
    try {
      const stored = await chrome.storage.sync.get({
        defaultLevel: DEFAULT_LEVEL,
        defaultFreeform: "",
        apiKey: "",
        model: DEFAULT_MODEL,
        mediaEnabled: false,
      });
      explainDefaults = {
        defaultLevel: normalizeLevel(stored.defaultLevel),
        defaultFreeform: String(stored.defaultFreeform || ""),
      };
      settingsState = {
        apiKey: String(stored.apiKey || ""),
        model: supportedModel(stored.model),
        mediaEnabled: stored.mediaEnabled === true,
      };
      setMediaEnabled(settingsState.mediaEnabled);
      hasApiKey = Boolean(settingsState.apiKey.trim());
    } catch {
      // Keep the in-memory default if extension storage is unavailable.
    }

    if (isOverlayOpen()) {
      startDefaultExplain();
    }
  }

  function supportedModel(model) {
    return MODELS.includes(model) ? model : DEFAULT_MODEL;
  }

  function persistSettings(partial) {
    Object.assign(settingsState, partial);
    if (Object.prototype.hasOwnProperty.call(partial, "apiKey")) {
      hasApiKey = Boolean(String(partial.apiKey || "").trim());
    }
    if (Object.prototype.hasOwnProperty.call(partial, "mediaEnabled")) {
      setMediaEnabled(partial.mediaEnabled);
    }
    const write = chrome.storage?.sync?.set?.(partial);
    if (write?.catch) write.catch(() => {});
  }

  function savedPersona() {
    return String(explainDefaults.defaultFreeform || "").trim();
  }

  function syncOtherPill() {
    const button = promptBar?.querySelector('button[data-action="other"]');
    if (!button) return;
    const label = savedPersona();
    button.textContent = label || "Other";
    if (label) button.title = label;
    else button.removeAttribute("title");
  }

  function saveLevel(level, freeform) {
    const normalized = normalizeLevel(level);
    if (normalized === "other") {
      const persona = String(freeform || "").trim();
      explainDefaults = { defaultLevel: "other", defaultFreeform: persona };
      const write = chrome.storage?.sync?.set?.({ defaultLevel: "other", defaultFreeform: persona });
      if (write?.catch) write.catch(() => {});
      syncOtherPill();
      return;
    }
    explainDefaults = { ...explainDefaults, defaultLevel: normalized };
    const write = chrome.storage?.sync?.set?.({ defaultLevel: normalized });
    if (write?.catch) write.catch(() => {});
  }

  function clearOther() {
    const button = promptBar?.querySelector('button[data-action="other"]');
    const wasSelected = button?.getAttribute("aria-pressed") === "true";
    explainDefaults = { ...explainDefaults, defaultFreeform: "" };
    const patch = { defaultFreeform: "" };
    if (explainDefaults.defaultLevel === "other") {
      explainDefaults = { ...explainDefaults, defaultLevel: DEFAULT_LEVEL };
      patch.defaultLevel = DEFAULT_LEVEL;
    }
    const write = chrome.storage?.sync?.set?.(patch);
    if (write?.catch) write.catch(() => {});
    syncOtherPill();
    if (wasSelected) button?.setAttribute("aria-pressed", "false");
    setOtherOpen(false);
    button?.focus({ preventScroll: true });
  }

  function fillSettingsForm() {
    const settings = settingsEl();
    if (!settings) return;
    settings.querySelector('input[name="apiKey"]').value = settingsState.apiKey;
    settings.querySelector('select[name="model"]').value = supportedModel(settingsState.model);
    settings.querySelector('input[name="mediaEnabled"]').checked = settingsState.mediaEnabled === true;
  }

  function commitApiKey() {
    const input = settingsEl()?.querySelector('input[name="apiKey"]');
    if (!input) return;
    const next = input.value.trim();
    if (next === settingsState.apiKey) return;
    const becameReady = Boolean(next) && !hasApiKey;
    persistSettings({ apiKey: next });
    if (!isOverlayOpen()) return;
    if (becameReady) {
      setSettingsOpen(false);
      startDefaultExplain();
    } else if (!hasApiKey) {
      setSettingsOpen(true);
    }
  }

  function settingsEl() {
    return shadow?.querySelector(".settings") || null;
  }

  function syncPromptControls() {
    if (!promptBar) return;
    const otherOn = promptBar.querySelector(".other").classList.contains("open");
    const otherBtn = promptBar.querySelector('button[data-action="other"]');
    if (otherBtn) otherBtn.setAttribute("aria-expanded", otherOn ? "true" : "false");
    const gear = promptBar.querySelector('button[data-action="open-settings"]');
    if (gear) gear.setAttribute("aria-expanded", settingsEl()?.classList.contains("open") ? "true" : "false");
  }

  function placeSettingsBar() {
    if (!promptBar) return;
    promptBar.style.maxWidth = `${Math.min(560, window.innerWidth - VIEW_MARGIN * 2)}px`;
    const barWidth = promptBar.offsetWidth;
    const left = Math.max(VIEW_MARGIN, Math.round((window.innerWidth - barWidth) / 2));
    promptBar.style.top = `${VIEW_MARGIN + 16}px`;
    promptBar.style.left = `${left}px`;
    placeSettingsPopper();
  }

  function placeSettingsPopper() {
    const settings = settingsEl();
    const gear = promptBar?.querySelector('button[data-action="open-settings"]');
    if (!settings?.classList.contains("open") || !gear) return;
    const gap = 8;
    const margin = VIEW_MARGIN;
    const gearRect = gear.getBoundingClientRect();
    const panelWidth = settings.offsetWidth;
    const panelHeight = settings.offsetHeight;
    const spaceBelow = window.innerHeight - gearRect.bottom - gap - margin;
    const spaceAbove = gearRect.top - gap - margin;
    const openAbove = panelHeight > spaceBelow && spaceAbove > spaceBelow;
    let top = openAbove ? gearRect.top - gap - panelHeight : gearRect.bottom + gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - panelHeight - margin));
    let left = gearRect.right - panelWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
    settings.style.top = `${Math.round(top)}px`;
    settings.style.left = `${Math.round(left)}px`;
  }

  function setOtherOpen(open) {
    if (!promptBar) return;
    promptBar.querySelector(".other").classList.toggle("open", open);
    syncPromptControls();
    if (lastRect && isOverlayOpen()) positionOverlay(lastRect);
  }

  function setSettingsOpen(open) {
    const settings = settingsEl();
    if (!settings || !promptBar) return;
    if (open) fillSettingsForm();
    settings.classList.toggle("open", open);
    syncPromptControls();
    if (open && isOverlayOpen() && !lastRect) placeSettingsBar();
    else if (open) placeSettingsPopper();
    if (open) {
      requestAnimationFrame(() => {
        if (settings.classList.contains("open")) placeSettingsPopper();
      });
    }
    if (open && !hasApiKey) {
      queueMicrotask(() => settings.querySelector('input[name="apiKey"]').focus({ preventScroll: true }));
    }
  }

  function openOtherEditor() {
    const input = promptBar.querySelector(".other input");
    input.value = savedPersona();
    syncOtherPill();
    setOtherOpen(true);
    queueMicrotask(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  }

  function startDefaultExplain() {
    syncOtherPill();
    if (!hasApiKey) {
      setSettingsOpen(true);
      return;
    }

    setSettingsOpen(false);
    const level = normalizeLevel(explainDefaults.defaultLevel);
    markSelectedLevel(level);

    if (level === "other") {
      const freeform = savedPersona();
      if (freeform) {
        setOtherOpen(false);
        requestExplain("other", freeform);
      } else {
        openOtherEditor();
      }
      return;
    }

    requestExplain(level);
  }

  function submitOther() {
    const input = promptBar.querySelector(".other input");
    if (input.disabled) {
      return;
    }

    const value = input.value.trim();
    if (!value) {
      clearOther();
      return;
    }
    const changed = value !== savedPersona() || explainDefaults.defaultLevel !== "other";
    markSelectedLevel("other");
    saveLevel("other", value);
    setOtherOpen(false);
    promptBar.querySelector('button[data-action="other"]')?.focus({ preventScroll: true });
    if (changed) requestExplain("other", value);
  }

  function onPromptClick(event) {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.action === "open-settings") {
      setSettingsOpen(!settingsEl()?.classList.contains("open"));
      return;
    }

    if (button.dataset.action === "other") {
      setSettingsOpen(false);
      const saved = savedPersona();
      const selected = button.getAttribute("aria-pressed") === "true";
      if (saved && !selected) {
        markSelectedLevel("other");
        saveLevel("other", saved);
        requestExplain("other", saved);
        return;
      }
      openOtherEditor();
      return;
    }

    if (button.dataset.action === "accept-other") {
      submitOther();
      return;
    }

    if (button.dataset.action === "close-other") {
      setOtherOpen(false);
      promptBar.querySelector('button[data-action="other"]')?.focus({ preventScroll: true });
      return;
    }

    if (button.dataset.action === "close-settings") {
      if (!hasApiKey) {
        hideOverlay();
        return;
      }
      setSettingsOpen(false);
      promptBar.querySelector('button[data-action="open-settings"]')?.focus({ preventScroll: true });
      return;
    }

    if (button.dataset.level) {
      setOtherOpen(false);
      setSettingsOpen(false);
      markSelectedLevel(button.dataset.level);
      saveLevel(button.dataset.level, "");
      requestExplain(button.dataset.level);
    }
  }

  function positionOverlay(rect) {
    if (!promptBar || !rect) return;

    const gap = 14;
    const hole = holeFromRect(rect);

    promptBar.style.maxWidth = `${Math.min(560, window.innerWidth - VIEW_MARGIN * 2)}px`;

    const barWidth = promptBar.offsetWidth;
    const barHeight = promptBar.offsetHeight;
    const maxBarTop = Math.max(VIEW_MARGIN, window.innerHeight - barHeight - VIEW_MARGIN);
    const barTop = Math.min(Math.max(VIEW_MARGIN, hole.bottom + gap), maxBarTop);

    const maxLeft = Math.max(VIEW_MARGIN, window.innerWidth - barWidth - VIEW_MARGIN);
    const barLeft = Math.min(Math.max(VIEW_MARGIN, hole.left), maxLeft);

    promptBar.style.top = `${Math.round(barTop)}px`;
    promptBar.style.left = `${Math.round(barLeft)}px`;

    const outMax = Math.min(420, window.innerWidth - VIEW_MARGIN * 2);
    const outTop = barTop + barHeight + gap;
    output.style.maxWidth = `${outMax}px`;
    output.style.top = `${Math.round(outTop)}px`;
    output.style.left = `${Math.round(barLeft)}px`;
    output.style.maxHeight = `${Math.max(80, window.innerHeight - outTop - VIEW_MARGIN)}px`;
    placeSettingsPopper();
  }

  function hideTip() {
    if (!tip) return;
    tip.classList.add("hidden");
  }

  function hideOverlay() {
    if (!promptBar || promptBar.classList.contains("hidden")) return;

    abortExplain();
    clearTimeout(overlayFadeTimer);

    scrim.classList.remove("open");
    promptBar.classList.remove("open");
    output.classList.remove("open");

    overlayFadeTimer = setTimeout(() => {
      promptBar.classList.add("hidden");
      output.classList.add("hidden");
      scrim.classList.add("hidden");
      focusCatcher.classList.add("hidden");

      promptBar.querySelector(".other").classList.remove("open");
      settingsEl()?.classList.remove("open");
      promptBar.querySelector(".other input").value = "";
      promptBar.querySelectorAll("button.level").forEach((button) => {
        button.setAttribute("aria-pressed", "false");
      });
      syncPromptControls();
      output.querySelector(".status").classList.add("hidden");
      output.querySelector(".result").classList.add("hidden");
      output.querySelector(".result").textContent = "";
      output.querySelector(".error").classList.add("hidden");

      lastRect = null;
      lastHoles = [];
      lastRange = null;
      lastText = "";
      lastImage = "";
      capturePreview?.remove();
      capturePreview = null;
      lastContext = "";
      if (marks) marks.replaceChildren();
      cancelScheduledTip();
      hideTip();
      unlockScroll();
    }, OVERLAY_FADE_MS);
  }

  function boxFromRect(rect) {
    return {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function inflate(rect, pad) {
    return {
      top: rect.top - pad,
      left: rect.left - pad,
      right: rect.right + pad,
      bottom: rect.bottom + pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function stopMenuWatch() {
    if (menuObserver) {
      menuObserver.disconnect();
      menuObserver = null;
    }
  }

  function startMenuWatch() {
    stopMenuWatch();
    watchedNodes = [];
    if (!document.documentElement) return;

    menuObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && watchedNodes.length < 48) {
            watchedNodes.push(node);
          }
        }
      }
    });
    menuObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function cancelScheduledTip() {
    clearTimeout(showTimer);
    showTimer = null;
    stopMenuWatch();
  }

  function floatingRoot(el) {
    let current = el;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current === host) return null;
      const style = getComputedStyle(current);
      // Sticky is almost always page chrome (headers, sidebars), not a highlight menu.
      if (style.position === "fixed" || style.position === "absolute") {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function isInteractiveMenu(el) {
    if (
      el.matches(
        "button, [role='button'], [role='toolbar'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-floating-ui-portal]"
      )
    ) {
      return true;
    }

    return Boolean(
      el.querySelector("button, [role='button'], [role='menuitem'], [role='toolbar']")
    );
  }

  function looksLikeSelectionMenu(el, selectionBox, range, { allowInert } = {}) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (el === host || host.contains(el)) return false;

    const style = getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const pos = style.position;
    if (pos !== "fixed" && pos !== "absolute") {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 18) return false;
    if (rect.width > 520 || rect.height > 160) return false;
    if (rect.width >= window.innerWidth * 0.8) return false;

    if (!overlaps(inflate(selectionBox, MENU_PROXIMITY), rect)) {
      return false;
    }

    if (range) {
      try {
        if (el.contains(range.commonAncestorContainer)) {
          return false;
        }
      } catch {
        // Range may detach after the selection changes.
      }
    }

    if (!allowInert && !isInteractiveMenu(el)) {
      return false;
    }

    return true;
  }

  function addMenuRect(el, selectionBox, range, bucket, options) {
    const root = floatingRoot(el) || el;
    if (!looksLikeSelectionMenu(root, selectionBox, range, options)) {
      return;
    }

    const rect = boxFromRect(root.getBoundingClientRect());
    const duplicate = bucket.some(
      (existing) =>
        Math.abs(existing.top - rect.top) < 2 &&
        Math.abs(existing.left - rect.left) < 2 &&
        Math.abs(existing.width - rect.width) < 2 &&
        Math.abs(existing.height - rect.height) < 2
    );
    if (!duplicate) {
      bucket.push(rect);
    }
  }

  function samplePoints(rect, line) {
    const cx = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    const points = [
      { x: cx, y: rect.top - 28 },
      { x: cx, y: rect.bottom + 28 },
      { x: rect.left - 28, y: midY },
      { x: rect.right + 28, y: midY },
      { x: line.right + 18, y: line.top - 18 },
      { x: line.right + 18, y: line.bottom + 18 },
      { x: cx, y: rect.top - 56 },
      { x: cx, y: rect.bottom + 56 },
    ];

    return points.filter(
      (point) =>
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= window.innerWidth &&
        point.y <= window.innerHeight
    );
  }

  function collectCompetingRects(captured) {
    const bucket = [];
    if (!captured) return bucket;

    const selectionBox = captured.rect;
    const range = captured.range;

    const semantic = document.querySelectorAll(
      "[role='toolbar'], [role='menu'], [data-radix-popper-content-wrapper], [data-floating-ui-portal]"
    );
    semantic.forEach((el) => addMenuRect(el, selectionBox, range, bucket));

    for (const point of samplePoints(selectionBox, captured.line)) {
      let stack = [];
      try {
        stack = document.elementsFromPoint(point.x, point.y);
      } catch {
        continue;
      }

      let counted = 0;
      for (const el of stack) {
        if (el === host || (host && host.contains(el))) continue;
        if (el === document.documentElement || el === document.body) continue;
        addMenuRect(el, selectionBox, range, bucket);
        counted += 1;
        if (counted >= 6) break;
      }
    }

    for (const node of watchedNodes) {
      if (!node.isConnected) continue;
      addMenuRect(node, selectionBox, range, bucket, { allowInert: true });
      if (typeof node.querySelectorAll === "function") {
        node
          .querySelectorAll("button, [role='toolbar'], [role='menu']")
          .forEach((child) => addMenuRect(child, selectionBox, range, bucket));
      }
    }

    return bucket;
  }

  function boxAt(left, top, size) {
    return {
      left,
      top,
      right: left + size.width,
      bottom: top + size.height,
      width: size.width,
      height: size.height,
    };
  }

  function fitsViewport(left, top, size) {
    return (
      left >= VIEW_MARGIN &&
      top >= VIEW_MARGIN &&
      left + size.width <= window.innerWidth - VIEW_MARGIN &&
      top + size.height <= window.innerHeight - VIEW_MARGIN
    );
  }

  function clampBox(left, top, size) {
    const maxLeft = Math.max(VIEW_MARGIN, window.innerWidth - size.width - VIEW_MARGIN);
    const maxTop = Math.max(VIEW_MARGIN, window.innerHeight - size.height - VIEW_MARGIN);
    const nextLeft = Math.min(Math.max(VIEW_MARGIN, left), maxLeft);
    const nextTop = Math.min(Math.max(VIEW_MARGIN, top), maxTop);
    return boxAt(nextLeft, nextTop, size);
  }

  function positionTip(captured, obstacles) {
    if (!tip || !captured) return;

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const extra = coarse ? 22 : 0;
    const gap = TIP_GAP + extra;
    const rect = captured.rect;
    const first = captured.first || captured.rect;
    const line = captured.line;
    const size = tipSize;
    const cx = first.left + first.width / 2 - size.width / 2;
    const midY = line.top + (line.height - size.height) / 2;
    const aboveTop = first.top - size.height - gap;
    const canSitAbove = aboveTop >= VIEW_MARGIN;

    const above = canSitAbove
      ? [
          { left: cx, top: aboveTop },
          { left: first.left, top: aboveTop },
          { left: first.right - size.width, top: aboveTop },
        ]
      : [];
    const below = [
      { left: cx, top: rect.bottom + gap },
      { left: line.right - size.width, top: line.bottom + gap },
      { left: first.left, top: rect.bottom + gap },
    ];
    // Beside overlays the rest of the line, so it is a last resort.
    const beside = [
      { left: line.right + gap, top: midY },
      { left: line.left - size.width - gap, top: midY },
    ];
    // OS selection callouts on touch devices also sit above and are not in the DOM.
    const raw = coarse ? [...below, ...above, ...beside] : [...above, ...below, ...beside];

    const candidates = raw
      .filter((pos) => fitsViewport(pos.left, pos.top, size))
      .map((pos) => boxAt(pos.left, pos.top, size));

    if (!candidates.length) {
      candidates.push(clampBox(raw[0].left, raw[0].top, size));
    }

    const pad = 6;
    const picked =
      candidates.find((box) => !obstacles.some((obstacle) => overlaps(inflate(box, pad), obstacle))) ||
      candidates[0];

    tip.style.left = `${Math.round(picked.left)}px`;
    tip.style.top = `${Math.round(picked.top)}px`;
  }

  function isSentenceAbbreviation(textBeforePunct) {
    const match = textBeforePunct.match(/(?:[A-Za-z]\.)*[A-Za-z]+$/);
    if (!match) return false;
    const word = match[0];
    if (/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|St|Inc|Ltd|Fig|cf|al)$/i.test(word)) return true;
    return /^(?:[A-Za-z]\.)+[A-Za-z]?$/i.test(word);
  }

  function sentenceStartIndex(before) {
    let start = 0;
    const re = /[.!?…]["')\]]*\s+/g;
    let match;
    while ((match = re.exec(before))) {
      if (match[0][0] === "." && isSentenceAbbreviation(before.slice(0, match.index))) continue;
      start = match.index + match[0].length;
    }
    const newline = before.lastIndexOf("\n");
    if (newline !== -1 && newline + 1 > start) start = newline + 1;
    return start;
  }

  function sentenceEndIndex(after) {
    const re = /[.!?…]["')\]]*(?=\s|$)/g;
    let match;
    while ((match = re.exec(after))) {
      if (match[0][0] === "." && isSentenceAbbreviation(after.slice(0, match.index))) continue;
      return match.index + match[0].length;
    }
    const newline = after.indexOf("\n");
    if (newline !== -1) return newline;
    return after.length;
  }

  function collapseSpan(raw, selStart, selEnd) {
    let out = "";
    let start = 0;
    let end = 0;
    let mappedStart = false;
    let pendingSpace = false;

    for (let i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) {
        if (out.length) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        out += " ";
        pendingSpace = false;
      }
      if (!mappedStart && i >= selStart) {
        start = out.length;
        mappedStart = true;
      }
      out += raw[i];
      if (i >= selStart && i < selEnd) end = out.length;
    }

    const leading = out.length - out.trimStart().length;
    if (leading) {
      out = out.slice(leading);
      start = Math.max(0, start - leading);
      end = Math.max(start, end - leading);
    }
    out = out.trimEnd();
    if (!mappedStart) start = out.length;
    if (end > out.length) end = out.length;
    if (start > end) start = end;
    return { text: out, start, end };
  }

  function meaningfulExtra(text, start, end) {
    const outside = text.slice(0, start) + text.slice(end);
    return outside.replace(/[^\p{L}\p{N}]+/gu, "").length;
  }

  function clipAround(text, start, end, cap) {
    const selStart = Math.max(0, Math.min(start, text.length));
    const selEnd = Math.max(selStart, Math.min(end, text.length));
    if (text.length <= cap) return { text, start: selStart, end: selEnd };

    const room = Math.max(0, cap - (selEnd - selStart));
    let left = Math.max(0, selStart - Math.floor(room / 2));
    let right = Math.min(text.length, selEnd + (room - (selStart - left)));
    if (left === 0) right = Math.min(text.length, cap);
    if (right === text.length) left = Math.max(0, text.length - cap);

    if (left > 0) {
      const space = text.indexOf(" ", left);
      if (space !== -1 && space < selStart) left = space + 1;
    }
    if (right < text.length) {
      const space = text.lastIndexOf(" ", right);
      if (space > selEnd) right = space;
    }

    const slice = text.slice(left, right);
    const lead = slice.length - slice.trimStart().length;
    return {
      text: slice.trim(),
      start: selStart - left - lead,
      end: selEnd - left - lead,
    };
  }

  function dropPartialWord(text, edge) {
    if (!text) return text;
    if (edge === "start") {
      const space = text.indexOf(" ");
      if (space === -1) return text;
      return text.slice(space + 1);
    }
    const space = text.lastIndexOf(" ");
    if (space <= 0) return text;
    return text.slice(0, space);
  }

  function makeVisibilityCache(root) {
    const cache = new WeakMap();
    const stop = root.parentElement;

    function isInvisible(el) {
      if (cache.has(el)) return cache.get(el);
      let hidden = false;
      if (el.hidden) {
        hidden = true;
      } else {
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) {
          hidden = true;
        } else if (el.parentElement && el.parentElement !== stop) {
          hidden = isInvisible(el.parentElement);
        }
      }
      cache.set(el, hidden);
      return hidden;
    }

    return isInvisible;
  }

  function isContextBlock(el) {
    if (el.matches(CONTEXT_BLOCK_SELECTOR)) return true;
    const display = getComputedStyle(el).display;
    if (
      display === "block" ||
      display === "list-item" ||
      display === "table-cell" ||
      display === "flex" ||
      display === "grid" ||
      display === "flow-root"
    ) {
      return true;
    }
    if (display) return false;
    return /^(?:DIV|ARTICLE|SECTION|MAIN|ASIDE|HEADER|FOOTER|UL|OL|TABLE|FIGURE|DETAILS)$/.test(
      el.tagName,
    );
  }

  function findContextRoot(range) {
    const origin = range.commonAncestorContainer;
    let current = origin.nodeType === Node.ELEMENT_NODE ? origin : origin.parentElement;
    if (!current || (host && host.contains(current))) return null;

    const semantic = current.closest(CONTEXT_BLOCK_SELECTOR);
    if (
      semantic &&
      semantic !== document.body &&
      semantic !== document.documentElement &&
      !(host && host.contains(semantic))
    ) {
      return semantic;
    }

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      if (host && host.contains(current)) return null;
      if (isContextBlock(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function firstText(node, acceptNode) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return acceptNode(node) === NodeFilter.FILTER_ACCEPT ? { node, offset: 0 } : null;
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode });
    const found = walker.nextNode();
    return found ? { node: found, offset: 0 } : null;
  }

  function lastTextPoint(node, acceptNode) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return acceptNode(node) === NodeFilter.FILTER_ACCEPT
        ? { node, offset: node.nodeValue.length }
        : null;
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode });
    let found = null;
    let next;
    while ((next = walker.nextNode())) found = next;
    return found ? { node: found, offset: found.nodeValue.length } : null;
  }

  function pointToText(container, offset, edge, acceptNode) {
    if (!container) return null;
    if (container.nodeType === Node.TEXT_NODE) return { node: container, offset };
    if (container.nodeType !== Node.ELEMENT_NODE) return null;

    if (edge === "start") {
      return firstText(container.childNodes[offset], acceptNode) || lastTextPoint(container, acceptNode);
    }
    if (offset <= 0) return firstText(container, acceptNode);
    return (
      lastTextPoint(container.childNodes[offset - 1], acceptNode) || firstText(container, acceptNode)
    );
  }

  function boundedText(root, point, limit, direction, acceptNode) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode });
    walker.currentNode = point.node;
    const value = point.node.nodeValue || "";
    let text = direction === "before" ? value.slice(0, point.offset) : value.slice(point.offset);
    if (text.length >= limit) {
      text = direction === "before" ? text.slice(-limit) : text.slice(0, limit);
      return { text, hit: true };
    }

    const step = direction === "before" ? "previousNode" : "nextNode";
    let node;
    while ((node = walker[step]())) {
      text = direction === "before" ? node.nodeValue + text : text + node.nodeValue;
      if (text.length >= limit) {
        text = direction === "before" ? text.slice(-limit) : text.slice(0, limit);
        return { text, hit: true };
      }
    }
    return { text, hit: false };
  }

  function elementText(el, limit, direction, acceptNode) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode });
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
      text += node.nodeValue;
      if (direction === "before" && text.length > limit) text = text.slice(-limit);
      if (direction === "after" && text.length >= limit) return text.slice(0, limit);
    }
    return direction === "before" && text.length > limit ? text.slice(-limit) : text;
  }

  function joinPassage(left, right) {
    if (!left) return right;
    if (!right) return left;
    const end = left.replace(/\s+$/, "");
    const start = right.replace(/^\s+/, "");
    if (!end) return start;
    if (!start) return end;
    const sep = /[.!?…]["')\]]*$/.test(end) ? " " : ". ";
    return end + sep + start;
  }

  function siblingText(root, direction, limit, acceptNode, isInvisible) {
    const skip = /^(?:NAV|HEADER|FOOTER|ASIDE|SCRIPT|STYLE|NOSCRIPT)$/;
    let text = "";
    let node = direction === "before" ? root.previousElementSibling : root.nextElementSibling;
    while (node && text.length < limit) {
      if (host && host.contains(node)) break;
      if (!skip.test(node.tagName) && !isInvisible(node)) {
        const chunk = elementText(node, limit, direction, acceptNode);
        if (chunk) text = direction === "before" ? joinPassage(chunk, text) : joinPassage(text, chunk);
      }
      node = direction === "before" ? node.previousElementSibling : node.nextElementSibling;
    }
    if (text.length > limit) {
      text = direction === "before" ? text.slice(-limit) : text.slice(0, limit);
    }
    return text;
  }

  function passageFromRange(range) {
    const root = findContextRoot(range);
    if (!root) return "";

    const isInvisible = makeVisibilityCache(root);
    const acceptNode = (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
      if (host && host.contains(parent)) return NodeFilter.FILTER_REJECT;
      if (isInvisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    };

    const start = pointToText(range.startContainer, range.startOffset, "start", acceptNode);
    const end = pointToText(range.endContainer, range.endOffset, "end", acceptNode);
    if (!start || !end || !root.contains(start.node) || !root.contains(end.node)) return "";

    let before = boundedText(root, start, CONTEXT_FETCH, "before", acceptNode);
    let after = boundedText(root, end, CONTEXT_FETCH, "after", acceptNode);
    if (before.hit) before = { ...before, text: dropPartialWord(before.text, "start") };
    if (after.hit) after = { ...after, text: dropPartialWord(after.text, "end") };

    const selectedRaw = range.toString();
    const selected = selectedRaw.replace(/\s+/g, " ").trim();
    if (!selected || selected.length > CONTEXT_SKIP_AT) return "";

    const sentenceBefore = before.text.slice(sentenceStartIndex(before.text));
    const sentenceAfter = after.text.slice(0, sentenceEndIndex(after.text));
    const sentence = collapseSpan(
      sentenceBefore + selectedRaw + sentenceAfter,
      sentenceBefore.length,
      sentenceBefore.length + selectedRaw.length,
    );

    const windowFrom = (beforeText, afterText) => {
      const span = collapseSpan(
        beforeText + selectedRaw + afterText,
        beforeText.length,
        beforeText.length + selectedRaw.length,
      );
      return clipAround(span.text, span.start, span.end, CONTEXT_CAP);
    };

    let chosen;
    if (meaningfulExtra(sentence.text, sentence.start, sentence.end) >= CONTEXT_MIN_EXTRA) {
      chosen = clipAround(sentence.text, sentence.start, sentence.end, CONTEXT_CAP);
    } else if (selected.length >= CONTEXT_WIDEN_BELOW) {
      return "";
    } else {
      chosen = windowFrom(before.text, after.text);
      if (meaningfulExtra(chosen.text, chosen.start, chosen.end) < CONTEXT_MIN_EXTRA) {
        const lead = siblingText(root, "before", CONTEXT_FETCH, acceptNode, isInvisible);
        const tail = siblingText(root, "after", CONTEXT_FETCH, acceptNode, isInvisible);
        let beforeText = lead ? joinPassage(lead, before.text) : before.text;
        let afterText = tail ? joinPassage(after.text, tail) : after.text;
        // The highlight sits between these strings, so an empty side still needs a seam.
        if (lead && !before.text.trim()) {
          beforeText = /[.!?…]["')\]]*$/.test(lead.trim()) ? `${lead.trim()} ` : `${lead.trim()}. `;
        }
        if (tail && !after.text.trim()) {
          afterText = /[.!?…]["')\]]*$/.test(selectedRaw.trim())
            ? ` ${tail.trim()}`
            : `. ${tail.trim()}`;
        }
        chosen = windowFrom(beforeText, afterText);
      }
    }

    if (meaningfulExtra(chosen.text, chosen.start, chosen.end) < 1) return "";
    return chosen.text;
  }

  function surroundingPassage(range) {
    try {
      return passageFromRange(range);
    } catch {
      return "";
    }
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return null;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 2) {
      return null;
    }

    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) {
      return null;
    }

    if (host && selection.anchorNode && host.contains(selection.anchorNode)) {
      return null;
    }

    const rect = boxFromRect(range.getBoundingClientRect());
    if (!rect.width && !rect.height) {
      return null;
    }

    const clientRects = [...range.getClientRects()].map(boxFromRect);
    const first = clientRects[0] || rect;
    const line = clientRects[clientRects.length - 1] || rect;
    const holes = clientRects.filter((box) => box.width && box.height);
    if (!holes.length) holes.push(rect);

    return {
      text,
      rect,
      first,
      line,
      range,
      holes,
      context: text.length > CONTEXT_SKIP_AT ? "" : surroundingPassage(range),
    };
  }

  function setMediaEnabled(value) {
    mediaEnabled = value === true;
    if (mediaEnabled) return;
    clearTimeout(mediaHideTimer);
    if (mediaTarget) hideTip();
    mediaTarget = null;
    if (captureSession) cancelMediaCapture();
    if (lastImage && isOverlayOpen()) hideOverlay();
  }

  function cancelMediaCapture() {
    captureSession = null;
    captureLayer?.remove();
    captureLayer = null;
    unlockScroll();
  }

  function mediaRectAt(event) {
    // Player controls often sit above the video rather than inside it.
    const candidates = document.elementsFromPoint(event.clientX, event.clientY);
    for (const element of candidates) {
      if (element.matches("img, video, canvas")) return element;
      const video = element.querySelector("video");
      if (video) {
        const rect = video.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right &&
            event.clientY >= rect.top && event.clientY <= rect.bottom) return video;
      }
    }
    return null;
  }

  document.addEventListener("pointerdown", event => {
    if (!mediaEnabled || isEventFromUi(event) || captureSession || isOverlayOpen()) return;
    clearTimeout(mediaHideTimer);
    mediaTarget = null;
    hideTip();
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!mediaEnabled || isOverlayOpen() || captureSession || event.buttons) return;
    if (isEventFromUi(event)) {
      clearTimeout(mediaHideTimer);
      return;
    }
    if (window.getSelection()?.toString().trim()) return;
    const target = mediaRectAt(event);
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width < 80 || rect.height < 60) {
      if (mediaTarget) {
        clearTimeout(mediaHideTimer);
        mediaHideTimer = setTimeout(() => { mediaTarget = null; hideTip(); }, 180);
      }
      return;
    }
    clearTimeout(mediaHideTimer);
    cancelScheduledTip();
    ensureUi();
    mediaTarget = target;
    tip.style.left = `${Math.max(VIEW_MARGIN, Math.min(window.innerWidth - tipSize.width - VIEW_MARGIN, rect.right - tipSize.width - 8))}px`;
    tip.style.top = `${Math.max(VIEW_MARGIN, Math.min(window.innerHeight - tipSize.height - VIEW_MARGIN, rect.top + 8))}px`;
    tip.classList.remove("hidden");
  }, { passive: true });

  async function startMediaCapture() {
    if (!mediaEnabled || captureSession || !mediaTarget) return;
    const target = mediaTarget;
    const session = { width: window.innerWidth, height: window.innerHeight };
    captureSession = session;
    mediaTarget = null;
    clearTimeout(mediaHideTimer);
    cancelScheduledTip();
    hideTip();
    lastText = "";
    lastImage = "";
    lastRange = null;
    lastContext = [target.getAttribute("alt"), target.closest("figure")?.querySelector("figcaption")?.textContent]
      .filter(Boolean).join(" ").slice(0, CONTEXT_CAP);
    lastRect = boxFromRect(target.getBoundingClientRect());
    lastHoles = [lastRect];
    try {
      // Let the hidden button paint before Chrome takes the screenshot.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (captureSession !== session) return;
      const response = await chrome.runtime.sendMessage({ type: "ELIX_CAPTURE" });
      if (captureSession !== session) return;
      if (response?.error || !response?.dataUrl) throw new Error(response?.error || "Could not capture this page.");
      const image = new Image();
      image.src = response.dataUrl;
      await image.decode();
      if (captureSession !== session) return;
      if (window.innerWidth !== session.width || window.innerHeight !== session.height) {
        throw new Error("The window changed size. Please capture again.");
      }
      lockScroll();
      captureLayer = document.createElement("div");
      captureLayer.setAttribute("role", "dialog");
      captureLayer.setAttribute("aria-label", "Select an image region");
      captureLayer.tabIndex = -1;
      captureLayer.style.cssText = "position:fixed;inset:0;z-index:10;cursor:crosshair;touch-action:none;user-select:none;overflow:hidden;";
      image.draggable = false;
      image.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
      const shade = document.createElement("div");
      shade.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,.3);pointer-events:none;";
      const box = document.createElement("div");
      box.className = "mark";
      box.style.cssText = "position:absolute;display:none;border:2px solid white;outline:1px solid #222;box-shadow:0 0 0 99999px rgba(0,0,0,.3);pointer-events:none;";
      captureLayer.append(image, shade, box);
      shadow.append(captureLayer);
      captureLayer.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelMediaCapture();
        }
      });
      captureLayer.focus({ preventScroll: true });
      let start = null;
      let rect = null;
      const point = event => ({ x: Math.max(0, Math.min(session.width, event.clientX)), y: Math.max(0, Math.min(session.height, event.clientY)) });
      const update = event => {
        const end = point(event);
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        rect = { left, top, right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
        Object.assign(box.style, { display: "block", left: `${left}px`, top: `${top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      };
      captureLayer.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        start = point(event);
        captureLayer.setPointerCapture(event.pointerId);
        shade.style.display = "none";
        update(event);
      });
      captureLayer.addEventListener("pointermove", event => {
        if (start) update(event);
      });
      captureLayer.addEventListener("pointercancel", cancelMediaCapture);
      captureLayer.addEventListener("pointerup", event => {
        if (!start || event.button !== 0) return;
        update(event);
        start = null;
        if (rect.width < 8 || rect.height < 8) {
          box.style.display = "none";
          shade.style.display = "block";
          return;
        }
        try {
          // Use actual bitmap dimensions: zoom and display scale need not equal devicePixelRatio.
          const scaleX = image.naturalWidth / session.width;
          const scaleY = image.naturalHeight / session.height;
          const sourceWidth = rect.width * scaleX;
          const sourceHeight = rect.height * scaleY;
          const scale = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sourceWidth * scale));
          canvas.height = Math.max(1, Math.round(sourceHeight * scale));
          canvas.getContext("2d").drawImage(image, rect.left * scaleX, rect.top * scaleY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
          lastImage = canvas.toDataURL("image/png");
          lastRect = rect;
          lastHoles = [rect];
          capturePreview = document.createElement("img");
          capturePreview.src = lastImage;
          capturePreview.alt = "Captured region";
          capturePreview.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;`;
          cancelMediaCapture();
          scrim.insertBefore(capturePreview, marks);
          openOverlay(true);
        } catch (error) {
          cancelMediaCapture();
          openOverlay(true);
          showError(error.message || "Could not crop this region.");
        }
      });
    } catch (error) {
      if (captureSession !== session) return;
      cancelMediaCapture();
      // Reuse the result panel for capture errors; do not send a model request.
      lastText = "";
      lastImage = "";
      ensureUi();
      updateSpotlight();
      focusCatcher.classList.remove("hidden");
      fadeOpen(scrim);
      fadeOpen(promptBar);
      lockScroll();
      positionOverlay(lastRect);
      showError(error.message || "Could not capture this page.");
    }
  }

  function storeCapture(captured) {
    mediaTarget = null;
    lastImage = "";
    lastText = captured.text;
    lastContext = captured.context || "";
    lastRect = captured.rect;
    lastHoles = captured.holes?.length ? captured.holes : [captured.rect];
    lastRange = captured.range ? captured.range.cloneRange() : lastRange;
  }

  function revealTip(captured) {
    if (isOverlayOpen()) return;

    const live = readSelection();
    const current = live && live.text === captured.text ? live : captured;
    storeCapture(current);

    const obstacles = collectCompetingRects(current);
    positionTip(current, obstacles);
    tip.classList.remove("hidden");
  }

  function showTipForSelection() {
    if (isOverlayOpen() || captureSession) return;

    const captured = readSelection();
    if (!captured) {
      hideTip();
      return;
    }

    ensureUi();
    storeCapture(captured);
    startMenuWatch();
    revealTip(captured);

    showTimer = setTimeout(() => {
      if (!isTipOpen() || isOverlayOpen()) {
        stopMenuWatch();
        return;
      }
      revealTip(captured);
      showTimer = setTimeout(() => {
        if (!isTipOpen() || isOverlayOpen()) {
          stopMenuWatch();
          return;
        }
        revealTip(captured);
        stopMenuWatch();
      }, MENU_LATE_MS);
    }, MENU_WAIT_MS);
  }

  function scheduleTip() {
    if (isOverlayOpen() || captureSession || mediaTarget) return;
    cancelScheduledTip();
    hideTip();
    showTimer = setTimeout(showTipForSelection, 16);
  }

  function openSettingsFromToolbar() {
    ensureUi();
    clearTimeout(overlayFadeTimer);
    focusCatcher.classList.add("hidden");
    fadeOpen(scrim);
    fadeOpen(promptBar);
    output.classList.remove("open");
    output.classList.add("hidden");
    lockScroll();
    updateSpotlight();
    setSettingsOpen(true);
  }

  function openOverlay(imageCapture = false) {
    cancelScheduledTip();
    hideTip();

    const captured = imageCapture ? null : readSelection();
    if (captured) {
      storeCapture(captured);
    }

    if ((!lastText?.trim() && !lastImage) || !lastRect) {
      return;
    }

    ensureUi();
    updateSpotlight();

    clearTimeout(overlayFadeTimer);
    focusCatcher.classList.remove("hidden");
    fadeOpen(scrim);
    fadeOpen(promptBar);
    clearPageSelection();
    output.classList.remove("open");
    output.classList.add("hidden");
    lockScroll();

    promptBar.querySelector(".other").classList.remove("open");
    settingsEl()?.classList.remove("open");
    promptBar.querySelector(".other input").value = "";
    output.querySelector(".status").classList.add("hidden");
    output.querySelector(".result").classList.add("hidden");
    output.querySelector(".result").textContent = "";
    output.querySelector(".error").classList.add("hidden");
    positionOverlay(lastRect);
    startDefaultExplain();
  }

  document.addEventListener(
    "mouseup",
    (event) => {
      if (event.button !== 0) return;
      if (isEventFromUi(event)) return;
      if (isOverlayOpen()) return;
      scheduleTip();
    },
    true
  );

  document.addEventListener("keyup", (event) => {
    if (event.key !== "Shift") return;
    if (isEventFromUi(event)) return;
    if (isOverlayOpen()) return;
    scheduleTip();
  });

  document.addEventListener("selectionchange", () => {
    if (isOverlayOpen() || captureSession || mediaTarget) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (!text) {
      cancelScheduledTip();
      hideTip();
      return;
    }

    if (isTipOpen() && text !== lastText) {
      hideTip();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (captureSession) {
        cancelMediaCapture();
        return;
      }
      mediaTarget = null;
      if (isOverlayOpen()) {
        pinScroll();
        syncOverlayToSelection();
        return;
      }
      cancelScheduledTip();
      hideTip();
    },
    true
  );

  window.addEventListener("resize", () => {
    if (captureSession) cancelMediaCapture();
    mediaTarget = null;
    if (isOverlayOpen() && lastRect) {
      pinScroll();
      syncOverlayToSelection();
      updateSpotlight();
      positionOverlay(lastRect);
      return;
    }
    if (isOverlayOpen()) {
      placeSettingsBar();
      return;
    }
    cancelScheduledTip();
    hideTip();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (captureSession) {
      event.preventDefault();
      cancelMediaCapture();
      return;
    }

    if (isOverlayOpen() && settingsEl()?.classList.contains("open")) {
      event.preventDefault();
      setSettingsOpen(false);
      return;
    }

    if (isOverlayOpen()) {
      event.preventDefault();
      hideOverlay();
      return;
    }

    if (isTipOpen()) {
      event.preventDefault();
      cancelScheduledTip();
      hideTip();
      mediaTarget = null;
    }
  });

  window.addEventListener("keydown", stopHostKeys, true);
  window.addEventListener("keypress", stopHostKeys, true);
  window.addEventListener("keyup", stopHostKeys, true);

  refreshExplainDefaults();
  if (chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "ELIX_OPEN_SETTINGS") openSettingsFromToolbar();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.mediaEnabled && changes.mediaEnabled.newValue !== settingsState.mediaEnabled) {
      settingsState.mediaEnabled = changes.mediaEnabled.newValue === true;
      setMediaEnabled(settingsState.mediaEnabled);
    }
    if (changes.defaultLevel) {
      explainDefaults.defaultLevel = normalizeLevel(changes.defaultLevel.newValue);
    }
    if (changes.defaultFreeform) {
      explainDefaults.defaultFreeform = String(changes.defaultFreeform.newValue || "");
      syncOtherPill();
    }
    if (changes.model) {
      settingsState.model = supportedModel(changes.model.newValue);
    }
    if (changes.apiKey) {
      const key = String(changes.apiKey.newValue || "");
      if (key === settingsState.apiKey) return;
      settingsState.apiKey = key;
      hasApiKey = Boolean(key.trim());
      if (!isOverlayOpen()) return;
      if (hasApiKey) {
        setSettingsOpen(false);
        startDefaultExplain();
      } else {
        setSettingsOpen(true);
      }
    }
  });
})();
