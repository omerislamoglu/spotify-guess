import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Music, Users, Headphones } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import Button from '../components/ui/Button'
import { t } from '../i18n'

const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL ?? '#'
const TERMS_URL   = import.meta.env.VITE_TERMS_URL   ?? '#'

function SpotifyIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
}

export default function Login() {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()

  const { firebaseUser, loading, error, startSpotifyAuth, handleSpotifyCallback } =
    useAuthStore()

  useEffect(() => {
    const code  = searchParams.get('code')
    const state = searchParams.get('state')
    if (code && state) {
      handleSpotifyCallback(code, state)
        .then(() => navigate('/dashboard', { replace: true }))
        .catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loading && firebaseUser) navigate('/dashboard', { replace: true })
  }, [firebaseUser, loading, navigate])

  const steps = [
    { step: '1', icon: <Music      size={15} className="shrink-0 text-brand-green" />, text: t('login_step1') },
    { step: '2', icon: <Users      size={15} className="shrink-0 text-brand-green" />, text: t('login_step2') },
    { step: '3', icon: <Headphones size={15} className="shrink-0 text-brand-green" />, text: t('login_step3') },
  ]

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 sm:px-5 py-8 sm:py-10">

      <div className="mb-6 sm:mb-8 text-center">
        <div className="mx-auto mb-3 sm:mb-4 flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-green to-emerald-400 shadow-lg shadow-brand-green/25">
          <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" aria-hidden>
            <path d="M10 28c0-7.7 6.3-14 14-14" stroke="#000" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.4"/>
            <path d="M6 30c0-11 8.9-20 20-20" stroke="#000" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.25"/>
            <path d="M14 26c0-4.4 3.6-8 8-8" stroke="#000" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.55"/>
            <circle cx="22" cy="30" r="4" fill="#000"/>
            <rect x="25" y="17" width="2.5" height="13" rx="1.25" fill="#000"/>
            <path d="M25.5 17c3.5 0 7 2 7 5.5" stroke="#000" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
            <text x="35" y="40" fontFamily="system-ui" fontWeight="900" fontSize="16" fill="#000" opacity="0.7">?</text>
          </svg>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('login_title')}</h1>
        <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-muted">
          {t('login_subtitle')}
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 sm:p-6">
        <Button
          variant="primary"
          className="w-full"
          onClick={startSpotifyAuth}
          disabled={loading}
        >
          <SpotifyIcon />
          {loading ? t('login_connecting') : t('login_button')}
        </Button>

        <p className="text-center text-xs text-muted">
          {t('login_auto_account')}
        </p>

        {error && (
          <p className="rounded-lg bg-red-900/30 px-4 py-2 text-center text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="mt-8 w-full max-w-sm">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted">
          {t('login_how_to_play')}
        </p>
        <div className="space-y-2">
          {steps.map(({ step, icon, text }) => (
            <div key={step} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-green text-xs font-bold text-black">
                {step}
              </span>
              {icon}
              <p className="text-sm text-muted">{text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
           className="text-[11px] text-muted underline-offset-2 hover:text-white hover:underline">
          {t('privacy_policy')}
        </a>
        <span className="text-muted/40">·</span>
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer"
           className="text-[11px] text-muted underline-offset-2 hover:text-white hover:underline">
          {t('terms_of_service')}
        </a>
      </div>

    </div>
  )
}
