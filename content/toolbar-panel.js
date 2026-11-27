(() => {
  const url = new URL(chrome.runtime.getURL("popup/popup.html"));
  const extensionOrigin = `${url.protocol}//${url.host}`;
  let closePanel;

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "ELIX_TOGGLE_PANEL") return;
    if (closePanel) {
      closePanel();
      respond(true);
      return;
    }

    const host = document.createElement("div");
    // The iframe fits the 400px menu and its transparent shadow gutter on both sides.
    host.style.cssText = "all:initial!important;position:fixed!important;top:4px!important;right:4px!important;width:min(472px,calc(100vw - 8px))!important;z-index:2147483647!important";
    const shadow = host.attachShadow({ mode: "closed" });
    const frame = document.createElement("iframe");
    frame.title = "ELIX";
    frame.style.cssText = "display:block;width:100%;height:0;border:0;background:transparent";
    frame.src = `${url}#${encodeURIComponent(message.token)}`;

    const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate) {
      frame.style.opacity = "0";
      frame.style.transform = "scale(0.96)";
      frame.style.transformOrigin = "right center";
      frame.style.transition = "opacity 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
    }

    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    let didOpen = false;
    const timeout = setTimeout(() => {
      didOpen = true;
      closePanel?.();
      respond(false);
    }, 2000);

    closePanel = () => {
      clearTimeout(timeout);
      listeners.abort();
      closePanel = undefined;
      if (!didOpen) {
        didOpen = true;
        respond(true);
      }
      if (!animate || !frame.style.height || frame.style.height === "0px") {
        host.remove();
        return;
      }

      host.style.setProperty("pointer-events", "none", "important");
      frame.inert = true;
      frame.blur();
      frame.style.opacity = "0";
      frame.style.transform = "scale(0.96)";
      Promise.allSettled(frame.getAnimations().map(animation => animation.finished))
        .then(() => host.remove());
    };

    window.addEventListener("message", event => {
      if (event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
      if (event.data?.type === "ELIX_CLOSE_PANEL") {
        closePanel();
        return;
      }
      if (event.data?.type !== "ELIX_PANEL_HEIGHT" || !Number.isFinite(event.data.height)) return;
      frame.style.height = `min(${Math.max(0, event.data.height)}px, calc(100dvh - 8px))`;
      if (!didOpen) {
        didOpen = true;
        clearTimeout(timeout);
        if (animate) {
          frame.getBoundingClientRect();
          frame.style.opacity = "1";
          frame.style.transform = "scale(1)";
        }
        frame.focus();
        respond(true);
      }
    }, options);

    window.addEventListener("pointerdown", event => {
      if (!event.composedPath().includes(host)) closePanel();
    }, options);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape") closePanel();
    }, options);

    shadow.append(frame);
    document.documentElement.append(host);
    return true;
  });
})();
