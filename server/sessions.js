'use strict';
/**
 * 거래 시간대(골든타임).
 *
 * 단타에서 **언제 하느냐**는 무엇을 사느냐만큼 중요하다.
 * 거래량이 몰리는 시간에는 스프레드가 좁고 체결이 잘 되며 추세가 이어진다.
 * 반대로 점심시간처럼 거래가 마른 구간에서는 같은 전략이 미끄러짐(슬리피지)만 남긴다.
 *
 * ▶ 여기 적힌 구간과 순위는 **일반적으로 알려진 시장 미시구조**를 옮긴 것이다.
 *   "개장 직후와 마감 직전에 거래가 몰리고 점심에 마른다"는 방향은 널리 확인된 사실이지만,
 *   "거래대금의 40%" 같은 구체적 수치는 종목·시기마다 달라 그대로 믿을 값이 아니다.
 *   그래서 이 앱은 이 표를 **가정**으로 쓰고, 실제 수치는 daypart.js 가
 *   사용자의 종목으로 직접 측정해 나란히 보여 준다.
 *
 * 시각은 각 시장의 현지 시간으로 정의하고(미국은 서머타임이 있으므로),
 * 화면에는 한국 시간(KST)으로 환산해 보여 준다.
 */

const KST = 'Asia/Seoul';
const ET = 'America/New_York';

/**
 * quality
 *   golden — 1순위. 여기서만 거래해도 된다
 *   good   — 할 만한 구간
 *   fair   — 나쁘지 않지만 우선순위는 아니다
 *   avoid  — 거래량이 마르는 구간. 피한다
 */
const WINDOWS = {
  KR: [
    {
      key: 'kr-open', rank: 1, quality: 'golden',
      start: '09:00', end: '09:40', tz: KST,
      label: '시초가 폭풍',
      why: '전날 미국장·시간외 뉴스가 한꺼번에 반영되고 호가가 비어 변동성이 가장 큽니다.',
      strategy: '갭상승 2% 이내 + 5분봉 첫 양봉 + 거래량 급증 → 0.5~1% 스캘핑',
    },
    {
      key: 'kr-close', rank: 2, quality: 'good',
      start: '14:20', end: '15:20', tz: KST,
      label: '마감 물량 사냥',
      why: '기관·외국인 마감 물량과 공매도 청산이 겹치고, 14:50부터 단일가로 전환되며 호가가 벌어집니다.',
      strategy: '14:30 눌림목 지지 확인 → 15:10 돌파 시 종가 베팅',
    },
    {
      key: 'kr-inst', rank: 3, quality: 'fair',
      start: '10:00', end: '11:00', tz: KST,
      label: '기관 1차 매매',
      why: '개장 혼란이 정리된 뒤 방향이 확정되는 구간입니다.',
      strategy: '5분봉 20이평 추세 추종',
    },
    {
      key: 'kr-lunch', rank: 99, quality: 'avoid',
      start: '11:30', end: '13:30', tz: KST,
      label: '점심 공백',
      why: '거래량이 크게 줄어 횡보하고, 체결이 밀려 슬리피지가 커집니다.',
      strategy: '쉬는 것이 전략입니다.',
    },
  ],
  US: [
    {
      key: 'us-open', rank: 1, quality: 'golden',
      start: '09:30', end: '10:30', tz: ET,
      label: '오프닝 파워아워',
      why: '갭·뉴스·알고리즘 주문이 겹쳐 하루 중 거래가 가장 몰립니다.',
      strategy: '첫 5분봉(09:30~09:35) 고가/저가 돌파 → 0.3~0.8% 스캘핑',
    },
    {
      key: 'us-close', rank: 2, quality: 'good',
      start: '15:00', end: '16:00', tz: ET,
      label: '클로징 파워아워',
      why: '데이트레이더 청산과 기관 리밸런싱이 겹치고, 마감 직전 MOC(종가) 물량이 쏟아집니다.',
      strategy: '15:00 눌림 확인 후 15:30 추세 추종',
    },
    {
      key: 'us-pre', rank: 3, quality: 'fair',
      start: '08:00', end: '09:30', tz: ET,
      label: '프리마켓',
      why: '변동성은 크지만 거래량이 얇아 스프레드가 넓습니다. 갭이 큰 종목만.',
      strategy: '갭이 아주 큰 종목의 되돌림만. 얇은 호가에 주의',
    },
    {
      key: 'us-lunch', rank: 99, quality: 'avoid',
      start: '12:00', end: '13:30', tz: ET,
      label: '점심 공백',
      why: '거래량이 크게 줄고 방향 없는 횡보가 이어집니다.',
      strategy: '쉬는 것이 전략입니다.',
    },
  ],
};

/* ------------------------------------------------------------- 시간 계산 */

