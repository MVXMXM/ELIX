import { readFileSync, writeFileSync } from 'node:fs';

// The last number counts pushes to main. The first two components stay as written.
// Edit the field in place so the rest of the manifest stays as written.
const path = new URL('../manifest.json', import.meta.url);
const source = readFileSync(path, 'utf8');
const current = JSON.parse(source).version;
const parts = String(current).split('.').map(Number);

if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error(`extension version must be N.N.N, got ${current}`);
}

const [major, minor, patch] = parts;
const next = `${major}.${minor}.${patch + 1}`;
const updated = source.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
if (updated === source) throw new Error('manifest version field was not updated');
writeFileSync(path, updated);
