// Flat-file store. No database on purpose: bundles are small, clicks are an
// append-only log, and both stay readable with `cat` while the shape settles.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.mjs';

const bundlesPath = () => resolve(DATA_DIR, 'bundles.json');
const clicksPath = () => resolve(DATA_DIR, 'clicks.jsonl');

const ensure = () => mkdirSync(DATA_DIR, { recursive: true });

export function readBundles() {
  ensure();
  if (!existsSync(bundlesPath())) return {};
  try {
    return JSON.parse(readFileSync(bundlesPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function writeBundle(bundle) {
  ensure();
  const all = readBundles();
  all[bundle.id] = bundle;
  writeFileSync(bundlesPath(), JSON.stringify(all, null, 2));
  return bundle;
}

export function getBundle(id) {
  return readBundles()[id] ?? null;
}

// One line per click. Written before the redirect so a crash in the redirect
// never silently loses attribution data.
export function logClick(entry) {
  ensure();
  appendFileSync(clicksPath(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

export function readClicks() {
  ensure();
  if (!existsSync(clicksPath())) return [];
  return readFileSync(clicksPath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(l => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}
