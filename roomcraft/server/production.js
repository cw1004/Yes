/**
 * 프로덕션 설정 점검 및 정적 파일 서빙.
 *
 * 배포에서 가장 흔한 사고는 코드 버그가 아니라 설정 누락입니다.
 * 잘못된 설정으로 조용히 뜨는 대신, 뜨기 전에 크게 실패하거나 경고합니다.
 */
import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const IS_PRODUCTION = process.env.NODE_ENV === 'production'

/**
 * 설정 점검.
 *
 * fatal  — 이 상태로 뜨면 사용자 피해가 발생합니다. 기동을 중단합니다.
 * warn   — 동작은 하지만 기능이 빠집니다.
 */
export function preflight({ paymentProvider, mailerReady, aiReady, trustProxyHops }) {
  const fatal = []
  const warn = []

  const appUrl = process.env.APP_URL || ''
  if (!appUrl) {
    fatal.push('APP_URL 이 없습니다. CORS·결제 리디렉트·제휴 추적 링크가 모두 잘못된 주소를 가리킵니다.')
  } else if (IS_PRODUCTION && !appUrl.startsWith('https://')) {
    fatal.push(`APP_URL 이 https 가 아닙니다 (${appUrl}). 세션 쿠키가 secure 로 발급되어 http 에서는 전달되지 않습니다.`)
  }

  if (IS_PRODUCTION) {
    if (paymentProvider === 'dev') {
      fatal.push('STRIPE_SECRET_KEY 가 없어 dev 결제 시뮬레이터가 켜집니다. 운영에서 무료 지급 경로가 열립니다.')
    } else if (!process.env.STRIPE_WEBHOOK_SECRET) {
      fatal.push('STRIPE_WEBHOOK_SECRET 이 없습니다. 웹훅을 검증할 수 없어 결제 지급이 이뤄지지 않습니다.')
    }

    if (!mailerReady) {
      fatal.push('SMTP_URL 이 없습니다. 인증 메일을 보낼 수 없어 신규 가입자가 크레딧을 받지 못합니다.')
    }

    if (!process.env.CLICK_SALT) {
      warn.push('CLICK_SALT 가 없습니다. 재시작할 때마다 방문자 중복 판정이 끊어집니다.')
    }

    if (!trustProxyHops) {
      warn.push(
        'TRUST_PROXY 가 0 입니다. 로드밸런서 뒤라면 모든 사용자가 한 IP 로 묶여 레이트 리밋이 서로를 차단합니다.',
      )
    }

    if (!aiReady.render) warn.push('GEMINI_API_KEY 가 없습니다. 렌더는 목 프리뷰로만 동작합니다.')
    if (!aiReady.chat) warn.push('ANTHROPIC_API_KEY 가 없습니다. 디자이너 챗은 목 응답으로만 동작합니다.')

    const dbPath = process.env.DATABASE_PATH || ''
    if (!dbPath) {
      warn.push('DATABASE_PATH 가 없습니다. 컨테이너 기본 경로에 저장되면 재배포 시 데이터가 사라집니다.')
    }
  }

  return { fatal, warn }
}

/**
 * 보안 헤더.
 *
 * 이 앱은 외부 스크립트·스타일을 쓰지 않으므로 CSP 를 좁게 잡을 수 있습니다.
 * 렌더 결과가 data URL 이라 img-src 에 data: 를 허용합니다.
 */
export function securityHeaders(_req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // 인라인 style 속성을 광범위하게 사용합니다(태그 위치·팔레트 등).
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  )
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
}

/**
 * 빌드된 SPA 서빙.
 *
 * 웹과 API 를 같은 오리진에서 서비스하면 CORS 가 사라지고, 쿠키가 단순해지고,
 * 제휴 추적 링크(/r/:id)가 웹 도메인에서 그대로 동작합니다.
 * 배포 단위도 하나로 줄어듭니다.
 */
export function mountStatic(app) {
  const dist = resolve(process.cwd(), 'dist')
  if (!existsSync(dist)) return { mounted: false, dist }

  // 해시가 붙은 애셋은 오래 캐시하고, index.html 은 캐시하지 않습니다.
  app.use(
    express.static(dist, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite 는 /assets 아래 파일명에 콘텐츠 해시를 넣습니다(index-DczNraid.js).
        // 내용이 바뀌면 파일명이 바뀌므로 영구 캐시해도 안전합니다.
        // 반대로 index.html 은 항상 최신이어야 합니다.
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )

  // SPA 폴백. /api 와 /r 은 위에서 이미 처리되므로 여기 도달하지 않습니다.
  app.get(/^\/(?!api\/|r\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(resolve(dist, 'index.html'))
  })

  return { mounted: true, dist }
}
