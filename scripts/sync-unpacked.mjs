#!/usr/bin/env node
// Update this checkout to origin/main, then reload the unpacked ELIX extension.
// Cursor runs this at the start of a thread. A dirty tree is left untouched.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { stdin } from "node:process";

const root = process.cwd();
const notes = [];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function readVersion() {
  try {
    return JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
  } catch {
    return "";
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function updateMain() {
  git(["fetch", "origin", "main"]);
  const dirty = git(["status", "--porcelain"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (dirty) {
    notes.push(
      `Left ${branch} in place because the working tree has uncommitted changes. Latest main was fetched and not checked out.`,
    );
    return;
  }
  if (branch !== "main") git(["checkout", "main"]);
  git(["merge", "--ff-only", "origin/main"]);
  const head = git(["rev-parse", "--short", "HEAD"]);
  notes.push(`This folder is on main at ${head}.`);
}

async function evaluate(ws, id, expression) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not answer")), 2000);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      resolve(message.result?.result?.value);
    }
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true },
    }));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function debuggingPortOpen() {
  try {
    const response = await fetch("http://127.0.0.1:9222/json/version");
    return response.ok;
  } catch {
    return false;
  }
}

function chromeIsRunning() {
  try {
    execFileSync("pgrep", ["-x", "Google Chrome"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureChrome() {
  if (await debuggingPortOpen()) return;

  if (chromeIsRunning()) {
    try {
      execFileSync("osascript", ["-e", 'tell application "Google Chrome" to quit']);
    } catch {
      notes.push("Could not quit Chrome to reopen it with the debugging port.");
      return;
    }
    for (let attempt = 0; attempt < 40 && chromeIsRunning(); attempt += 1) {
      await sleep(250);
    }
  }

  const child = spawn("open", ["-a", "Google Chrome", "--args", "--remote-debugging-port=9222"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await debuggingPortOpen()) {
      notes.push("Reopened Chrome with the debugging port. Later threads only reload the extension.");
      return;
    }
    await sleep(250);
  }
  notes.push("Chrome did not open the debugging port, so the extension was not reloaded.");
}

async function reloadExtension() {
  await ensureChrome();
  if (!(await debuggingPortOpen())) return;

  let targets;
  try {
    const response = await fetch("http://127.0.0.1:9222/json/list");
    if (!response.ok) throw new Error(String(response.status));
    targets = await response.json();
  } catch {
    notes.push("Chrome is not listening on port 9222, so the unpacked extension was not reloaded.");
    return;
  }

  const workers = targets.filter(
    (target) => target.type === "service_worker" && target.webSocketDebuggerUrl,
  );
  for (const target of workers) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket timeout")), 2000);
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.addEventListener("error", () => reject(new Error("socket error")));
      });
      const name = await evaluate(ws, 1, "chrome.runtime.getManifest().name");
      if (name !== "ELIX") {
        ws.close();
        continue;
      }
      await evaluate(ws, 2, "chrome.runtime.reload()");
      notes.push("Reloaded the unpacked ELIX extension.");
      return;
    } catch {
      try { ws.close(); } catch { /* reload closes the socket */ }
    }
  }
  notes.push("No running ELIX extension was found to reload. Load this folder unpacked in Chrome.");
}

await readStdin();
try {
  updateMain();
} catch (error) {
  const message = String(error.stderr || error.message || error).split("\n")[0];
  notes.push(`Could not update main: ${message}`);
}
await reloadExtension();
const version = readVersion();
if (version) notes.push(`manifest.json says ${version}.`);

process.stdout.write(JSON.stringify({ additional_context: notes.join(" ") }));
