(() => {
  const HOST_ID = "elix-root";
  const LEVELS = ["5", "10", "15", "20"];
  const SPOTLIGHT_PAD = 6;
  // In-page highlight menus mount after mouseup; wait before placing the chip.
  const MENU_WAIT_MS = 220;
  const MENU_LATE_MS = 180;
  const TIP_GAP = 8;
  const MENU_PROXIMITY = 64;
  const VIEW_MARGIN = 8;

  let host = null;
  let shadow = null;
  let panel = null;
  let scrim = null;
  let focusRing = null;
  let focusCatcher = null;
  let tip = null;
  let lastText = "";
  let lastRect = null;
  let showTimer = null;
  let menuObserver = null;
  let watchedNodes = [];
  let tipSize = { width: 56, height: 28 };
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

  function isTipOpen() {
    return Boolean(tip && !tip.classList.contains("hidden"));
  }

  function isOtherInputEvent(event) {
    if (!panel) return false;
    const input = panel.querySelector(".other input");
    if (!input) return false;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.includes(input) || shadow?.activeElement === input;
  }

  function stopHostEnter(event) {
    if (!isPanelOpen() || event.key !== "Enter") {
      return;
    }
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    if (!isOtherInputEvent(event)) {
      return;
    }

    // Word / contenteditable still own the preserved highlight. Enter is
    // composed, so a page capture listener would replace that selection
    // before the input's own handler runs.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (event.type === "keydown") {
      submitOther();
    }
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

      <div class="scrim hidden" part="scrim"></div>
      <div class="focus-catcher hidden"></div>
      <div class="focus-ring hidden"></div>
      <button type="button" class="tip hidden" aria-label="Explain with ELIX">ELIX</button>

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
    tip = shadow.querySelector(".tip");
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
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      submitOther();
    });

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
    const input = panel.querySelector(".other input");
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

  function hideTip() {
    if (!tip) return;
    tip.classList.add("hidden");
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
    lastText = "";
    cancelScheduledTip();
    hideTip();
    unlockScroll();

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
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

    const clientRects = range.getClientRects();
    const first = clientRects.length ? boxFromRect(clientRects[0]) : rect;
    const line = clientRects.length ? boxFromRect(clientRects[clientRects.length - 1]) : rect;

    return { text, rect, first, line, range };
  }

  function storeCapture(captured) {
    lastText = captured.text;
    lastRect = captured.rect;
  }

  function revealTip(captured) {
    if (isPanelOpen()) return;

    const live = readSelection();
    const current = live && live.text === captured.text ? live : captured;
    storeCapture(current);

    const obstacles = collectCompetingRects(current);
    positionTip(current, obstacles);
    tip.classList.remove("hidden");
  }

  function showTipForSelection() {
    if (isPanelOpen()) return;

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
      if (!isTipOpen() || isPanelOpen()) {
        stopMenuWatch();
        return;
      }
      revealTip(captured);
      showTimer = setTimeout(() => {
        if (!isTipOpen() || isPanelOpen()) {
          stopMenuWatch();
          return;
        }
        revealTip(captured);
        stopMenuWatch();
      }, MENU_LATE_MS);
    }, MENU_WAIT_MS);
  }

  function scheduleTip() {
    if (isPanelOpen()) return;
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

  document.addEventListener(
    "mouseup",
    (event) => {
      if (event.button !== 0) return;
      if (isEventFromUi(event)) return;
      if (isPanelOpen()) return;
      scheduleTip();
    },
    true
  );

  document.addEventListener("keyup", (event) => {
    if (event.key !== "Shift") return;
    if (isEventFromUi(event)) return;
    if (isPanelOpen()) return;
    scheduleTip();
  });

  document.addEventListener("selectionchange", () => {
    if (isPanelOpen()) return;

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
      if (isPanelOpen()) return;
      cancelScheduledTip();
      hideTip();
    },
    true
  );

  window.addEventListener("resize", () => {
    if (isPanelOpen()) return;
    cancelScheduledTip();
    hideTip();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (isPanelOpen()) {
      event.preventDefault();
      hidePanel();
      return;
    }

    if (isTipOpen()) {
      event.preventDefault();
      cancelScheduledTip();
      hideTip();
    }
  });

  window.addEventListener("keydown", stopHostEnter, true);
  window.addEventListener("keypress", stopHostEnter, true);
  window.addEventListener("keyup", stopHostEnter, true);
})();
