/**
 * 레이트 리밋.
 *
 * 막아야 할 것은 두 가지입니다.
 *   1. 자동 가입으로 무료 크레딧을 무한 수급하는 것 (렌더 API 실비가 직접 새는 곳)
 *   2. 로그인 무차별 대입
 *
 * 비용이 드는 엔드포인트(렌더/챗)는 크레딧으로도 막히지만, 크레딧이 있는 계정 하나가
 * 순간적으로 API 를 몰아치는 것까지는 막지 못하므로 사용자 단위 상한을 함께 둡니다.
 */
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * 상한은 환경별로 달라야 합니다 — 사내 데모와 공개 서비스의 적정값이 다르고,
 * 테스트는 창을 소진하지 않도록 넉넉히 잡아야 합니다.
 * 저장소가 메모리라 서버를 재시작하면 카운터도 초기화됩니다.
 */
const envInt = (name, fallback) => {
  const raw = process.env[name]
  const n = Number(raw)
  return raw !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const LIMITS = {
  globalPer15Min: envInt('RATE_LIMIT_GLOBAL_PER_15MIN', 600),
  signupPerHour: envInt('RATE_LIMIT_SIGNUP_PER_HOUR', 5),
  guestPerHour: envInt('RATE_LIMIT_GUEST_PER_HOUR', 8),
  sourcingPerHour: envInt('RATE_LIMIT_SOURCING_PER_HOUR', 20),
  imagePerHour: envInt('RATE_LIMIT_IMAGE_PER_HOUR', 30),
  loginPer15Min: envInt('RATE_LIMIT_LOGIN_PER_15MIN', 10),
  verifyMailPerHour: envInt('RATE_LIMIT_VERIFY_MAIL_PER_HOUR', 3),
  passwordResetPerHour: envInt('RATE_LIMIT_PASSWORD_RESET_PER_HOUR', 5),
  renderPerHour: envInt('RATE_LIMIT_RENDER_PER_HOUR', 40),
  chatPerHour: envInt('RATE_LIMIT_CHAT_PER_HOUR', 120),
  linkPerHour: envInt('RATE_LIMIT_LINK_PER_HOUR', 120),
  checkoutPerHour: envInt('RATE_LIMIT_CHECKOUT_PER_HOUR', 20),
}

/**
 * 프록시 뒤에 있을 때 req.ip 는 프록시 IP 가 됩니다.
 * 그대로 두면 모든 사용자가 한 덩어리로 묶여 서로를 차단하고,
 * 반대로 X-Forwarded-For 를 무조건 신뢰하면 헤더 위조로 리밋을 우회할 수 있습니다.
 * 신뢰할 홉 수를 명시적으로 설정해야 합니다.
 */
export const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY ?? 0)

const message = (text) => ({ error: text, code: 'rate_limited' })

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}

/**
 * IP 키.
 *
 * req.ip 를 그대로 쓰면 IPv6 사용자는 같은 할당 대역 안에서 주소만 바꿔 리밋을 우회합니다
 * (한 가입자에게 /64 가 통째로 배정되므로 사실상 무제한). ipKeyGenerator 가
 * IPv6 를 /56 으로 묶어주므로 반드시 거쳐야 합니다.
 */
const ipKey = (req) => ipKeyGenerator(req.ip ?? 'unknown')

/** 로그인한 사용자는 계정 단위로, 아니면 IP 단위로 셉니다. */
const byUserOrIp = (req) => req.user?.id ?? ipKey(req)

/** 전체 API 공통 상한 — 명백한 폭주만 걸러냅니다. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * MINUTE,
  limit: LIMITS.globalPer15Min,
  message: message('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
})

/** 가입 — 무료 크레딧 남용의 진입점이라 가장 빡빡하게 잡습니다. */
/**
 * 게스트 생성 상한.
 *
 * 가입을 없앤 대신 익명 요청이 그대로 렌더 크레딧을 받습니다. 쿠키를 지우고 다시
 * 요청하면 새 게스트가 생기므로, 그 재발급 자체를 IP 단위로 막지 않으면 한도가
 * 아무 의미가 없어집니다(렌더 API 실비가 직접 새는 지점입니다).
 */
/**
 * 소싱·이미지 생성 상한.
 *
 * 둘 다 크레딧으로도 막히지만, 크레딧이 넉넉한 계정 하나가 웹 검색과 이미지 생성을
 * 몰아치면 외부 API 요금이 그대로 나갑니다. 사용자 단위 상한을 함께 둡니다.
 */
export const sourcingLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.sourcingPerHour,
  keyGenerator: byUserOrIp,
  message: message('제품 소싱 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
})

export const imageLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.imagePerHour,
  keyGenerator: byUserOrIp,
  message: message('이미지 생성 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
})

export const guestLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.guestPerHour,
  keyGenerator: ipKey,
  message: message('무료 사용 한도를 넘었습니다. 계정을 만들면 계속 사용할 수 있습니다.'),
})

export const signupLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.signupPerHour,
  keyGenerator: ipKey,
  message: message('가입 시도가 너무 많습니다. 1시간 후 다시 시도해 주세요.'),
})

/** 로그인 — 무차별 대입 방어. 성공한 요청은 세지 않습니다. */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * MINUTE,
  limit: LIMITS.loginPer15Min,
  keyGenerator: ipKey,
  skipSuccessfulRequests: true,
  message: message('로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.'),
})

/** 인증 메일 재발송 — 메일 폭탄 방지 */
export const verifyMailLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.verifyMailPerHour,
  keyGenerator: byUserOrIp,
  message: message('인증 메일 재발송은 1시간에 3회까지 가능합니다.'),
})

/**
 * 비밀번호 재설정 요청 — 메일 폭탄 및 계정 열거 방지.
 * 존재 여부와 무관하게 같은 응답을 주더라도, 요청 자체를 제한해야 대량 탐색을 막습니다.
 */
export const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.passwordResetPerHour,
  keyGenerator: ipKey,
  message: message('비밀번호 재설정 요청이 너무 많습니다. 1시간 후 다시 시도해 주세요.'),
})

/** 렌더 — 가장 비싼 호출. 크레딧과 별개로 사용자 단위 상한을 둡니다. */
export const renderLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.renderPerHour,
  keyGenerator: byUserOrIp,
  message: message('렌더 요청이 너무 많습니다. 1시간 후 다시 시도해 주세요.'),
})

export const chatLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.chatPerHour,
  keyGenerator: byUserOrIp,
  message: message('대화 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
})

/** 링크 발급 — 내보내기 1회에 수십 건이 묶여 오므로 여유 있게 잡습니다. */
export const linkLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.linkPerHour,
  keyGenerator: byUserOrIp,
  message: message('링크 발급 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
})

/** 결제 세션 생성 — 결제창 스팸 방지 */
export const checkoutLimiter = rateLimit({
  ...base,
  windowMs: HOUR,
  limit: LIMITS.checkoutPerHour,
  keyGenerator: byUserOrIp,
  message: message('결제 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
})
