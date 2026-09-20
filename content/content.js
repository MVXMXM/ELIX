(() => {
  const HOST_ID = "elix-root";
  const LEVELS = ["5", "10", "15", "20"];
  const SPOTLIGHT_PAD = 6;

  let host = null;
  let shadow = null;
  let panel = null;
  let scrim = null;
  let focusRing = null;
  let focusCatcher = null;
  let lastText = "";
  let lastRect = null;
  let showTimer = null;
  let scrollLocked = false;
  let savedScrollY = 0;
  let previousOverflow = { html: "", body: "" };

  function isEventFromUi(event) {
    if (!host) return false;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.includes(host) || event.target === host;
  }

  function isPanelOpen() {
    return Boolean(panel && !panel.classList.contains("hidden"));
  }

  function preventPageScroll(event) {
    if (isEventFromUi(event)) {
      return;
    }
    event.preventDefault();
  }

  function lockScroll() {
    if (scrollLocked) {
      return;
    }

    scrollLocked = true;
    savedScrollY = window.scrollY;
    previousOverflow = {
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    };

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.addEventListener("wheel", preventPageScroll, { passive: false });
    document.addEventListener("touchmove", preventPageScroll, { passive: false });
  }

  function unlockScroll() {
    if (!scrollLocked) {
      return;
    }

    scrollLocked = false;
    document.documentElement.style.overflow = previousOverflow.html;
    document.body.style.overflow = previousOverflow.body;
    document.removeEventListener("wheel", preventPageScroll);
    document.removeEventListener("touchmove", preventPageScroll);
    window.scrollTo(0, savedScrollY);
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
          background: rgba(12, 14, 16, 0.58);
          cursor: default;
        }

        .focus-ring {
          position: fixed;
          border-radius: 8px;
          border: 1.5px solid rgba(232, 196, 104, 0.95);
          box-shadow:
            0 0 0 1px rgba(12, 14, 16, 0.35),
            0 0 24px rgba(232, 196, 104, 0.28);
          background: rgba(232, 196, 104, 0.08);
          pointer-events: none;
        }

        .focus-catcher {
          position: fixed;
          border-radius: 8px;
          background: transparent;
        }

        .panel {
          position: fixed;
          min-width: 240px;
          max-width: min(360px, calc(100vw - 24px));
          max-height: min(70vh, 520px);
          overflow: auto;
          padding: 12px;
          border-radius: 14px;
          background: #171a1d;
          color: #f4f1ea;
          font: 13px/1.4 "IBM Plex Sans", "Segoe UI", sans-serif;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(244, 241, 234, 0.12);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }

        .brand {
          font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #e8c468;
        }

        .close {
          border: 0;
          background: transparent;
          color: rgba(244, 241, 234, 0.7);
          font: 600 14px/1 "IBM Plex Sans", "Segoe UI", sans-serif;
          padding: 4px 6px;
          border-radius: 8px;
          cursor: pointer;
        }

        .close:hover {
          color: #f4f1ea;
          background: rgba(244, 241, 234, 0.08);
        }

        .prompt {
          margin: 0 0 10px;
          color: rgba(244, 241, 234, 0.82);
        }

        .levels {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        button.level, button.go {
          appearance: none;
          border: 1px solid rgba(244, 241, 234, 0.18);
          background: rgba(244, 241, 234, 0.06);
          color: #f4f1ea;
          border-radius: 999px;
          padding: 6px 10px;
          font: 600 12px/1 "IBM Plex Sans", "Segoe UI", sans-serif;
          cursor: pointer;
        }

        button.level:hover, button.go:hover {
          background: rgba(232, 196, 104, 0.18);
          border-color: #e8c468;
        }

        button:disabled { opacity: 0.55; cursor: wait; }

        .other {
          margin-top: 8px;
          display: none;
          gap: 6px;
        }

        .other.open { display: flex; }

        .other input {
          flex: 1;
          min-width: 0;
          border-radius: 10px;
          border: 1px solid rgba(244, 241, 234, 0.18);
          background: rgba(0, 0, 0, 0.25);
          color: #f4f1ea;
          padding: 7px 9px;
          font: 12px/1.3 "IBM Plex Sans", "Segoe UI", sans-serif;
        }

        .result, .error, .status {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(244, 241, 234, 0.12);
          white-space: pre-wrap;
        }

        .error { color: #ffb4a8; }
        .status { color: rgba(244, 241, 234, 0.7); }
        .hidden { display: none !important; }
      </style>

      <div class="scrim hidden" part="scrim"></div>
      <div class="focus-catcher hidden"></div>
      <div class="focus-ring hidden"></div>

      <div class="panel hidden" part="panel">
        <div class="header">
          <div class="brand">ELIX</div>
          <button type="button" class="close" data-action="close" aria-label="Close">✕</button>
        </div>
        <p class="prompt">Explain like I'm…</p>
        <div class="levels"></div>
        <div class="other">
          <input type="text" placeholder="e.g. a tired parent / age 42" />
          <button type="button" class="go" data-action="submit-other">Go</button>
        </div>
        <div class="status hidden"></div>
        <div class="result hidden"></div>
        <div class="error hidden"></div>
      </div>
    `;

    scrim = shadow.querySelector(".scrim");
    focusCatcher = shadow.querySelector(".focus-catcher");
    focusRing = shadow.querySelector(".focus-ring");
    panel = shadow.querySelector(".panel");

    const levels = shadow.querySelector(".levels");

    for (const level of LEVELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "level";
      button.textContent = level;
      button.dataset.level = level;
      levels.appendChild(button);
    }

    const otherBtn = document.createElement("button");
    otherBtn.type = "button";
    otherBtn.className = "level";
    otherBtn.textContent = "Other";
    otherBtn.dataset.action = "other";
    levels.appendChild(otherBtn);

    scrim.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    scrim.addEventListener("click", () => hidePanel());

    focusCatcher.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    // Keep page selection from being cleared when interacting with the overlay.
    panel.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    panel.addEventListener("click", onPanelClick);

    const otherInput = panel.querySelector(".other input");
    otherInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitOther();
      }
    });

    // Allow typing in the freeform field (mousedown preventDefault would block focus).
    otherInput.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    document.documentElement.appendChild(host);
  }

  function paddedRect(rect) {
    const top = Math.max(0, rect.top - SPOTLIGHT_PAD);
    const left = Math.max(0, rect.left - SPOTLIGHT_PAD);
    const right = Math.min(window.innerWidth, rect.right + SPOTLIGHT_PAD);
    const bottom = Math.min(window.innerHeight, rect.bottom + SPOTLIGHT_PAD);

    return {
      top,
      left,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function updateSpotlight(rect) {
    const hole = paddedRect(rect);

    // Full-page dim with a clear cutout over the selected text.
    scrim.style.clipPath = `polygon(
      evenodd,
      0px 0px,
      100% 0px,
      100% 100%,
      0px 100%,
      0px 0px,
      ${hole.left}px ${hole.top}px,
      ${hole.left}px ${hole.bottom}px,
      ${hole.right}px ${hole.bottom}px,
      ${hole.right}px ${hole.top}px,
      ${hole.left}px ${hole.top}px
    )`;

    const box = {
      top: `${Math.round(hole.top)}px`,
      left: `${Math.round(hole.left)}px`,
      width: `${Math.round(hole.width)}px`,
      height: `${Math.round(hole.height)}px`,
    };

    Object.assign(focusRing.style, box);
    Object.assign(focusCatcher.style, box);
  }

  function setBusy(busy) {
    panel.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    const input = panel.querySelector(".other input");
    if (input) input.disabled = busy;
  }

  function showStatus(text) {
    const status = panel.querySelector(".status");
    const result = panel.querySelector(".result");
    const error = panel.querySelector(".error");
    status.textContent = text || "";
    status.classList.toggle("hidden", !text);
    result.classList.add("hidden");
    error.classList.add("hidden");
  }

  function showResult(text) {
    const status = panel.querySelector(".status");
    const result = panel.querySelector(".result");
    const error = panel.querySelector(".error");
    status.classList.add("hidden");
    error.classList.add("hidden");
    result.textContent = text;
    result.classList.remove("hidden");
  }

  function showError(text) {
    const status = panel.querySelector(".status");
    const result = panel.querySelector(".result");
    const error = panel.querySelector(".error");
    status.classList.add("hidden");
    result.classList.add("hidden");
    error.textContent = text;
    error.classList.remove("hidden");
  }

  async function requestExplain(level, freeform) {
    if (!lastText.trim()) {
      showError("No text captured from the selection.");
      return;
    }

    setBusy(true);
    showStatus("Thinking…");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ELIX_EXPLAIN",
        payload: { text: lastText, level, freeform },
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Something went wrong.");
      }

      showResult(response.explanation);
    } catch (error) {
      showError(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  function submitOther() {
    const value = panel.querySelector(".other input").value.trim();
    if (!value) {
      showError("Describe the persona or audience first.");
      return;
    }
    requestExplain("other", value);
  }

  function onPanelClick(event) {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.action === "close") {
      hidePanel();
      return;
    }

    if (button.dataset.action === "other") {
      const other = panel.querySelector(".other");
      other.classList.add("open");
      queueMicrotask(() => panel.querySelector(".other input").focus());
      return;
    }

    if (button.dataset.action === "submit-other") {
      submitOther();
      return;
    }

    if (button.dataset.level) {
      requestExplain(button.dataset.level);
    }
  }

  function positionPanel(rect) {
    const gap = 12;
    const width = Math.min(360, window.innerWidth - 24);
    let top = rect.bottom + gap + SPOTLIGHT_PAD;
    let left = rect.left;

    if (top + 200 > window.innerHeight) {
      top = Math.max(12, rect.top - gap - SPOTLIGHT_PAD - 180);
    }
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    left = Math.max(12, left);

    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  }

  function hidePanel() {
    if (!panel) return;

    panel.classList.add("hidden");
    scrim.classList.add("hidden");
    focusRing.classList.add("hidden");
    focusCatcher.classList.add("hidden");

    panel.querySelector(".other").classList.remove("open");
    panel.querySelector(".other input").value = "";
    panel.querySelector(".status").classList.add("hidden");
    panel.querySelector(".result").classList.add("hidden");
    panel.querySelector(".error").classList.add("hidden");

    lastRect = null;
    unlockScroll();
  }

  function openForSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 2) {
      return;
    }

    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) {
      return;
    }

    if (host && selection.anchorNode && host.contains(selection.anchorNode)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return;
    }

    ensureUi();
    lastText = text;
    lastRect = {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };

    updateSpotlight(lastRect);
    positionPanel(lastRect);

    scrim.classList.remove("hidden");
    focusRing.classList.remove("hidden");
    focusCatcher.classList.remove("hidden");
    panel.classList.remove("hidden");
    lockScroll();

    panel.querySelector(".other").classList.remove("open");
    panel.querySelector(".other input").value = "";
    showStatus("");
    panel.querySelector(".result").classList.add("hidden");
    panel.querySelector(".error").classList.add("hidden");
  }

  document.addEventListener("mouseup", (event) => {
    if (isEventFromUi(event)) {
      return;
    }
    clearTimeout(showTimer);
    showTimer = setTimeout(openForSelection, 10);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isPanelOpen()) {
      event.preventDefault();
      hidePanel();
    }
  });
})();
