const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");

async function checkBackground() {
  let request;
  let listener;
  const chrome = {
    storage: { sync: { get: async defaults => ({ ...defaults, apiKey: "test" }) } },
    runtime: { onConnect: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    action: { onClicked: { addListener() {} } },
    tabs: { query: async () => [{ id: 7 }], captureVisibleTab: async () => "data:image/png;base64,test" },
  };
  const context = vm.createContext({ chrome, AbortController, TextDecoder, fetch: async (url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, body: new ReadableStream({ start(controller) { controller.close(); } }) };
  } });
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context);
  await vm.runInContext('explainTextStream({imageDataUrl:"data:image/png;base64,test", level:"10"}, new AbortController().signal, () => {})', context);
  assert.equal(request.messages[0].content[1].type, "image_url");
  assert.match(request.messages[0].content[0].text, /10-year-old/);
  await vm.runInContext('explainTextStream({text:"gravity", level:"5"}, new AbortController().signal, () => {})', context);
  assert.equal(typeof request.messages[0].content, "string");
  const capture = await new Promise(resolve => {
    assert.equal(listener({ type: "ELIX_CAPTURE" }, { tab: { id: 7, windowId: 1 } }, resolve), true);
  });
  assert.ok(capture.dataUrl);
  const denied = await new Promise(resolve => listener({ type: "ELIX_CAPTURE" }, { tab: { id: 8, windowId: 1 } }, resolve));
  assert.match(denied.error, /active/);
}

(async () => {
  await checkBackground();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.ELIX_CHROME_PATH || undefined });
  try {
    for (const viewport of [{ width: 1200, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent('<style>body{margin:0}canvas{display:block;margin:40px;width:280px;height:180px}p{margin:40px}</style><canvas width="560" height="360"></canvas><p>Gravity pulls objects together.</p>');
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#20a070"; ctx.fillRect(0, 0, 560, 360);
        ctx.fillStyle = "white"; ctx.font = "40px sans-serif"; ctx.fillText("A diagram", 30, 100);
        window.payloads = [];
        window.chrome = {
          storage: { sync: { get: async defaults => ({ ...defaults, apiKey: "test" }) }, onChanged: { addListener() {} } },
          runtime: {
            sendMessage: async () => {
              const screenshot = document.createElement("canvas");
              screenshot.width = innerWidth * 2; screenshot.height = innerHeight * 2;
              const c = screenshot.getContext("2d");
              c.fillStyle = "white"; c.fillRect(0, 0, screenshot.width, screenshot.height);
              c.drawImage(canvas, 80, 80, 560, 360);
              return { dataUrl: screenshot.toDataURL() };
            },
            connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(message) { payloads.push(message.payload); } }),
          },
        };
      });
      await page.addScriptTag({ path: path.join(root, "content/content.js") });
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
      await page.evaluate(() => {
        const range = document.createRange(); range.selectNodeContents(document.querySelector("p"));
        getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      });
      await tip.waitFor({ state: "visible" }); await tip.click();
      await page.waitForFunction(() => payloads.length === 2);
      assert.match(await page.evaluate(() => payloads[1].text), /Gravity/);
      assert.equal(await page.evaluate(() => payloads[1].imageDataUrl), undefined);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS: image/text requests, active-tab guard, image/video/canvas hover, Escape, reverse crop at 2x scale, resize cancellation, return to text, desktop and narrow viewport.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
