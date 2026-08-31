import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { Modal } from './ui/Modal'
import { Button, Field, inputClass } from './ui/primitives'

type Mode = 'login' | 'signup' | 'forgot' | 'reset'

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    login,
    signup,
    requestPasswordReset,
    resetPassword,
    resetToken,
    devResetUrl,
    notice,
    loading,
    error,
    clearError,
  } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // 메일의 재설정 링크로 들어오면 곧바로 새 비밀번호 입력 화면을 띄웁니다.
  useEffect(() => {
    if (resetToken) setMode('reset')
  }, [resetToken])

  /*
   * 모달을 열 때마다 로그인 화면으로 되돌립니다.
   * 컴포넌트가 언마운트되지 않아 mode 가 남아 있으면, 회원가입 탭을 봤던 사용자가
   * 다시 열었을 때 엉뚱하게 가입 화면을 마주합니다.
   */
  useEffect(() => {
    if (!open) return
    // 재설정 토큰이 살아 있을 때만 reset 화면을 유지합니다.
    // 토큰 없이 reset 모드에 머물면 이메일 입력란이 없어 로그인 자체가 불가능해집니다.
    setMode(resetToken ? 'reset' : 'login')
    setPassword('')
    clearError()
  }, [open, resetToken, clearError])

  useEffect(() => {
    clearError()
  }, [mode, clearError])

  const submit = async () => {
    if (mode === 'forgot') {
      await requestPasswordReset(email)
      return
    }
    if (mode === 'reset') {
      const ok = resetToken ? await resetPassword(resetToken, password) : false
      if (ok) {
        setPassword('')
        onClose()
      }
      return
    }
    const ok = mode === 'login' ? await login(email, password) : await signup(email, password)
    if (ok) {
      setPassword('')
      onClose()
    }
  }

  const title = {
    login: '로그인',
    signup: '회원가입',
    forgot: '비밀번호 찾기',
    reset: '새 비밀번호 설정',
  }[mode]

  const subtitle = {
    login: '로그인하면 크레딧과 무드보드가 서버에 저장되고, 기기가 바뀌어도 이어집니다.',
    signup: '로그인하면 크레딧과 무드보드가 서버에 저장되고, 기기가 바뀌어도 이어집니다.',
    forgot: '가입한 이메일을 입력하면 재설정 링크를 보내드립니다.',
    reset: '새 비밀번호를 입력하세요. 변경하면 다른 기기의 로그인이 모두 해제됩니다.',
  }[mode]

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="🔐"
      title={title}
      subtitle={subtitle}
      width="max-w-md"
    >
      <div className="space-y-4 bg-ink-900 p-5">
        {mode === 'login' || mode === 'signup' ? (
          <div className="flex rounded-lg border border-line-soft p-1">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md py-2.5 text-sm font-semibold transition ${
                  mode === m ? 'bg-ink-700 text-mist-200' : 'text-mist-300 hover:text-mist-200'
                }`}
              >
                {m === 'login' ? '로그인' : '회원가입'}
              </button>
            ))}
          </div>
        ) : null}

        {mode !== 'reset' ? (
          <Field label="이메일">
            <input
              className={inputClass}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="you@example.com"
            />
          </Field>
        ) : null}

        {mode !== 'forgot' ? (
          <Field label={mode === 'reset' ? '새 비밀번호' : '비밀번호'} hint={mode === 'login' ? undefined : '8자 이상'}>
            <input
              className={inputClass}
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="••••••••"
            />
          </Field>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        ) : null}

        {notice && (mode === 'forgot' || mode === 'reset') ? (
          <p className="rounded-lg border border-emerald-brand/40 bg-emerald-brand/10 px-3 py-2 text-sm text-emerald-brand">
            {notice}
          </p>
        ) : null}

        {devResetUrl && mode === 'forgot' ? (
          // 메일 서버가 없는 개발 환경에서만 노출됩니다.
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              const token = new URL(devResetUrl).searchParams.get('reset')
              if (token) {
                useAuth.getState().setResetToken(token)
                setMode('reset')
              }
            }}
          >
            🧪 개발용 재설정 링크 열기
          </Button>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={
            loading ||
            (mode === 'reset' ? !password : mode === 'forgot' ? !email.trim() : !email.trim() || !password)
          }
          onClick={() => void submit()}
        >
          {loading
            ? '처리 중…'
            : { login: '로그인', signup: '가입하고 시작하기', forgot: '재설정 링크 받기', reset: '비밀번호 변경' }[mode]}
        </Button>

        {mode === 'login' ? (
          <button
            onClick={() => setMode('forgot')}
            className="w-full rounded-lg py-2 text-sm text-mist-300 underline decoration-ink-600 underline-offset-4 transition hover:text-amber-brand"
          >
            비밀번호를 잊으셨나요?
          </button>
        ) : null}

        {mode === 'forgot' || mode === 'reset' ? (
          <button
            onClick={() => setMode('login')}
            className="w-full rounded-lg py-2 text-sm text-mist-300 transition hover:text-amber-brand"
          >
            ← 로그인으로 돌아가기
          </button>
        ) : null}

        <p className="text-center text-xs leading-relaxed text-mist-400">
          {mode === 'signup'
            ? '가입 후 이메일 인증을 마치면 Free 플랜 크레딧 20개가 지급됩니다.'
            : '비밀번호는 scrypt 로 해시되어 저장되며, 세션은 httpOnly 쿠키로 관리됩니다.'}
        </p>
      </div>
    </Modal>
  )
}

/** dev 결제 프로바이더용 확인 모달 (Stripe 미설정 환경) */
export function DevPaymentModal() {
  const { pendingPayment, confirmDevPayment, cancelDevPayment, loading } = useAuth()

  return (
    <Modal
      open={Boolean(pendingPayment)}
      onClose={cancelDevPayment}
      icon="🧪"
      title="결제 시뮬레이션"
      subtitle="Stripe 키가 설정되지 않아 로컬 시뮬레이터로 결제를 처리합니다."
      width="max-w-sm"
    >
      <div className="space-y-4 bg-ink-900 p-5">
        <div className="rounded-xl border border-line-soft bg-ink-850 p-4 text-center">
          <p className="text-sm font-semibold text-mist-200">{pendingPayment?.name}</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-brand">
            ${((pendingPayment?.amountCents ?? 0) / 100).toFixed(2)}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-mist-500">
          실제 카드 결제는 일어나지 않습니다. 확인을 누르면 Stripe 웹훅이 호출됐을 때와 동일한 지급 경로를 타며,
          같은 결제를 두 번 처리해도 크레딧은 한 번만 지급됩니다.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={cancelDevPayment}>
            취소
          </Button>
          <Button variant="success" className="flex-1" disabled={loading} onClick={() => void confirmDevPayment()}>
            {loading ? '처리 중…' : '결제 확인'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
