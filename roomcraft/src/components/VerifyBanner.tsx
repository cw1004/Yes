import { useEffect } from 'react'
import { useAuth } from '../store/useAuth'
import { Button } from './ui/primitives'

/**
 * 이메일 인증 안내 배너.
 *
 * 크레딧이 인증 시점에 지급되므로, 인증 전 사용자는 렌더를 할 수 없습니다.
 * 그 이유를 화면에서 바로 알 수 있어야 이탈하지 않습니다.
 */
export function VerifyBanner() {
  const { user, devVerifyUrl, notice, loading, resendVerification, verifyEmail, clearNotice } = useAuth()

  // 메일의 인증 링크로 들어온 경우 (?verify=토큰) 자동으로 처리합니다.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('verify')
    if (!token) return
    void verifyEmail(token).finally(() => {
      window.history.replaceState({}, '', window.location.pathname)
    })
  }, [verifyEmail])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clearNotice, 6000)
    return () => clearTimeout(t)
  }, [notice, clearNotice])

  if (!user || user.emailVerified) return null

  return (
    <div className="border-b border-amber-brand/25 bg-amber-brand/8 px-4 py-2.5">
      <div className="mx-auto flex max-w-[1720px] flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-relaxed text-amber-brand">
          ✉ <strong>{user.email}</strong> 로 보낸 인증 메일을 확인해 주세요. 인증을 마치면 Free 크레딧 20개가
          지급되고 렌더를 시작할 수 있습니다.
        </p>
        <div className="flex items-center gap-2">
          {devVerifyUrl ? (
            // 메일 서버가 없는 개발 환경에서만 노출됩니다.
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const token = new URL(devVerifyUrl).searchParams.get('verify')
                if (token) void verifyEmail(token)
              }}
            >
              🧪 개발용 즉시 인증
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void resendVerification()}>
            인증 메일 재발송
          </Button>
        </div>
      </div>
    </div>
  )
}
