(() => {
  const main = document.querySelector("main");
  const tip = document.querySelector(".tip");
  const promptBar = document.querySelector(".prompt-bar");
  const output = document.querySelector(".output");
  const scrim = document.querySelector(".scrim");
  const veil = scrim.querySelector(".veil");
  const status = output.querySelector(".status");
  const result = output.querySelector(".result");
  let selectedText = "";
  let selectionRect = null;
  let overlayOpen = false;

  function position(element, rect, gap = 8) {
    element.hidden = false;
    const left = Math.max(12, Math.min(window.innerWidth - element.offsetWidth - 12, rect.left));
    const top = Math.max(12, Math.min(window.innerHeight - element.offsetHeight - 12, rect.bottom + gap));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function openOverlay() {
    overlayOpen = true;
    scrim.hidden = false;
    scrim.classList.add("open");
    veil.innerHTML = "";
    const { left, top, right, bottom } = selectionRect;
    [
      ["top", 0, 0, window.innerWidth, top],
      ["right", top, right, window.innerWidth, bottom],
      ["bottom", bottom, 0, window.innerWidth, window.innerHeight],
      ["left", top, 0, left, bottom],
    ].forEach(([side, y, x, width, height]) => {
      const piece = document.createElement("div");
      piece.className = `veil-piece ${side}`;
      piece.style.left = `${x}px`;
      piece.style.top = `${y}px`;
      piece.style.width = `${Math.max(0, width - x)}px`;
      piece.style.height = `${Math.max(0, height - y)}px`;
      veil.appendChild(piece);
    });
    promptBar.hidden = false;
    promptBar.classList.add("open");
    positionOverlay();
  }

  function closeOverlay() {
    overlayOpen = false;
    scrim.classList.remove("open");
    promptBar.classList.remove("open");
    output.classList.remove("open");
    window.setTimeout(() => {
      if (overlayOpen) return;
      scrim.hidden = true;
      promptBar.hidden = true;
      output.hidden = true;
    }, 220);
    hideTip();
    selectedText = "";
    selectionRect = null;
    window.getSelection()?.removeAllRanges();
  }

  function positionOverlay() {
    const gap = 14;
    const barWidth = promptBar.offsetWidth;
    const barHeight = promptBar.offsetHeight;
    const maxBarTop = Math.max(8, window.innerHeight - barHeight - 8);
    const barTop = Math.min(Math.max(8, selectionRect.bottom + gap), maxBarTop);
    const maxLeft = Math.max(8, window.innerWidth - barWidth - 8);
    const barLeft = Math.min(Math.max(8, selectionRect.left), maxLeft);
    promptBar.style.top = `${Math.round(barTop)}px`;
    promptBar.style.left = `${Math.round(barLeft)}px`;
    output.style.top = `${Math.round(barTop + barHeight + gap)}px`;
    output.style.left = `${Math.round(barLeft)}px`;
    output.style.maxHeight = `${Math.max(80, window.innerHeight - barTop - barHeight - gap - 8)}px`;
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    if (!text || text.length < 2 || !main.contains(range.commonAncestorContainer)) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text: text.slice(0, 280), rect };
  }

  function showTip() {
    if (overlayOpen || !promptBar.hidden) return;
    const captured = readSelection();
    if (!captured) {
      hideTip();
      return;
    }
    selectedText = captured.text;
    selectionRect = captured.rect;
    requestAnimationFrame(() => position(tip, selectionRect));
  }

  async function explain(level) {
    hideTip();
    promptBar.hidden = false;
    output.hidden = false;
    status.hidden = false;
    result.textContent = "";
    output.classList.add("open");
    positionOverlay();
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText, level }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      result.textContent = data.explanation;
      status.hidden = true;
    } catch (error) {
      result.textContent = error.message;
      status.hidden = true;
    }
  }

  tip.addEventListener("mousedown", (event) => event.preventDefault());
  tip.addEventListener("click", () => {
    hideTip();
    openOverlay();
  });
  veil.addEventListener("click", closeOverlay);
  promptBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (button) explain(button.dataset.level);
  });
  document.addEventListener("mouseup", (event) => {
    if (!tip.contains(event.target) && !promptBar.contains(event.target)) {
      window.setTimeout(showTip, 0);
    }
  });
  document.addEventListener("selectionchange", () => {
    if (!overlayOpen && promptBar.hidden) window.setTimeout(showTip, 0);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlayOpen) closeOverlay();
  });
  window.addEventListener("resize", () => {
    if (overlayOpen && selectionRect) positionOverlay();
  });
})();
