(() => {
  const action = document.querySelector(".selection-action");
  const explainButton = action.querySelector("button");
  const explanation = document.querySelector(".explanation");
  const closeButton = explanation.querySelector(".close-explanation");
  const status = explanation.querySelector(".explanation-status");
  const result = explanation.querySelector(".explanation-result");
  let selectedText = "";

  function hideAction() {
    action.hidden = true;
  }

  function showAction() {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

    if (!text || !range || !document.querySelector("main").contains(range.commonAncestorContainer)) {
      selectedText = "";
      hideAction();
      return;
    }

    selectedText = text.slice(0, 280);
    action.hidden = false;
    const rect = range.getBoundingClientRect();
    action.style.left = `${Math.min(
      window.innerWidth - action.offsetWidth - 16,
      Math.max(16, rect.left + rect.width / 2 - action.offsetWidth / 2)
    )}px`;
    action.style.top = `${Math.max(16, rect.bottom + 10)}px`;
  }

  async function explain() {
    if (!selectedText) return;
    hideAction();
    explanation.hidden = false;
    explanation.classList.add("is-loading");
    status.hidden = false;
    result.textContent = "";

    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to explain that selection.");
      result.textContent = data.explanation;
      status.hidden = true;
    } catch (error) {
      result.textContent = error.message;
      status.hidden = true;
    } finally {
      explanation.classList.remove("is-loading");
    }
  }

  document.addEventListener("mouseup", (event) => {
    if (!action.contains(event.target) && !explanation.contains(event.target)) {
      window.setTimeout(showAction, 0);
    }
  });
  document.addEventListener("selectionchange", () => {
    if (!explanation.hidden) return;
    window.setTimeout(showAction, 0);
  });
  explainButton.addEventListener("click", explain);
  closeButton.addEventListener("click", () => {
    explanation.hidden = true;
    selectedText = "";
  });
})();
