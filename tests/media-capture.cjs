const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

async function checkBackground() {
  let request;
  let endpoint;
  let listener;
  let storedModel = "gpt-4o-mini";
  let dataConsent = true;
  const chrome = {
    storage: { sync: { get: async defaults => ({ ...defaults, apiKey: "test", dataConsent, mediaEnabled: true, model: storedModel }) } },
    runtime: { onConnect: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    action: { onClicked: { addListener() {} } },
    tabs: { query: async () => [{ id: 7 }], captureVisibleTab: async () => "data:image/png;base64,test" },
  };
  const context = vm.createContext({ chrome, AbortController, TextDecoder, fetch: async (url, options) => {
    endpoint = url;
    request = JSON.parse(options.body);
    return { ok: true, body: new ReadableStream({ start(controller) { controller.close(); } }) };
  } });
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context);
  await vm.runInContext('explainTextStream({imageDataUrl:"data:image/png;base64,test", level:"10"}, new AbortController().signal, () => {})', context);
  assert.equal(endpoint, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.model, "gpt-6-luna");
  assert.equal(request.reasoning_effort, "none");
  assert.equal(request.messages[0].content[1].type, "image_url");
  assert.match(request.messages[0].content[0].text, /10-year-old/);
  storedModel = "gpt-6.1-sol";
  await vm.runInContext('explainTextStream({text:"gravity", level:"5"}, new AbortController().signal, () => {})', context);
  assert.equal(request.model, "gpt-6.1-sol");
  assert.equal(request.reasoning_effort, "low");
  assert.equal(request.temperature, undefined);
  assert.equal(typeof request.messages[0].content, "string");
  const capture = await new Promise(resolve => {
    assert.equal(listener({ type: "ELIX_CAPTURE" }, { tab: { id: 7, windowId: 1 } }, resolve), true);
  });
  assert.ok(capture.dataUrl);
  const denied = await new Promise(resolve => listener({ type: "ELIX_CAPTURE" }, { tab: { id: 8, windowId: 1 } }, resolve));
  assert.match(denied.error, /active/);
  dataConsent = false;
  endpoint = undefined;
  await assert.rejects(
    vm.runInContext('explainTextStream({text:"gravity", level:"5"}, new AbortController().signal, () => {})', context),
    /API key/,
  );
  assert.equal(endpoint, undefined);
  const needsConsent = await new Promise(resolve => listener({ type: "ELIX_CAPTURE" }, { tab: { id: 7, windowId: 1 } }, resolve));
  assert.match(needsConsent.error, /Finish API key setup/);
}

