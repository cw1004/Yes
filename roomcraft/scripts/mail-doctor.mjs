/**
 * 메일 설정 점검기.
 *
 *   node scripts/mail-doctor.mjs --domain roomcraft.com
 *   node scripts/mail-doctor.mjs --domain roomcraft.com --selector s1 --send me@example.com
 *
 * 이 앱은 이메일 인증을 마쳐야 크레딧이 지급됩니다.
 * 인증 메일이 스팸함으로 가면 그 사용자는 그냥 이탈하므로,
 * 메일 도달률이 곧 활성화율입니다.
 *
 * SPF·DKIM·DMARC 를 "설정했는가" 가 아니라 "정렬(alignment)되어 있는가" 까지 봅니다.
 * 셋 다 있어도 From: 도메인과 정렬되지 않으면 DMARC 는 실패합니다.
 */
import { resolveMx, resolveTxt } from 'node:dns/promises'
import { readFileSync } from 'node:fs'

// .env 로더 (서버와 동일한 최소 구현)
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  // .env 가 없으면 실제 환경변수만 사용합니다.
}

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const results = []
const ok = (label, detail = '') => results.push({ level: 'ok', label, detail })
const warn = (label, detail = '', fix = '') => results.push({ level: 'warn', label, detail, fix })
const fail = (label, detail = '', fix = '') => results.push({ level: 'fail', label, detail, fix })

/**
 * TXT 조회.
 *
 * "레코드가 없다" 와 "조회하지 못했다" 는 다른 상태입니다.
 * 타임아웃을 '없음' 으로 처리하면 멀쩡한 설정을 실패로 보고하게 됩니다.
 *   []   → 레코드 없음 (확정)
 *   null → 조회 실패 (판정 불가)
 */
const txt = async (name, attempts = 2) => {
  for (let i = 0; i < attempts; i++) {
    try {
      return (await resolveTxt(name)).map((chunks) => chunks.join(''))
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return []
      if (i === attempts - 1) {
        unresolved.push(`${name} (${err.code})`)
        return null
      }
    }
  }
  return null
}

const unresolved = []

