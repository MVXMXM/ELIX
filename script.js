(() => {
  const main = document.querySelector("main");
  const tip = document.querySelector(".tip");
  const promptBar = document.querySelector(".prompt-bar");
  const output = document.querySelector(".output");
  const scrim = document.querySelector(".scrim");
  const veil = scrim.querySelector(".veil");
  const selectionMark = scrim.querySelector(".selection-mark");
  const status = output.querySelector(".status");
  const result = output.querySelector(".result");
  let selectedText = "";
  let selectionRect = null;

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
    scrim.hidden = false;
    selectionMark.style.left = `${selectionRect.left}px`;
    selectionMark.style.top = `${selectionRect.top}px`;
    selectionMark.style.width = `${selectionRect.width}px`;
    selectionMark.style.height = `${selectionRect.height}px`;
    promptBar.hidden = false;
    position(promptBar, selectionRect);
  }

  function closeOverlay() {
    scrim.hidden = true;
    promptBar.hidden = true;
    output.hidden = true;
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
    if (!promptBar.hidden) return;
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
    position(promptBar, selectionRect);
    position(output, selectionRect, 48);
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
    if (promptBar.hidden) window.setTimeout(showTip, 0);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !scrim.hidden) closeOverlay();
  });
})();