async function checkPopup(browser) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(version => {
      window.savedSettings = { model: "retired-model" };
      window.chrome = {
        runtime: {
          getManifest: () => ({ version }),
          sendMessage: async message => {
            if (message.type === "ELIX_OPEN_API_KEY") {
              window.editorRequest = message;
              return true;
            }
            return message.type === "ELIX_API_KEY_STATUS" && savedSettings.apiKey && savedSettings.dataConsent ? "sk-...TaoA" : null;
          },
        },
        storage: {
          sync: {
            get: async defaults => ({ ...defaults, ...window.savedSettings }),
            set: async settings => Object.assign(window.savedSettings, settings),
            remove: async name => { delete window.savedSettings[name]; },
          },
          onChanged: { addListener(listener) { window.notifySettings = listener; } },
        },
      };
    }, manifest.version);
    await page.goto(pathToFileURL(path.join(root, "popup/popup.html")).href);
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 140, height: 600 });
    const panel = page.locator(".elix-popper");
    assert.equal((await panel.boundingBox()).width, 400);
    await page.evaluate(() => document.documentElement.classList.add("embedded"));
    assert.ok((await panel.boundingBox()).width <= 140);
    await page.evaluate(() => document.documentElement.classList.remove("embedded"));
    await page.setViewportSize(viewport);
    const logo = page.getByRole("img", { name: "ELIX" });
    const instructions = page.getByText("Please add an API key to get started.");
    await logo.waitFor({ state: "visible" });
    await instructions.waitFor({ state: "visible" });
    const wordmarkStyle = await logo.evaluate(el => {
      const { backgroundColor, maskImage } = getComputedStyle(el);
      return { backgroundColor, maskImage };
    });
    assert.equal(wordmarkStyle.backgroundColor, "rgb(0, 187, 255)");
    assert.match(wordmarkStyle.maskImage, /elix-wordmark\.svg/);
    const addApiKey = page.getByRole("button", { name: "Add an API key" });
    await addApiKey.waitFor({ state: "visible" });
    const repo = page.getByRole("link", { name: "View source code", exact: true });
    const settings = page.getByRole("group", { name: "Settings", exact: true });
    const editApiKey = page.getByRole("button", { name: "Edit API Key" });
    const model = page.getByRole("button", { name: "Model", exact: true });
    assert.equal(await repo.getAttribute("href"), "https://github.com/MVXMXM/ELIX");
    assert.equal(await repo.getAttribute("target"), "_blank");
    await editApiKey.waitFor({ state: "hidden" });
    assert.equal(await settings.count(), 0);
    assert.ok((await addApiKey.boundingBox()).y < (await repo.boundingBox()).y);
    await page.evaluate(() => {
      savedSettings.apiKey = "test";
      savedSettings.dataConsent = true;
      notifySettings({ apiKey: { newValue: "test" }, dataConsent: { newValue: true } }, "sync");
    });
    await addApiKey.waitFor({ state: "hidden" });
    await page.getByText("Highlight any text on your screen for an in-situ explanation.").waitFor();
    await settings.waitFor({ state: "visible" });
    await repo.waitFor({ state: "visible" });
    await editApiKey.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Delete API Key" }).waitFor();
    assert.equal(await page.locator("#masked-api-key").textContent(), "sk-...TaoA");
    assert.equal(await page.locator("input[type=password]").count(), 0);
    const modelValue = settings.locator(".maxos-settings-panel-value");
    assert.equal(await modelValue.textContent(), "GPT-6 Luna");
    await model.press("Enter");
    await page.getByRole("button", { name: "GPT-6.1 Sol", exact: true }).click();
    await page.waitForFunction(() => savedSettings.model === "gpt-6.1-sol");
    const images = page.getByRole("switch", { name: "Media input (alpha)" });
    await images.waitFor({ state: "visible" });
    assert.equal(await images.getAttribute("aria-checked"), "false");
    await page.getByText("Media input (alpha)", { exact: true }).click();
    await page.waitForFunction(() => savedSettings.mediaEnabled === true);
    await images.and(page.getByRole("switch", { checked: true })).waitFor();
    await images.press("Space");
    await page.waitForFunction(() => savedSettings.mediaEnabled === false);
    await images.and(page.getByRole("switch", { checked: false })).waitFor();
    await images.press("Space");
    await images.and(page.getByRole("switch", { checked: true })).waitFor();
    await page.waitForFunction(() => savedSettings.mediaEnabled === true);
    assert.equal(await page.getByRole("button", { name: /^(Save|Cancel)$/ }).count(), 0);
    assert.deepEqual(await page.evaluate(() => savedSettings), {
      apiKey: "test", dataConsent: true, model: "gpt-6.1-sol", mediaEnabled: true,
    });
    assert.equal(await modelValue.textContent(), "GPT-6.1 Sol");
    assert.equal(await images.getAttribute("aria-checked"), "true");
    await page.evaluate(() => {
      delete savedSettings.apiKey;
      notifySettings({ apiKey: { oldValue: "test" } }, "sync");
    });
    await addApiKey.click();
    assert.deepEqual(await page.evaluate(() => window.editorRequest), { type: "ELIX_OPEN_API_KEY", remove: false });
    await page.goto(pathToFileURL(path.join(root, "popup/api-key.html")).href);
    const apiKey = page.getByLabel("API key", { exact: true });
    const addMyKey = page.getByRole("button", { name: "Add my key" });
    assert.equal(await apiKey.getAttribute("type"), "password");
    assert.equal(await addMyKey.isDisabled(), true);
    await apiKey.fill("   ");
    assert.equal(await addMyKey.isDisabled(), true);
    await apiKey.fill(" test ");
    assert.equal(await addMyKey.isEnabled(), true);
    await page.getByRole("heading", { name: "Add an API key", exact: true }).waitFor();
    await logo.waitFor({ state: "visible" });
    const platform = page.getByRole("link", { name: "OpenAI API key", exact: true });
    assert.equal(await platform.getAttribute("href"), "https://platform.openai.com/api-keys");
    assert.equal(await platform.getAttribute("target"), "_blank");
    assert.equal(await page.getByRole("checkbox").count(), 0);
    assert.equal(await page.evaluate(() => savedSettings.dataConsent), undefined);
    await addMyKey.click();
    await page.getByRole("status").filter({ hasText: "API key saved." }).waitFor();
    assert.deepEqual(await page.evaluate(() => savedSettings), { apiKey: "test", dataConsent: true, model: "retired-model" });
    await page.goto(pathToFileURL(path.join(root, "popup/api-key.html")).href + "?remove=1");
    await page.getByRole("heading", { name: "Delete API key?" }).waitFor();
    await page.getByRole("button", { name: "Cancel" }).waitFor();
    await page.evaluate(() => { savedSettings.apiKey = "test"; });
    await page.getByRole("button", { name: "Delete key" }).click();
    await page.getByRole("status").filter({ hasText: "API key removed." }).waitFor();
    assert.deepEqual(await page.evaluate(() => savedSettings), { model: "retired-model" });
    assert.ok(manifest.web_accessible_resources.every(entry => !entry.resources.includes("popup/api-key.html")));
  } finally {
    await page.close();
  }
}

