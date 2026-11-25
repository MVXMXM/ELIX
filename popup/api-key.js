if (window.parent === window) {
  const form = document.querySelector("form");
  const fields = form.querySelector("fieldset");
  const { apiKey } = form.elements;
  const submit = form.querySelector('button[type="submit"]');
  const status = document.querySelector("#status");
  const remove = new URLSearchParams(location.search).get("remove") === "1";

  function syncSubmit() {
    submit.disabled = !apiKey.value.trim();
  }

  apiKey.addEventListener("input", syncSubmit);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const value = apiKey.value.trim();
    if (fields.disabled || (!remove && !value)) return;

    fields.disabled = true;
    try {
      if (remove) await chrome.storage.sync.remove("apiKey");
      else await chrome.storage.sync.set({ apiKey: value });
      status.textContent = remove ? "API key removed." : "API key saved.";
      window.close();
    } catch {
      status.textContent = remove ? "Could not remove the API key. Try again." : "Could not save the API key. Try again.";
      fields.disabled = false;
    }
  });

  if (remove) {
    const cancel = document.querySelector("#cancel-key-removal");
    document.querySelector("h1").textContent = "Delete API key?";
    document.querySelector(".api-key-description").textContent = "This removes the key from ELIX. You can add it again later.";
    document.querySelector(".api-key-icon").style.display = "none";
    apiKey.style.display = "none";
    submit.textContent = "Delete key";
    submit.disabled = false;
    fields.disabled = false;
    cancel.hidden = false;
    cancel.addEventListener("click", () => window.close());
    cancel.focus();
  } else {
    chrome.storage.sync.get({ apiKey: "" }).then(saved => {
      apiKey.value = saved.apiKey;
      syncSubmit();
      fields.disabled = false;
      apiKey.focus();
    }).catch(() => {
      status.textContent = "Could not load the API key. Reopen the editor to try again.";
    });
  }
}