// ── 도메인 결정 ────────────────────────────────────────────────────────
const mailFrom = process.env.MAIL_FROM || ''
const fromAddress = mailFrom.match(/<([^>]+)>/)?.[1] ?? mailFrom.trim()
const fromDomain = fromAddress.split('@')[1]?.toLowerCase()
const appDomain = (() => {
  try {
    return new URL(process.env.APP_URL ?? '').hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
})()

const domain = (arg('domain') ?? fromDomain ?? appDomain)?.toLowerCase()
if (!domain) {
  console.error('점검할 도메인을 알 수 없습니다. --domain 을 주거나 MAIL_FROM / APP_URL 을 설정하세요.')
  process.exit(2)
}

console.log(`\n메일 설정 점검: ${domain}\n${'─'.repeat(50)}`)

// ── From: 도메인 정렬 ─────────────────────────────────────────────────
// DMARC 는 From: 헤더의 도메인을 기준으로 판정합니다.
// 발신 주소가 다른 도메인이면 SPF/DKIM 이 통과해도 DMARC 는 실패합니다.
if (!mailFrom) {
  warn('MAIL_FROM 미설정', '기본값(no-reply@roomcraft.local)으로 발송됩니다.', 'MAIL_FROM 을 실제 도메인 주소로 설정하세요.')
} else if (!fromDomain) {
  fail('MAIL_FROM 형식 오류', mailFrom, '"RoomCraft <no-reply@도메인>" 형식으로 설정하세요.')
} else if (fromDomain !== domain && !fromDomain.endsWith(`.${domain}`)) {
  fail(
    'From: 도메인 불일치',
    `MAIL_FROM=${fromDomain} 인데 점검 도메인은 ${domain} 입니다.`,
    'DMARC 는 From: 도메인 기준으로 판정합니다. 두 도메인을 맞추세요.',
  )
} else {
  ok('From: 도메인 정렬', fromAddress)
}

if (appDomain && fromDomain && appDomain !== fromDomain) {
  warn(
    '앱 도메인과 발신 도메인이 다름',
    `앱 ${appDomain} · 발신 ${fromDomain}`,
    '같은 도메인으로 맞추면 도달률과 신뢰도가 올라갑니다.',
  )
}

// ── SPF ───────────────────────────────────────────────────────────────
const spfLookup = await txt(domain)
const spfRecords = spfLookup?.filter((r) => r.toLowerCase().startsWith('v=spf1'))
if (!spfLookup) {
  warn('SPF 판정 불가', 'DNS 조회에 실패했습니다.', '네트워크를 확인하고 다시 실행하세요.')
} else if (!spfRecords.length) {
  fail('SPF 없음', `${domain} 에 v=spf1 TXT 레코드가 없습니다.`, '발송 서비스가 안내하는 include 를 담은 SPF 를 추가하세요.')
} else if (spfRecords.length > 1) {
  fail(
    'SPF 중복',
    `${spfRecords.length}개가 있습니다.`,
    'SPF 는 도메인당 하나여야 합니다. 둘 이상이면 permerror 로 전부 무효가 됩니다. 하나로 합치세요.',
  )
} else {
  const spf = spfRecords[0]
  // SPF 는 DNS 조회 10회 제한이 있고, 넘으면 permerror 로 전체가 실패합니다.
  const lookups = (spf.match(/\b(include|a|mx|ptr|exists|redirect)[:=]/g) ?? []).length
  const all = spf.match(/([-~?+])all\b/)?.[1]

  if (all === '+') {
    fail('SPF 가 +all', spf, '누구나 이 도메인으로 발송할 수 있습니다. -all 또는 ~all 로 바꾸세요.')
  } else if (!all) {
    warn('SPF 에 all 메커니즘 없음', spf, '끝에 ~all 또는 -all 을 붙여 정책을 명시하세요.')
  } else {
    ok('SPF', `${spf.slice(0, 70)}${spf.length > 70 ? '…' : ''} (${all}all)`)
  }

  if (lookups > 10) {
    fail('SPF DNS 조회 초과', `${lookups}회 (상한 10회)`, '초과하면 permerror 로 SPF 전체가 무효입니다. include 를 정리하세요.')
  } else if (lookups > 7) {
    warn('SPF DNS 조회 여유 부족', `${lookups}/10회`, '발송 서비스를 추가하면 곧 상한을 넘깁니다.')
  }
}

// ── DKIM ──────────────────────────────────────────────────────────────
// 셀렉터는 발송 서비스마다 다릅니다. 지정하지 않으면 흔한 것들을 훑습니다.
const COMMON_SELECTORS = [
  'default', 's1', 's2', 'k1', 'k2', 'mail', 'google', 'selector1', 'selector2',
  'resend', 'sendgrid', 'pm', 'mandrill', 'zoho', 'dkim', 'smtp',
]
const selectors = arg('selector') ? [arg('selector')] : COMMON_SELECTORS
const found = []
let dkimLookupFailed = false
for (const sel of selectors) {
  const recs = await txt(`${sel}._domainkey.${domain}`)
  if (recs === null) { dkimLookupFailed = true; continue }
  const dkim = recs.find((r) => r.includes('v=DKIM1') || r.includes('p='))
  if (dkim) found.push({ sel, dkim })
}

if (!found.length && dkimLookupFailed) {
  warn('DKIM 판정 불가', 'DNS 조회에 실패했습니다.', '--selector 로 셀렉터를 직접 지정하면 조회 횟수가 줄어 안정적입니다.')
} else if (!found.length) {
  const how = arg('selector')
    ? `셀렉터 "${arg('selector')}" 로 찾지 못했습니다.`
    : `흔한 셀렉터 ${selectors.length}개를 확인했지만 없습니다.`
  fail('DKIM 없음', how, '발송 서비스가 발급한 셀렉터와 공개키를 <셀렉터>._domainkey 에 TXT 로 추가하세요. --selector 로 직접 지정할 수도 있습니다.')
} else {
  for (const { sel, dkim } of found) {
    if (/(^|;)\s*p=\s*(;|$)/.test(dkim)) {
      fail(`DKIM ${sel} 공개키 비어 있음`, 'p= 값이 없습니다.', '해당 셀렉터는 폐기된 키입니다. 레코드를 갱신하거나 삭제하세요.')
    } else {
      ok(`DKIM ${sel}`, `${dkim.slice(0, 50)}…`)
    }
  }
}

// ── DMARC ─────────────────────────────────────────────────────────────
const dmarcLookup = await txt(`_dmarc.${domain}`)
const dmarcRecords = dmarcLookup?.filter((r) => r.toLowerCase().startsWith('v=dmarc1'))
if (!dmarcLookup) {
  warn('DMARC 판정 불가', 'DNS 조회에 실패했습니다.', '다시 실행해 보세요.')
} else if (!dmarcRecords.length) {
  fail(
    'DMARC 없음',
    `_dmarc.${domain} 에 레코드가 없습니다.`,
    'Gmail·Outlook 은 대량 발신자에게 DMARC 를 요구합니다. p=none 으로 시작해 리포트를 보며 조이세요.',
  )
} else {
  const dmarc = dmarcRecords[0]
  const policy = dmarc.match(/\bp=(\w+)/)?.[1]
  const rua = /\brua=/.test(dmarc)

  if (policy === 'none') {
    warn('DMARC 정책이 p=none', dmarc, '모니터링 단계입니다. 리포트를 확인한 뒤 quarantine → reject 로 올리세요.')
  } else if (policy === 'quarantine' || policy === 'reject') {
    ok(`DMARC p=${policy}`, dmarc.slice(0, 70))
  } else {
    fail('DMARC 정책 없음', dmarc, 'p= 를 none/quarantine/reject 중 하나로 지정하세요.')
  }

  if (!rua) warn('DMARC 리포트 주소 없음', '', 'rua=mailto:... 를 넣어야 정렬 실패를 확인할 수 있습니다.')
}

// ── MX (수신) ─────────────────────────────────────────────────────────
try {
  const mx = await resolveMx(domain)
  if (mx.length) ok('MX', mx.map((m) => `${m.exchange}(${m.priority})`).join(', ').slice(0, 70))
  else warn('MX 없음', '', '발송만 한다면 필수는 아니지만, 반송(bounce)과 문의 수신이 불가능합니다.')
} catch {
  warn('MX 없음', '', '발송만 한다면 필수는 아니지만, 반송(bounce)과 문의 수신이 불가능합니다.')
}

// ── SMTP 연결 및 실제 발송 ────────────────────────────────────────────
const smtpUrl = process.env.SMTP_URL || ''
if (!smtpUrl) {
  fail('SMTP_URL 미설정', '', '설정 전에는 인증 메일이 발송되지 않고 콘솔에만 출력됩니다.')
} else {
  const nodemailer = (await import('nodemailer')).default
  const transport = nodemailer.createTransport(smtpUrl)
  try {
    await transport.verify()
    ok('SMTP 연결', smtpUrl.replace(/\/\/[^@]+@/, '//***@'))
  } catch (err) {
    fail('SMTP 연결 실패', err.message, '호스트·포트·인증 정보를 확인하세요.')
  }

  const to = arg('send')
  if (to) {
    try {
      const info = await transport.sendMail({
        from: mailFrom || `RoomCraft <no-reply@${domain}>`,
        to,
        subject: '[RoomCraft] 메일 설정 점검',
        text: '이 메일이 받은편지함에 도착했다면 발송 설정이 정상입니다.\n스팸함에 있었다면 SPF·DKIM·DMARC 정렬을 다시 확인하세요.',
      })
      ok('테스트 발송', `${to} · ${info.messageId}`)
      console.log('\n  → 받은편지함과 스팸함을 모두 확인하세요.')
      console.log('  → 메일 원문의 Authentication-Results 에서 spf=pass, dkim=pass, dmarc=pass 를 확인하세요.')
    } catch (err) {
      fail('테스트 발송 실패', err.message)
    }
  }
}

// ── 결과 ──────────────────────────────────────────────────────────────
const icon = { ok: '✓', warn: '△', fail: '✗' }
console.log('')
for (const r of results) {
  console.log(`${icon[r.level]} ${r.label}${r.detail ? `\n    ${r.detail}` : ''}`)
  if (r.fix) console.log(`    → ${r.fix}`)
}

const fails = results.filter((r) => r.level === 'fail').length
const warns = results.filter((r) => r.level === 'warn').length
console.log(`\n${'─'.repeat(50)}`)
if (unresolved.length) {
  console.log(`DNS 조회 실패 ${unresolved.length}건: ${unresolved.slice(0, 3).join(', ')}`)
  console.log('  → 판정하지 못한 항목이 있습니다. 네트워크가 안정된 곳에서 다시 실행하세요.')
}
console.log(`통과 ${results.length - fails - warns} · 경고 ${warns} · 실패 ${fails}`)
if (!arg('send') && smtpUrl) console.log('\n실제 도달 여부는 --send you@example.com 으로 확인하세요.')
process.exit(fails ? 1 : 0)
