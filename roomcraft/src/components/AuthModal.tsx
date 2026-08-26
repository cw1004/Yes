import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { Modal } from './ui/Modal'
import { Button, Field, inputClass } from './ui/primitives'

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login, signup, loading, error, clearError } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (open) clearError()
  }, [open, mode, clearError])

  const submit = async () => {
    const ok = mode === 'login' ? await login(email, password) : await signup(email, password)
    if (ok) {
      setPassword('')
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="🔐"
      title={mode === 'login' ? '로그인' : '회원가입'}
      subtitle="로그인하면 크레딧과 무드보드가 서버에 저장되고, 기기가 바뀌어도 이어집니다."
      width="max-w-md"
    >
      <div className="space-y-4 bg-ink-900 p-5">
        <div className="flex rounded-lg border border-ink-700 p-1">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md py-2 text-xs font-semibold transition ${
                mode === m ? 'bg-ink-700 text-mist-200' : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              {m === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

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

        <Field label="비밀번호" hint={mode === 'signup' ? '8자 이상' : undefined}>
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

        {error ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={loading || !email.trim() || !password}
          onClick={() => void submit()}
        >
          {loading ? '처리 중…' : mode === 'login' ? '로그인' : '가입하고 시작하기'}
        </Button>

        <p className="text-center text-[11px] leading-relaxed text-mist-500">
          {mode === 'signup' ? '가입하면 Free 플랜 크레딧 20개가 즉시 지급됩니다.' : '계정이 없으면 회원가입을 선택하세요.'}
          <br />
          비밀번호는 scrypt 로 해시되어 저장되며, 세션은 httpOnly 쿠키로 관리됩니다.
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
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4 text-center">
          <p className="text-sm font-semibold text-mist-200">{pendingPayment?.name}</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-brand">
            ${((pendingPayment?.amountCents ?? 0) / 100).toFixed(2)}
          </p>
        </div>
        <p className="text-[11px] leading-relaxed text-mist-500">
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
