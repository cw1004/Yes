/**
 * 팔레트 대비 검사기.
 *
 * 색을 눈대중으로 고르면 "밝게 했더니 안 보인다"가 반복됩니다.
 * 앱에서 실제로 겹쳐 쓰는 조합만 골라 WCAG 대비를 계산합니다.
 *   본문 텍스트 4.5:1 (AA) · 컨트롤 경계/아이콘 3:1 · 장식 구분선 1.4:1
 *
 *   node scripts/contrast.mjs          두 테마 모두
 *   node scripts/contrast.mjs light    한쪽만
 *
 * 실패가 있으면 종료 코드 1 — 배포 전 검사에 그대로 걸 수 있습니다.
 */
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

const blockAt = (marker) => {
  const i = css.indexOf(marker)
  if (i < 0) throw new Error(`${marker} 블록을 찾지 못했습니다.`)
  const start = css.indexOf('{', i)
  return css.slice(start, css.indexOf('\n}', start))
}
const readTokens = (block) =>
  Object.fromEntries([...block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]))

const dark = readTokens(blockAt('@theme {'))
const light = { ...dark, ...readTokens(blockAt(":root[data-theme='light']")) }

const rgb = (h) => {
  const s = h.slice(1)
  const n = s.length === 3 ? [...s].map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}
const lum = (h) =>
  rgb(h)
    .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** bg-amber-brand/8 같은 반투명 면은 아래 배경과 합성해야 실제 색이 나옵니다. */
const over = (fg, bg, alpha) =>
  '#' +
  rgb(fg)
    .map((v, i) => Math.round(v * alpha + rgb(bg)[i] * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')

/** 색 지정: 'token' 또는 ['token', alpha, 'base토큰'] */
const resolve = (spec, t) =>
  Array.isArray(spec) ? over(t[spec[0]], t[spec[2]], spec[1]) : t[spec]

/** [설명, 앞색, 뒷색, 최소대비] */
const CASES = [
  ['본문 (패널)', 'mist-200', 'ink-900', 4.5],
  ['본문 (페이지)', 'mist-200', 'ink-950', 4.5],
  ['보조 텍스트', 'mist-300', 'ink-900', 4.5],
  ['설명 텍스트', 'mist-400', 'ink-900', 4.5],
  ['흐린 텍스트 (패널)', 'mist-500', 'ink-900', 4.5],
  ['흐린 텍스트 (카드)', 'mist-500', 'ink-850', 4.5],
  ['흐린 텍스트 (칩)', 'mist-500', 'ink-800', 4.5],
  ['배지 글자 (중립)', 'mist-300', 'ink-700', 4.5],
  ['버튼 라벨 (앰버)', 'on-brand', 'amber-brand', 4.5],
  ['버튼 라벨 (앰버 끝)', 'on-brand', 'amber-deep', 4.5],
  ['버튼 라벨 (에메랄드)', 'on-brand', 'emerald-brand', 4.5],
  ['버튼 라벨 (에메랄드 끝)', 'on-brand', 'emerald-deep', 4.5],
  ['앰버 글자 (패널)', 'amber-brand', 'ink-900', 4.5],
  ['앰버 글자 (15% 칩)', 'amber-brand', ['amber-brand', 0.15, 'ink-900'], 4.5],
  ['앰버 글자 (8% 배너)', 'amber-brand', ['amber-brand', 0.08, 'ink-900'], 4.5],
  ['에메랄드 글자 (패널)', 'emerald-brand', 'ink-900', 4.5],
  ['에메랄드 글자 (10% 칩)', 'emerald-brand', ['emerald-brand', 0.1, 'ink-900'], 4.5],
  ['컨트롤 테두리', 'line', 'ink-900', 3],
  ['컨트롤 테두리 (카드 위)', 'line', 'ink-850', 3],
  ['호버 테두리', 'line-strong', 'ink-900', 3],
  ['선택된 앰버 테두리', 'amber-brand', 'ink-900', 3],
  ['선택된 에메랄드 테두리', 'emerald-brand', 'ink-900', 3],
  /*
   * 반투명 앰버 테두리(/30 · /50)는 선택 상태를 혼자 나타내지 않습니다.
   * 컨트롤의 경계는 line(3:1)이 맡고, 그 위에 틴트 배경 + 앰버 글자가 함께 상태를 알립니다.
   * 그래서 이 선들의 기준은 비텍스트 3:1 이 아니라 "보이기는 해야 한다" 수준입니다.
   */
  ['강조 테두리 (50%, 장식)', ['amber-brand', 0.5, 'ink-900'], 'ink-900', 1.4],
  ['강조 테두리 (30%, 장식)', ['amber-brand', 0.3, 'ink-900'], 'ink-900', 1.25],
  ['포커스 링', 'amber-brand', 'ink-900', 3],
  ['구분선', 'line-soft', 'ink-900', 1.4],
  ['페이지 vs 패널', 'ink-950', 'ink-900', 1.06],
]

const check = (name, t) => {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
  let fails = 0
  for (const [label, fgSpec, bgSpec, min] of CASES) {
    const fg = resolve(fgSpec, t)
    const bg = resolve(bgSpec, t)
    const r = ratio(fg, bg)
    const ok = r >= min
    if (!ok) fails++
    console.log(
      `  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(24)} ${r.toFixed(2).padStart(6)}:1  (≥${min})  ${fg} / ${bg}`,
    )
  }
  console.log(fails ? `  \x1b[31m${fails}건 미달\x1b[0m` : '  \x1b[32m전부 통과\x1b[0m')
  return fails
}

const want = process.argv[2]
let fails = 0
if (want !== 'light') fails += check('다크 테마', dark)
if (want !== 'dark') fails += check('라이트 테마', light)
console.log('')
process.exit(fails ? 1 : 0)
