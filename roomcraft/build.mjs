// Builds ROOMCRAFT Auto Factory into a single HTML file.
//
//   node build.mjs         -> dist/Roomcraft-Auto-Factory-V3.html   (self-contained; opens offline)
//   node build.mjs --cdn   -> dist/Roomcraft-Auto-Factory-V3.cdn.html (React from cdnjs; smaller)
//
// Either way the app source, the Tailwind stylesheet and the five product
// cutouts are inlined, so there is nothing to serve and nothing to install.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, 'dist');
const tmp = resolve(root, '.build');

const REACT_VERSION = '18.3.1';
const TITLE = 'ROOMCRAFT Auto Factory';
const useCdn = process.argv.includes('--cdn');
const outFile = useCdn ? 'Roomcraft-Auto-Factory-V3.cdn.html' : 'Roomcraft-Auto-Factory-V3.html';

mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

// 1. App source -> one IIFE bundle, product images inlined as data URIs.
await build({
  entryPoints: [resolve(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  jsx: 'transform',
  loader: { '.webp': 'dataurl' },
  alias: {
    react: resolve(root, 'src/shims/react.ts'),
    'react-dom/client': resolve(root, 'src/shims/react-dom-client.ts'),
  },
  outfile: resolve(tmp, 'app.js'),
  logLevel: 'info',
});

// 2. Tailwind -> one stylesheet, only the classes the source actually uses.
execFileSync(
  resolve(root, 'node_modules/.bin/tailwindcss'),
  ['-c', resolve(root, 'tailwind.config.js'), '-i', resolve(root, 'src/index.css'), '-o', resolve(tmp, 'app.css'), '--minify'],
  { stdio: 'inherit', cwd: root },
);

const js = readFileSync(resolve(tmp, 'app.js'), 'utf8');
const css = readFileSync(resolve(tmp, 'app.css'), 'utf8');

// React either comes off cdnjs or rides along inside the file.
const umd = [
  ['react', 'umd/react.production.min.js'],
  ['react-dom', 'umd/react-dom.production.min.js'],
];
const reactTags = umd
  .map(([pkg, file]) =>
    useCdn
      ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/${pkg}/${REACT_VERSION}/${file}"></script>`
      : `<script>${readFileSync(resolve(root, 'node_modules', pkg, file), 'utf8')}</script>`,
  )
  .join('\n');

const html = `<title>${TITLE}</title>
<meta name="description" content="상품 링크 하나로 영상·캡션·SNS 발행까지 잇는 ROOMCRAFT 워크플로 데모">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;500;700;900&display=swap">
<style>${css}</style>

<div id="root"></div>

${reactTags}
<script>${js}</script>
`;

writeFileSync(resolve(out, outFile), html);
rmSync(tmp, { recursive: true, force: true });
console.log(`\ndist/${outFile}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