(async () => {
  await checkBackground();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ELIX_CHROME_PATH || undefined,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  try {
    await checkPopup(browser);
    for (const viewport of [{ width: 1200, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      const reducedMotion = viewport.width < 500;
      if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent('<style>body{margin:0;min-height:200vh}::-webkit-scrollbar{width:16px}::-webkit-scrollbar-thumb{background:gray}canvas{display:block;margin:40px;width:280px;height:180px}p{margin:40px}</style><canvas width="560" height="360"></canvas><p>Gravity pulls objects together.</p>');
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#20a070"; ctx.fillRect(0, 0, 560, 360);
        ctx.fillStyle = "white"; ctx.font = "40px sans-serif"; ctx.fillText("A diagram", 30, 100);
        window.payloads = [];
        window.savedDefaults = {};
        window.chrome = {
          storage: {
            sync: {
              get: async defaults => ({ ...defaults, apiKey: "test", dataConsent: true, mediaEnabled: true, ...savedDefaults }),
              set: async patch => Object.assign(savedDefaults, patch),
            },
            onChanged: { addListener(listener) { window.changeSettings = listener; } },
          },
          runtime: {
            getManifest: () => ({ version: "0.0.1" }),
            getURL: name => `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${name}`,
            onMessage: { addListener() {} },
            sendMessage: async () => {
              const screenshot = document.createElement("canvas");
              screenshot.width = innerWidth * 2; screenshot.height = innerHeight * 2;
              const c = screenshot.getContext("2d");
              c.fillStyle = "white"; c.fillRect(0, 0, screenshot.width, screenshot.height);
              c.drawImage(canvas, 80, 80, 560, 360);
              return { dataUrl: screenshot.toDataURL() };
            },
            connect: () => ({
              onMessage: { addListener(listener) { window.respondToExplain = listener; } },
              onDisconnect: { addListener() {} },
              disconnect() {},
              postMessage(message) { payloads.push(message.payload); },
            }),
          },
        };
      });
      for (const script of manifest.content_scripts[0].js) {
        await page.addScriptTag({ path: path.join(root, script) });
      }
      const tip = page.locator("#elix-root .tip");
      const dialog = page.getByRole("dialog", { name: "Select an image region" });
      await page.mouse.move(100, 100);
      await tip.waitFor({ state: "visible" });
      await tip.click();
      await dialog.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
      await page.mouse.move(100, 110);
      await tip.click();
      await dialog.waitFor({ state: "visible" });
      // Reverse drag verifies normalization and a 2x screenshot verifies crop scaling.
      await page.mouse.move(240, 180); await page.mouse.down();
      await page.mouse.move(80, 60); await page.mouse.up();
      await page.waitForFunction(() => payloads.length === 1);
      const dimensions = await page.evaluate(async () => {
        const image = new Image(); image.src = payloads[0].imageDataUrl; await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      });
      assert.deepEqual(dimensions, [320, 240]);
      assert.equal(await page.evaluate(() => payloads[0].text), "");
      await page.waitForTimeout(260);
      await page.screenshot({ path: `/tmp/elix-media-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(260);
      await page.mouse.move(100, 120); await tip.click();
      await dialog.waitFor({ state: "visible" });
      await page.setViewportSize({ width: viewport.width - 10, height: viewport.height });
      await dialog.waitFor({ state: "detached" });
      for (const tag of ["img", "video"]) {
        await page.evaluate(tag => {
          const old = document.querySelector("canvas, img, video");
          const element = document.createElement(tag);
          element.style.cssText = "display:block;margin:40px;width:280px;height:180px;background:#20a070";
          old.replaceWith(element);
        }, tag);
        await page.mouse.move(100, tag === "img" ? 125 : 130);
        await tip.waitFor({ state: "visible" });
      }
      // A new text selection must replace the previous media hover target.
      await page.mouse.move(80, 270); await page.mouse.down(); await page.mouse.up();
      const selectionRect = await page.evaluate(() => {
        const paragraph = document.querySelector("p");
        paragraph.style.marginLeft = "40.25px";
        const range = document.createRange(); range.selectNodeContents(paragraph);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
        return range.getBoundingClientRect().toJSON();
      });
      const readPageLayout = () => page.evaluate(() => ({
        gutter: innerWidth - document.documentElement.clientWidth,
        textRight: document.querySelector("p").getBoundingClientRect().right,
        rootOverflow: getComputedStyle(document.documentElement).overflowY,
        bodyOverflow: getComputedStyle(document.body).overflowY,
      }));
      const pageLayout = await readPageLayout();
      assert.equal(pageLayout.gutter, 16);
      await tip.waitFor({ state: "visible" }); await tip.click();
      await page.waitForFunction(() => payloads.length === 2);
      assert.deepEqual(await readPageLayout(), pageLayout);
      const spotlight = await page.evaluate(() => {
        const shadow = document.querySelector("#elix-root").shadowRoot;
        const veil = shadow.querySelector(".veil");
        const svgSource = decodeURIComponent(veil.style.maskImage.split(",")[1].slice(0, -2));
        const svg = new DOMParser().parseFromString(svgSource, "image/svg+xml").documentElement;
        return {
          mark: shadow.querySelector(".marks .mark").getBoundingClientRect().toJSON(),
          hole: [...svg.querySelector('rect[fill="black"]').attributes]
            .filter(attr => attr.name !== "fill")
            .map(attr => Number(attr.value)),
          maskWidth: Number(svg.getAttribute("width")),
          veilWidth: veil.getBoundingClientRect().width,
          barTop: shadow.querySelector(".prompt-bar").offsetTop,
        };
      });
      assert.equal(spotlight.mark.left, selectionRect.left - 2);
      assert.equal(spotlight.mark.right, selectionRect.right + 2);
      assert.deepEqual(spotlight.hole, [
        spotlight.mark.left, spotlight.mark.top, spotlight.mark.width, spotlight.mark.height,
      ]);
      assert.equal(spotlight.maskWidth, spotlight.veilWidth);
      assert.equal(spotlight.barTop, Math.round(spotlight.mark.bottom + 16));
      await page.mouse.move(10, 100);
      await page.mouse.wheel(0, 160);
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(await page.evaluate(() => {
        window.scrollTo(0, 100);
        return scrollY;
      }), 100);
      await page.waitForFunction(() => scrollY === 0);
      assert.match(await page.evaluate(() => payloads[1].text), /Gravity/);
      assert.equal(await page.evaluate(() => payloads[1].imageDataUrl), undefined);

      const loader = page.getByRole("status").filter({ hasText: "Thinking…" });
      const definition = page.locator("#elix-root .result");
      await loader.waitFor({ state: "visible" });
      assert.match(await loader.evaluate(el => getComputedStyle(el).fontFamily), /ELIX Inter/);
      const visibleOnFirstChunk = await page.evaluate(() => {
        const result = document.querySelector("#elix-root").shadowRoot.querySelector(".result");
        const observer = new MutationObserver(() => {
          window.firstRevealedText = result.textContent;
          observer.disconnect();
        });
        observer.observe(result, { childList: true });
        respondToExplain({ type: "chunk", text: "Gravity pulls" });
        return !result.classList.contains("hidden");
      });
      assert.equal(visibleOnFirstChunk, reducedMotion);
      await loader.waitFor({ state: "hidden" });
      await definition.waitFor({ state: "visible" });
      await page.getByText("Gravity pulls", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => firstRevealedText), reducedMotion ? "Gravity pulls" : "Gravity ");
      await page.evaluate(() => {
        respondToExplain({ type: "chunk", text: " things together." });
        respondToExplain({ type: "done" });
      });
      await page.getByText("Gravity pulls things together.", { exact: true }).waitFor({ state: "visible" });

      const ageSelector = page.getByRole("group", { name: "Explanation age" });
      const otherButton = ageSelector.getByRole("button", { name: "Other" });
      const persona = page.getByRole("textbox", { name: "Persona or audience" });
      assert.equal(await page.getByRole("button", { name: "Settings" }).count(), 0);

      const ageFive = ageSelector.getByRole("button", { name: "5", exact: true });
      assert.deepEqual(await ageSelector.getByRole("button").allTextContents(), ["5", "10", "15", "20", "Other"]);
      assert.equal(await ageFive.getAttribute("aria-pressed"), "true");
      const bar = page.locator("#elix-root .prompt-bar");
      const barBefore = await bar.boundingBox();
      const choices = bar.locator(".choices");
      const choicesBefore = await choices.boundingBox();
      await otherButton.click();
      await ageFive.waitFor({ state: "hidden" });
      await persona.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const choices = document.querySelector("#elix-root").shadowRoot.querySelector(".choices");
        return choices.getBoundingClientRect().width === 225;
      });
      const barAfter = await bar.boundingBox();
      const choicesAfter = await choices.boundingBox();
      assert.equal(barAfter.x, barBefore.x);
      if (choicesAfter.y === choicesBefore.y) {
        assert.equal(choicesAfter.x, choicesBefore.x);
      } else {
        assert.equal(choicesAfter.x, barAfter.x);
      }
      assert.equal(choicesAfter.height, 30);
      assert.notEqual(choicesBefore.width, choicesAfter.width);
      assert.equal(await page.getByRole("button", { name: "Cancel" }).count(), 0);

      if (reducedMotion) {
        assert.equal(await persona.getAttribute("placeholder"), "a designer");
        assert.equal(await choices.evaluate(el => getComputedStyle(el).transitionDuration), "0s");
      } else {
        for (const phrase of ["a designer", "a french guy", "a cat"]) {
          await page.waitForFunction(phrase => {
            const input = document.querySelector("#elix-root").shadowRoot.querySelector(".other input");
            return input.placeholder === phrase && input.value === "";
          }, phrase);
        }
      }
      assert.equal(await page.getByRole("button", { name: "Go" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Delete" }).count(), 0);
      const accept = page.getByRole("button", { name: "Accept" });
      const personaBox = await persona.boundingBox();
      const acceptBox = await accept.boundingBox();
      assert.ok(acceptBox.x >= personaBox.x + personaBox.width - 1);
      assert.equal(acceptBox.width, 22);
      assert.equal(acceptBox.height, 22);
      await persona.fill("a tired parent");
      await persona.press("Enter");
      await page.waitForFunction(() => payloads.length === 3);
      assert.equal(await page.evaluate(() => payloads[2].level), "other");
      assert.equal(await page.evaluate(() => payloads[2].freeform), "a tired parent");

      const pill = ageSelector.getByRole("button", { name: "a tired parent" });
      await pill.waitFor({ state: "visible" });
      await ageFive.waitFor({ state: "visible" });
      await persona.waitFor({ state: "hidden" });
      assert.equal(await pill.getAttribute("aria-pressed"), "true");

      assert.equal(await ageFive.getAttribute("aria-pressed"), "false");
      const ageFifteen = ageSelector.getByRole("button", { name: "15", exact: true });
      await ageFifteen.press("Space");
      await page.waitForFunction(() => payloads.length === 4);
      assert.equal(await page.evaluate(() => payloads[3].level), "15");
      assert.equal(await ageFifteen.getAttribute("aria-pressed"), "true");
      assert.equal(await pill.getAttribute("aria-pressed"), "false");

      await pill.click();
      await page.waitForFunction(() => payloads.length === 5);
      assert.equal(await page.evaluate(() => payloads[4].level), "other");
      assert.equal(await page.evaluate(() => payloads[4].freeform), "a tired parent");
      await persona.waitFor({ state: "hidden" });
      assert.equal(await pill.getAttribute("aria-pressed"), "true");

      await pill.click();
      await persona.waitFor({ state: "visible" });
      assert.equal(await persona.inputValue(), "a tired parent");
      await page.screenshot({ path: `/tmp/elix-persona-edit-${viewport.width}.png` });
      await persona.fill("a cat");
      await persona.press("Escape");
      await persona.waitFor({ state: "hidden" });
      await pill.waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => payloads.length), 5);

      const longName = "a very tired parent who wants the short version tonight";
      await pill.click();
      await persona.fill(longName);
      await accept.click();
      await page.waitForFunction(() => payloads.length === 6);
      assert.equal(await page.evaluate(() => payloads[5].freeform), longName);
      const longPill = ageSelector.getByRole("button", { name: longName });
      await longPill.waitFor({ state: "visible" });
      const personaLabels = page.locator(".age-selector .persona-segment-label");
      const labelMetrics = await personaLabels.evaluateAll((labels) => labels.map(label => ({
        width: label.getBoundingClientRect().width,
        truncated: label.scrollWidth > label.clientWidth,
        overflow: getComputedStyle(label).textOverflow,
        paintPadding: getComputedStyle(label).paddingBlockEnd,
      })));
      assert.equal(labelMetrics.length, 2);
      assert.deepEqual(labelMetrics[0], labelMetrics[1]);
      assert.equal(labelMetrics[0].truncated, true);
      assert.equal(labelMetrics[0].overflow, "ellipsis");
      assert.equal(labelMetrics[0].paintPadding, "1px");
      const railBox = await choices.boundingBox();
      const indicatorBox = await page.locator(".segmented-controller-indicator").boundingBox();
      assert.ok(indicatorBox.y >= railBox.y);
      assert.ok(indicatorBox.y + indicatorBox.height <= railBox.y + railBox.height);
      assert.equal(await longPill.getAttribute("title"), longName);
      await page.waitForFunction(() => {
        const shadow = document.querySelector("#elix-root").shadowRoot;
        const rail = shadow.querySelector(".choices").getBoundingClientRect();
        const output = shadow.querySelector(".output").getBoundingClientRect();
        return Math.abs(output.top - rail.bottom - 10) <= 0.5;
      });
      await page.screenshot({ path: `/tmp/elix-persona-${viewport.width}.png` });

      await longPill.click();
      await persona.waitFor({ state: "visible" });
      assert.equal(await persona.inputValue(), longName);
      await persona.fill("");
      await accept.click();
      await page.getByRole("button", { name: "Other" }).waitFor({ state: "visible" });
      await persona.waitFor({ state: "hidden" });
      await ageFive.waitFor({ state: "visible" });

      await page.waitForFunction(() => payloads.length === 7);
      assert.equal(await page.evaluate(() => payloads[6].level), "15");
      assert.equal(await ageFifteen.getAttribute("aria-pressed"), "true");
      assert.deepEqual(await page.evaluate(() => savedDefaults), { defaultLevel: "15", defaultFreeform: "" });

      const segmentStyle = await ageFive.evaluate(el => {
        const { fontFamily, fontSize, letterSpacing } = getComputedStyle(el);
        return { fontFamily, fontSize, letterSpacing };
      });
      assert.match(segmentStyle.fontFamily, /ELIX Inter/);
      assert.equal(segmentStyle.fontSize, "14px");
      assert.equal(segmentStyle.letterSpacing, "normal");
      const resultStyle = await page.locator(".output .result").evaluate((el) => {
        const { fontFamily, fontSize, lineHeight } = getComputedStyle(el);
        return { fontFamily, fontSize, lineHeight };
      });
      assert.match(resultStyle.fontFamily, /^"ELIX Inter"/);
      assert.equal(resultStyle.fontSize, "16px");
      assert.equal(resultStyle.lineHeight, "26px");
      assert.deepEqual(await page.evaluate(async () => {
        const faces = await document.fonts.load('16px "ELIX Inter"');
        return faces.map(face => face.status);
      }), ["loaded"]);
      await page.evaluate(() => changeSettings({ apiKey: { newValue: "" } }, "sync"));
      await page.getByText("API key required. Open ELIX in the Chrome toolbar to add it.").waitFor();
      await page.evaluate(() => changeSettings({ apiKey: { newValue: "test" } }, "sync"));
      await page.waitForFunction(() => payloads.length === 8);
      await page.keyboard.press("Escape");
      await ageFive.waitFor({ state: "hidden" });
      assert.deepEqual(await readPageLayout(), pageLayout);
      await page.mouse.wheel(0, 160);
      await page.waitForFunction(() => scrollY > 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS: toolbar popup, image/text requests, active-tab guard, image/video/canvas hover, Escape, reverse crop at 2x scale, resize cancellation, return to text, desktop and narrow viewport.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
