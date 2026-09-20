(() => {
  const HOST_ID = "elix-root";
  const LEVELS = ["5", "10", "15", "20"];
  const OVERLAY_FADE_MS = 220;
  // In-page highlight menus mount after mouseup; wait before placing the chip.
  const MENU_WAIT_MS = 220;
  const MENU_LATE_MS = 180;
  const TIP_GAP = 8;
  const MENU_PROXIMITY = 64;
  const VIEW_MARGIN = 8;

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
  let previousOverflow = { html: "", body: "" };
  let explainPort = null;
  let overlayFadeTimer = null;

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
    if (!isOverlayOpen()) {
      return;
    }
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

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

  function lockScroll() {
    if (scrollLocked) {
      return;
    }

    scrollLocked = true;
    savedScrollX = window.scrollX;
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

        .levels {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        button.level, button.go {
          appearance: none;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background: rgba(255, 255, 255, 0.55);
          color: #111;
          border-radius: 999px;
          padding: 6px 10px;
          font: 600 12px/1 "IBM Plex Sans", "Segoe UI", sans-serif;
          cursor: pointer;
        }

        button.level:hover, button.go:hover {
          background: rgba(17, 17, 17, 0.06);
          border-color: #111;
        }

        button:disabled { opacity: 0.55; cursor: wait; }

        .other {
          display: none;
          flex: 1 1 100%;
          gap: 6px;
        }

        .other.open { display: flex; }

        .other input {
          flex: 1;
          min-width: 0;
          border-radius: 10px;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background: rgba(255, 255, 255, 0.72);
          color: #111;
          padding: 7px 9px;
          font: 12px/1.3 "IBM Plex Sans", "Segoe UI", sans-serif;
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
        <div class="levels"></div>
        <div class="other">
          <input type="text" placeholder="e.g. a tired parent / age 42" />
          <button type="button" class="go" data-action="submit-other">Go</button>
        </div>
      </div>
      <div class="output hidden">
        <div class="status hidden"></div>
        <div class="result hidden"></div>
        <div class="error hidden"></div>
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

    tip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    tip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openOverlay();
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

  function setBusy(busy) {
    promptBar.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    const input = promptBar.querySelector(".other input");
    if (input) input.disabled = busy;
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
    if (!lastText.trim()) {
      showError("No text captured from the selection.");
      return;
    }

    abortExplain();
    setBusy(true);
    output.querySelector(".result").textContent = "";
    showStatus("Thinking…");

    let port;
    try {
      port = chrome.runtime.connect({ name: "elix-explain" });
    } catch (error) {
      setBusy(false);
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
        setBusy(false);
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
        setBusy(false);
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
      setBusy(false);
      const err = chrome.runtime.lastError?.message;
      if (err) showError(err);
    });

    port.postMessage({
      type: "ELIX_EXPLAIN",
      payload: { text: lastText, level, freeform },
    });
  }

  function submitOther() {
    const input = promptBar.querySelector(".other input");
    if (input.disabled) {
      return;
    }

    const value = input.value.trim();
    if (!value) {
      showError("Describe the persona or audience first.");
      return;
    }
    requestExplain("other", value);
  }

  function onPromptClick(event) {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.action === "other") {
      const other = promptBar.querySelector(".other");
      other.classList.add("open");
      if (lastRect) positionOverlay(lastRect);
      queueMicrotask(() => promptBar.querySelector(".other input").focus({ preventScroll: true }));
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

  function positionOverlay(rect) {
    if (!promptBar || !rect) return;

    const gap = 14;
    const hole = holeFromRect(rect);

    promptBar.style.maxWidth = `${Math.min(560, window.innerWidth - VIEW_MARGIN * 2)}px`;

    const barWidth = promptBar.offsetWidth;
    const barHeight = promptBar.offsetHeight;
    let barTop = hole.top - barHeight - gap;
    if (barTop < VIEW_MARGIN) {
      barTop = VIEW_MARGIN;
    }

    const maxLeft = Math.max(VIEW_MARGIN, window.innerWidth - barWidth - VIEW_MARGIN);
    const barLeft = Math.min(Math.max(VIEW_MARGIN, hole.left), maxLeft);

    promptBar.style.top = `${Math.round(barTop)}px`;
    promptBar.style.left = `${Math.round(barLeft)}px`;

    const outMax = Math.min(420, window.innerWidth - VIEW_MARGIN * 2);
    const outTop = hole.bottom + gap;
    output.style.maxWidth = `${outMax}px`;
    output.style.top = `${Math.round(outTop)}px`;
    output.style.left = `${Math.round(barLeft)}px`;
    output.style.maxHeight = `${Math.max(80, window.innerHeight - outTop - VIEW_MARGIN)}px`;
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
      promptBar.querySelector(".other input").value = "";
      output.querySelector(".status").classList.add("hidden");
      output.querySelector(".result").classList.add("hidden");
      output.querySelector(".result").textContent = "";
      output.querySelector(".error").classList.add("hidden");

      lastRect = null;
      lastHoles = [];
      lastRange = null;
      lastText = "";
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

    return { text, rect, first, line, range, holes };
  }

  function storeCapture(captured) {
    lastText = captured.text;
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
    if (isOverlayOpen()) return;

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
    if (isOverlayOpen()) return;
    cancelScheduledTip();
    hideTip();
    showTimer = setTimeout(showTipForSelection, 16);
  }

  function openOverlay() {
    cancelScheduledTip();
    hideTip();

    const captured = readSelection();
    if (captured) {
      storeCapture(captured);
    }

    if (!lastText?.trim() || !lastRect) {
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
    promptBar.querySelector(".other input").value = "";
    output.querySelector(".status").classList.add("hidden");
    output.querySelector(".result").classList.add("hidden");
    output.querySelector(".result").textContent = "";
    output.querySelector(".error").classList.add("hidden");
    positionOverlay(lastRect);
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
    if (isOverlayOpen()) return;

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
    if (isOverlayOpen() && lastRect) {
      pinScroll();
      syncOverlayToSelection();
      updateSpotlight();
      positionOverlay(lastRect);
      return;
    }
    cancelScheduledTip();
    hideTip();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (isOverlayOpen()) {
      event.preventDefault();
      hideOverlay();
      return;
    }

    if (isTipOpen()) {
      event.preventDefault();
      cancelScheduledTip();
      hideTip();
    }
  });

  window.addEventListener("keydown", stopHostKeys, true);
  window.addEventListener("keypress", stopHostKeys, true);
  window.addEventListener("keyup", stopHostKeys, true);
})();
