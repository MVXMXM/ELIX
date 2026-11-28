import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const output = resolve(root, "build/releases");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(output, ".elix-"));
const archive = join(output, `elix-${manifest.version}-chrome.zip`);

const paths = [
  "manifest.json",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(entry => entry.js),
  "content/fonts",
  "icons",
  "popup/api-key.html",
  "popup/api-key.js",
  "popup/popup.bundle.css",
  "popup/popup.bundle.js",
  "popup/popup.css",
  "popup/popup.html",
];

try {
  for (const path of new Set(paths)) {
    await cp(join(root, path), join(stage, path), { recursive: true });
  }
  const temporaryArchive = join(stage, "archive.zip");
  execFileSync("zip", ["-q", "-r", temporaryArchive, "manifest.json", "background.js", "content", "icons", "popup"], {
    cwd: stage,
    stdio: "inherit",
  });
  await cp(temporaryArchive, archive);
  console.log(`Created ${basename(archive)} in ${output}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