/** 특정 시간대에서의 요일·분(0~1439) */
function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;   // 자정을 24 로 주는 환경 대응
  return {
    weekday: parts.weekday,
    isWeekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
    minutes: hour * 60 + Number(parts.minute),
  };
}

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** hh:mm(현지) → 오늘 그 시각의 KST 표기 */
function toKstLabel(date, tz, hhmm) {
  // 현지 시각과 KST 의 분 단위 차이를 구해 더한다 (서머타임이 자동 반영된다)
  const here = localParts(date, tz).minutes;
  const kst = localParts(date, KST).minutes;
  let diff = kst - here;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  const m = ((toMin(hhmm) + diff) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 구간 하나를 화면용으로 */
function describe(w, date) {
  return {
    key: w.key, rank: w.rank, quality: w.quality, label: w.label,
    why: w.why, strategy: w.strategy,
    local: `${w.start}~${w.end}`,
    kst: `${toKstLabel(date, w.tz, w.start)}~${toKstLabel(date, w.tz, w.end)}`,
  };
}

/**
 * 지금이 어떤 구간인가.
 * @returns {{market:string, inWindow:boolean, window:object|null, weekend:boolean,
 *            minutesLeft:number|null, next:object|null, minutesToNext:number|null}}
 */
function windowNow(market, date = new Date()) {
  const list = WINDOWS[market] || [];
  const base = { market, weekend: false, inWindow: false, window: null, minutesLeft: null, next: null, minutesToNext: null };
  if (!list.length) return base;

  const tz = list[0].tz;
  const { isWeekend, minutes } = localParts(date, tz);
  if (isWeekend) return { ...base, weekend: true };

  // 겹치는 구간이 있으면 순위가 높은(숫자가 작은) 쪽을 쓴다
  const active = list
    .filter((w) => minutes >= toMin(w.start) && minutes < toMin(w.end))
    .sort((a, b) => a.rank - b.rank)[0] || null;

  // 다음에 올 거래 구간 (피해야 할 구간은 제외)
  const upcoming = list
    .filter((w) => w.quality !== 'avoid' && toMin(w.start) > minutes)
    .sort((a, b) => toMin(a.start) - toMin(b.start))[0] || null;

  return {
    market,
    weekend: false,
    inWindow: Boolean(active && active.quality !== 'avoid'),
    window: active ? describe(active, date) : null,
    minutesLeft: active ? toMin(active.end) - minutes : null,
    next: upcoming ? describe(upcoming, date) : null,
    minutesToNext: upcoming ? toMin(upcoming.start) - minutes : null,
  };
}

/** 지금 이 시장에서 신규 진입을 해도 되는가 */
function shouldTrade(market, date = new Date(), mode = 'golden') {
  const now = windowNow(market, date);
  if (mode === 'off') return { ok: true, reason: '시간대 제한 없음' };
  if (now.weekend) return { ok: false, reason: '주말입니다.' };
  if (now.window && now.window.quality === 'avoid') {
    return { ok: false, reason: `${now.window.label} 구간입니다 — ${now.window.why}` };
  }
  if (!now.window) {
    return {
      ok: false,
      reason: now.next
        ? `거래 구간이 아닙니다. 다음은 ${now.next.label} (KST ${now.next.kst}, ${now.minutesToNext}분 뒤).`
        : '오늘 남은 거래 구간이 없습니다.',
    };
  }
  if (mode === 'golden' && now.window.quality !== 'golden') {
    return {
      ok: false,
      reason: `${now.window.label}은 1순위 구간이 아닙니다 (골든타임만 거래 설정).`,
    };
  }
  return { ok: true, reason: `${now.window.label} · ${now.minutesLeft}분 남음` };
}

/** 하루 계획표 — 두 시장을 KST 순서로 늘어놓는다 */
function schedule(date = new Date()) {
  const rows = [];
  for (const market of ['KR', 'US']) {
    for (const w of WINDOWS[market]) {
      rows.push({ market, ...describe(w, date) });
    }
  }
  return rows.sort((a, b) => a.kst.localeCompare(b.kst));
}

/** 두 시장을 합친 현재 상태 */
function status(date = new Date()) {
  const KR = windowNow('KR', date);
  const US = windowNow('US', date);
  const active = [KR, US].filter((s) => s.inWindow).sort((a, b) => a.window.rank - b.window.rank);
  return {
    now: date.getTime(),
    kstTime: new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour12: false, hour: '2-digit', minute: '2-digit' }).format(date),
    KR, US,
    active: active.length ? active[0] : null,
    anyOpen: active.length > 0,
  };
}

module.exports = { WINDOWS, windowNow, shouldTrade, schedule, status, describe, localParts, toKstLabel };
