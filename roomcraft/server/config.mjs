// Configuration, all from the environment. Nothing here is baked into the build.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ?? resolve(ROOT, '.data');

export const PORT = Number(process.env.PORT ?? 8787);
export const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN ?? `http://localhost:${PORT}`).replace(/\/$/, '');

export const COUPANG = {
  accessKey: process.env.COUPANG_ACCESS_KEY ?? '',
  secretKey: process.env.COUPANG_SECRET_KEY ?? '',
  subId: process.env.COUPANG_SUB_ID ?? '',
};

export const AMAZON = {
  tag: process.env.AMAZON_ASSOCIATE_TAG ?? '',
};

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

// How many products ride on one video. Six is the working default: enough entry
// points to cover a room, few enough that the landing page stays scannable.
export const BUNDLE_SIZE = Number(process.env.BUNDLE_SIZE ?? 6);

// Everything the revenue model assumes, in one place, because every one of
// these is a guess until real click data replaces it.
export const ASSUMPTIONS = {
  // Commission rate by platform+category. These are placeholders — replace them
  // with the rates on your own partner dashboard before trusting any figure.
  commission: {
    Coupang: { default: 0.03, furniture: 0.03, home: 0.03, digital: 0.005 },
    Amazon: { default: 0.03, furniture: 0.03, home: 0.03, digital: 0.02 },
    AliExpress: { default: 0.05, furniture: 0.05, home: 0.05, digital: 0.03 },
  },
  // Baseline click→purchase rate inside the attribution window.
  baseConversion: 0.025,
  // Attribution window in hours — the reason a bundle beats a single product.
  attributionHours: 24,
  // Share of a video's clicks that lands on each slot, by position.
  // Front-loaded: the hero gets most of it. Tune from your own gateway log.
  slotClickShare: [0.34, 0.22, 0.15, 0.12, 0.1, 0.07],
};

export const hasAnthropicKey = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
