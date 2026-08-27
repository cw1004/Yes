/**
 * 메일 발송.
 *
 * SMTP_URL 이 있으면 실제로 보내고, 없으면 콘솔에 링크를 출력합니다.
 * 개발 환경에서 메일 서버 없이도 인증 흐름 전체를 확인할 수 있어야 하기 때문입니다.
 *
 * 운영에서는 SMTP_URL 을 반드시 설정하세요. 없으면 사용자는 인증 메일을 받지 못하고,
 * 크레딧이 지급되지 않습니다.
 */
import nodemailer from 'nodemailer'

const SMTP_URL = process.env.SMTP_URL || ''
const MAIL_FROM = process.env.MAIL_FROM || 'RoomCraft <no-reply@roomcraft.local>'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null

export const mailerReady = Boolean(transport)

/**
 * 개발 모드에서는 인증 링크를 API 응답에도 실어 보냅니다.
 * 운영에서는 절대 노출하면 안 됩니다 — 이메일 소유를 확인하지 않고 계정을 활성화할 수 있게 됩니다.
 */
export const exposesLinks = !IS_PRODUCTION && !transport

export async function sendMail({ to, subject, html, text }) {
  if (!transport) {
    console.log(`\n[메일 미설정] ${to} 에게 보낼 내용:`)
    console.log(`  제목: ${subject}`)
    console.log(`  ${text}\n`)
    return { delivered: false, reason: 'SMTP_URL 미설정' }
  }

  try {
    await transport.sendMail({ from: MAIL_FROM, to, subject, html, text })
    return { delivered: true }
  } catch (err) {
    // 메일 실패가 가입 자체를 막지는 않습니다. 재발송으로 복구할 수 있어야 합니다.
    console.error('메일 발송 실패:', err.message)
    return { delivered: false, reason: err.message }
  }
}

export function verificationEmail({ displayName, url }) {
  const text = [
    `${displayName}님, RoomCraft 가입을 완료하려면 아래 주소를 열어 이메일을 인증해 주세요.`,
    '',
    url,
    '',
    '인증을 마치면 Free 플랜 크레딧이 지급됩니다. 링크는 24시간 후 만료됩니다.',
    '본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.',
  ].join('\n')

  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;line-height:1.6;">',
    `  <h2 style="margin:0 0 16px;">${escapeHtml(displayName)}님, 이메일을 인증해 주세요</h2>`,
    '  <p style="color:#444;">인증을 마치면 Free 플랜 크레딧이 지급됩니다.</p>',
    `  <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#f0a437;color:#0d0d10;`,
    '     padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">이메일 인증하기</a></p>',
    `  <p style="color:#888;font-size:13px;">버튼이 열리지 않으면 이 주소를 복사해 주세요:<br />${escapeHtml(url)}</p>`,
    '  <p style="color:#888;font-size:13px;">링크는 24시간 후 만료됩니다. 본인이 요청하지 않았다면 무시하셔도 됩니다.</p>',
    '</div>',
  ].join('\n')

  return { subject: '[RoomCraft] 이메일을 인증해 주세요', text, html }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
