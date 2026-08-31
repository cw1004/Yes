/**
 * 단일 HTML 데모 빌드.
 *
 * dist/ 는 index.html + /assets/*.js + /assets/*.css 로 나뉘어 있어서
 * 파일 하나만 열어서는 동작하지 않습니다. 여기서 전부 인라인해 한 파일로 만듭니다.
 *
 * 서버가 없으면 앱은 목(mock) 모드로 떨어집니다 — 스튜디오·무드보드·정산 계산·
 * 제휴 딥링크는 그대로 동작하고, 계정/결제/실제 AI 렌더만 빠집니다.
 *
 *   npm run build && node scripts/bundle-standalone.mjs [출력경로]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const out = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || join(dist, 'standalone.html')

const assets = readdirSync(join(dist, 'assets'))
const pick = (ext) => {
  const found = assets.filter((f) => f.endsWith(ext))
  if (found.length !== 1) throw new Error(`assets/*${ext} 가 ${found.length}개입니다. 코드 분할이 켜졌는지 확인하세요.`)
  return readFileSync(join(dist, 'assets', found[0]), 'utf8')
}

const css = pick('.css')
const js = pick('.js')
const boot = readFileSync(join(root, 'public', 'boot.js'), 'utf8')

/* --title=... 로 제목을 덮어쓸 수 있습니다. 갤러리에 올릴 때는 짧은 이름이 낫습니다. */
const titleArg = process.argv.find((a) => a.startsWith('--title='))
const title =
  titleArg?.slice('--title='.length) ||
  (readFileSync(join(root, 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/) ?? [, 'RoomCraft AI'])[1]

/*
 * 스크립트 본문에 </script> 가 들어 있으면 거기서 태그가 닫혀 페이지가 깨집니다.
 * 문자열 리터럴 안에 있어도 파서는 구분하지 않으므로 이스케이프합니다.
 */
const escapeScriptEnd = (s) => s.replace(/<\/script/gi, '<\\/script')

/*
 * 문서 charset 이 UTF-8 이 아니면 한글이 전부 깨집니다. 완전한 문서를 낼 때는
 * <meta charset> 을 우리가 붙이지만, --fragment 로 낼 때는 <head> 가 남의 것이라
 * 보장할 수 없습니다. 문자열 안의 비ASCII 문자를 \uXXXX 로 바꿔 두면
 * 소스 자체가 순수 ASCII 가 되어 어떤 charset 으로 읽혀도 같은 문자열이 나옵니다.
 * (서로게이트 페어도 코드 유닛 단위로 그대로 보존됩니다.)
 */
const toAscii = (s) =>
  s.replace(/[^\x00-\x7F]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

/*
 * 기본은 완전한 HTML 문서입니다. charset 을 빼면 브라우저가 UTF-8 로 읽지 않아
 * 한글이 전부 깨집니다 — 파일을 그냥 열었을 때(file://)나 charset 을 안 붙이는
 * 정적 서버에서 실제로 깨졌습니다.
 *
 * --fragment 는 <head> 를 스스로 만들어 주는 호스트(예: 아티팩트)에 올릴 때 씁니다.
 */
const fragment = process.argv.includes('--fragment')
const safe = (s) => (fragment ? toAscii(escapeScriptEnd(s)) : escapeScriptEnd(s))

const entities = (s) =>
  s.replace(/[^\x00-\x7F]/g, (c) => `&#x${c.codePointAt(0).toString(16)};`)

const body = `<title>${fragment ? entities(title) : title}</title>
<style>
${css}
</style>

<!-- 첫 페인트 전에 테마/글자 크기를 적용해 화면 번쩍임을 막습니다. -->
<script>
${safe(boot)}
</script>

<div id="root"></div>

<script type="module">
${safe(js)}
</script>
`

const html = fragment
  ? body
  : `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${body}</body>
</html>
`

writeFileSync(out, html)
const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`${out} — ${kb} KB${fragment ? ' (fragment)' : ''}`)
