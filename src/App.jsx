import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import useAuthStore from './store/useAuthStore'
import usePremiumStore from './store/usePremiumStore'
import useEnergyStore from './store/useEnergyStore'
import { initAdMob } from './services/adService'
import ProtectedRoute from './components/layout/ProtectedRoute'
import Login from './pages/Login'
import SpotifyCallback from './pages/SpotifyCallback'
import Dashboard from './pages/Dashboard'
import Room from './pages/Room'
import JoinRoom from './pages/JoinRoom'

// Listens for spotifyguess://spotify-callback?code=...&state=... deep links
// and runs the OAuth callback flow directly inside the app.
function DeepLinkHandler() {
  const navigate               = useNavigate()
  const handleSpotifyCallback  = useAuthStore(s => s.handleSpotifyCallback)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listener = CapApp.addListener('appUrlOpen', async ({ url }) => {
      // spotifyguess://join/ABC123 or https://...web.app/join/ABC123
      const joinMatch = url.match(/\/join\/([A-Z0-9]+)/i)
      if (joinMatch) {
        navigate(`/join/${joinMatch[1].toUpperCase()}`)
        return
      }

      // spotifyguess://spotify-callback?code=ABC&state=XYZ
      let parsed
      try { parsed = new URL(url) } catch { return }
      const code   = parsed.searchParams.get('code')
      const state  = parsed.searchParams.get('state')
      if (code && state) {
        try {
          await handleSpotifyCallback(code, state)
          const target = localStorage.getItem('postLoginRedirect') || '/dashboard'
          localStorage.removeItem('postLoginRedirect')
          navigate(target, { replace: true })
        } catch {
          // Error is set in the store
        } finally {
          Browser.close().catch(() => {})
        }
      }
    })

    return () => { listener.then(l => l.remove()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function App() {
  const initAuthListener = useAuthStore(s => s.initAuthListener)
  const firebaseUser     = useAuthStore(s => s.firebaseUser)
  const initPremium      = usePremiumStore(s => s.init)
  const loadEnergy       = useEnergyStore(s => s.loadEnergy)

  useEffect(() => {
    initAdMob()
    const unsubscribe = initAuthListener()
    return unsubscribe
  }, [initAuthListener])

  // Initialize RevenueCat + load energy once we have a Firebase user
  useEffect(() => {
    if (firebaseUser?.uid) {
      initPremium(firebaseUser.uid)
      loadEnergy(firebaseUser.uid)
    }
    return () => { usePremiumStore.getState().reset() }
  }, [firebaseUser?.uid, initPremium, loadEnergy])

  return (
    <>
      <BrowserRouter>
        <DeepLinkHandler />
        <Routes>
          <Route path="/login"    element={<Login />} />
          <Route path="/spotify-callback" element={<SpotifyCallback />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard"    element={<Dashboard />} />
            <Route path="/room/:roomId" element={<Room />} />
            <Route path="/join/:code"   element={<JoinRoom />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster
        position="top-center"
        containerStyle={{ top: 'env(safe-area-inset-top, 12px)' }}
        toastOptions={{
          duration: 3000,
          style: {
            background:   '#1E1E1E',
            color:        '#fff',
            border:       '1px solid #2A2A2A',
            borderRadius: '12px',
            fontSize:     '13px',
            fontWeight:   '500',
            maxWidth:     '90vw',
            padding:      '10px 14px',
          },
          success: {
            iconTheme: { primary: '#1DB954', secondary: '#000' },
          },
          error: {
            iconTheme: { primary: '#f87171', secondary: '#000' },
          },
        }}
      />
    </>
  )
}
