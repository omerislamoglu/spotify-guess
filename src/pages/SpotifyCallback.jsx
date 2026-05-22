import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../store/useAuthStore'

/**
 * Silent handler for the Spotify OAuth callback.
 * Spotify redirects to /spotify-callback?code=...&state=...
 * This page exchanges the code for tokens and sends the user to /dashboard.
 *
 * On failure (state mismatch, network error, etc.) it falls back:
 *  - If already authenticated → /dashboard
 *  - Otherwise → /login
 */
export default function SpotifyCallback() {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const handled        = useRef(false)

  const { handleSpotifyCallback, firebaseUser, error } = useAuthStore()

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const code  = searchParams.get('code')
    const state = searchParams.get('state')
    const err   = searchParams.get('error')

    if (err || !code || !state) {
      navigate('/login', { replace: true })
      return
    }

    const consumeRedirect = () => {
      const target = localStorage.getItem('postLoginRedirect')
      if (target) {
        localStorage.removeItem('postLoginRedirect')
        return target
      }
      return '/dashboard'
    }

    handleSpotifyCallback(code, state)
      .then(() => navigate(consumeRedirect(), { replace: true }))
      .catch(() => {
        const fb = useAuthStore.getState().firebaseUser
        navigate(fb ? consumeRedirect() : '/login', { replace: true })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      {error ? (
        <p className="text-red-400">{error}</p>
      ) : (
        <>
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-brand-green border-t-transparent" />
          <p className="text-muted">Connecting Spotify…</p>
        </>
      )}
    </div>
  )
}
