/**
 * 단일 파일 데모 빌더.
 *
 * 앱을 링크 하나로 열어볼 수 있게, ES 모듈들을 의존성 순서대로 이어붙이고
 * import/export 를 제거해 하나의 인라인 모듈로 만든다.
 * 서버가 하던 일(권한 게이팅·결제·랭킹)은 scripts/demo-runtime.js 가 대신한다.
 *
 *   node scripts/build-demo.mjs [출력경로]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'demo.html');

const ORDER = [
  'public/js/engine/color.js',
  'public/js/engine/skinmask.js',
  'public/js/engine/quality.js',
  'public/js/engine/metrics.js',
  'public/js/engine/diagnose.js',
  'public/js/engine/intake.js',
  'public/js/engine/consult.js',
  'public/js/engine/ranking.js',
  'public/js/storage.js',
  'public/js/sim/faces.js',
  'public/js/sim/personas.js',
  'public/js/ui/render.js',
  'public/js/ui/doctor.js',
  'public/js/ui/compare.js',
  'public/js/ui/camera.js',
  '__RUNTIME__',
  'public/js/app.js',
];

/** import 문 제거 + export 키워드 제거 */
function flatten(src, file) {
  let out = src
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+\{[\s\S]*?\};?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const __default_' + path.basename(file, '.js').replace(/\W/g, '_') + ' = ')
    .replace(/^export\s+/gm, '');
  if (/^\s*(import|export)\s/m.test(out)) {
    throw new Error(`${file}: 처리하지 못한 import/export 가 남아 있습니다.`);
  }
  return out;
}

/** 최상위 선언 이름 수집 (중복이면 번들이 조용히 깨진다) */
function topLevelNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

const catalog = fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8');
const seen = new Map();
const parts = [];

for (const rel of ORDER) {
  const file = rel === '__RUNTIME__' ? 'scripts/demo-runtime.js' : rel;
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (rel === '__RUNTIME__') src = src.replace('__CATALOG__', catalog);
  let flat = flatten(src, file);
  // 서비스워커는 자체 호스팅 서버에만 있다 — 데모(단일 파일)에서는 404 를 낸다
  flat = flat.replace(/^\s*if \('serviceWorker' in navigator\).*$/gm, '');
  for (const n of topLevelNames(flat)) {
    if (seen.has(n)) throw new Error(`이름 충돌: '${n}' (${seen.get(n)} 와 ${file})`);
    seen.set(n, file);
  }
  parts.push(`/* ── ${file} ── */\n${flat.trim()}\n`);
}

// index.html 의 본문 마크업만 가져온다 (아티팩트는 <html>/<head>/<body> 를 직접 쓰지 않는다)
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
let body = html
  .slice(html.indexOf('<div id="app">'), html.indexOf('<script type="module"'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();
// 데모는 한 파일이라 /legal.html 이 없다. 깨진 링크를 두느니 안내로 바꾼다.
body = body.replace(/<p class="fineprint legal-links">[\s\S]*?<\/p>/g,
  '<p class="fineprint">약관·개인정보처리방침은 실제 배포본에 포함됩니다 (/legal.html).</p>');
const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

const demoBanner = `
<div class="demo-banner">
  <b>데모 모드</b> — 서버 없이 브라우저에서만 동작합니다. 결제는 모의 결제이며 실제로 청구되지 않습니다.
  사진과 기록은 이 브라우저에만 저장됩니다. 카메라가 차단된 환경에서는 <b>‘사진 선택’</b>으로 진단하세요.
</div>`;

const out = `<title>SkinLab AI</title>
<style>
${css}
.demo-banner{max-width:520px;margin:0 auto;padding:11px 16px;font-size:12px;line-height:1.6;
  background:linear-gradient(101deg,rgba(255,138,155,.16),rgba(232,192,125,.1));
  border-bottom:1px solid var(--line);color:var(--muted)}
.demo-banner b{color:var(--accent-2)}
</style>
${demoBanner}
${body}
<script type="module">
${parts.join('\n').replace(/<\/script/gi, '<\\/script')}
</script>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`데모 빌드 완료: ${OUT} (${(out.length / 1024).toFixed(0)} KB, 모듈 ${ORDER.length}개)`);
