import { readFileSync, writeFileSync } from 'node:fs';

// The last number counts pushes to main. The first two components stay as written.
// Chrome and the settings popper both read this field.
const manifestPath = new URL('../manifest.json', import.meta.url);
const manifestSource = readFileSync(manifestPath, 'utf8');
const current = JSON.parse(manifestSource).version;
const parts = String(current).split('.').map(Number);

if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error(`extension version must be N.N.N, got ${current}`);
}

const [major, minor, patch] = parts;
const next = `${major}.${minor}.${patch + 1}`;
const updated = manifestSource.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);

if (updated === manifestSource || JSON.parse(updated).manifest_version !== 3) {
  throw new Error('manifest version field was not updated');
}

writeFileSync(manifestPath, updated);
