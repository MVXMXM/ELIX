import { readFileSync, writeFileSync } from 'node:fs';

// The last number counts pushes to main. The first two components stay as written.
const versionPath = new URL('../version.json', import.meta.url);
const manifestPath = new URL('../manifest.json', import.meta.url);
const info = JSON.parse(readFileSync(versionPath, 'utf8'));
const parts = String(info.version).split('.').map(Number);

if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error(`extension version must be N.N.N, got ${info.version}`);
}

const [major, minor, patch] = parts;
info.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(versionPath, `${JSON.stringify(info, null, 2)}\n`);

// Chrome and the settings popper read manifest.json. Keep it equal to version.json.
const manifestSource = readFileSync(manifestPath, 'utf8');
const updated = manifestSource.replace(/("version"\s*:\s*")[^"]+(")/, `$1${info.version}$2`);

if (updated === manifestSource) {
  throw new Error('manifest version field was not updated');
}

writeFileSync(manifestPath, updated);
