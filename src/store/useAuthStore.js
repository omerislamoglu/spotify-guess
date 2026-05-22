/**
 * Auth Store — Zustand
 *
 * Single login path: Spotify PKCE OAuth only.
 *
 * Flow:
 *  1. startSpotifyAuth()        → PKCE redirect to Spotify
 *  2. /callback receives code   → handleSpotifyCallback()
 *       a. Exchange code for tokens
 *       b. Fetch Spotify profile (display name, avatar)
 *       c. signInAnonymously()  → gives us a stable Firebase UID
 *       d. setDoc(merge:true)   → upserts /users/{uid} in Firestore
 *       e. Persist spotifyProfile so Dashboard has the display name
 *          (anonymous Firebase Auth users have no displayName on the auth object)
 *
 *  Re-connecting Spotify from Dashboard (tokens expired / manually reconnected):
 *    Same flow — firebaseUser already exists so step (c) is skipped,
 *    but profile + tokens are always refreshed.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  signInAnonymously,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../services/firebase'
import {
  authorize,
  handleCallback,
  refreshAccessToken,
  fetchSpotifyProfile,
} from '../services/spotifyService'
import { logOutPurchases } from '../services/purchaseService'
import usePremiumStore from './usePremiumStore'

const useAuthStore = create(
  persist(
    (set, get) => ({
      // ── State ─────────────────────────────────────────────────────────────
      firebaseUser:   null,
      spotifyToken:   null,    // { accessToken, refreshToken, expiresAt }
      spotifyProfile: null,    // { displayName, photoURL, spotifyId } — persisted
      loading:        false,
      error:          null,

      // ── Spotify Auth ───────────────────────────────────────────────────────

      /** Kick off the PKCE redirect, always forcing the Spotify permission screen. */
      startSpotifyAuth: () => authorize({ showDialog: true }),

      /**
       * Exchange the callback code for tokens, fetch the Spotify profile,
       * sign in anonymously to Firebase, and upsert the Firestore user doc.
       *
       * Safe to call even when firebaseUser already exists (e.g. reconnect from
       * Dashboard) — setDoc with merge:true is idempotent.
       */
      handleSpotifyCallback: async (code, state) => {
        set({ loading: true, error: null })
        try {
          // 1. Exchange code → tokens
          const tokens = await handleCallback(code, state)

          // 1b. Verify the token has the playlist scopes we need.
          const grantedScopes = (tokens.scope ?? '').split(' ')
          const required = ['playlist-read-private', 'playlist-read-collaborative']
          const missing  = required.filter(s => !grantedScopes.includes(s))
          if (missing.length > 0) {
            throw new Error(
              `Spotify did not grant required scopes: ${missing.join(', ')}. ` +
              'Go to spotify.com/account → Apps → remove this app, then sign in again.'
            )
          }

          // 2. Firebase Anonymous Auth (skip if already signed in)
          let uid    = get().firebaseUser?.uid
          let fbUser = get().firebaseUser
          if (!uid) {
            const { user } = await Promise.race([
              signInAnonymously(auth),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Firebase signInAnonymously timed out after 10s')), 10000)
              ),
            ])
            uid    = user.uid
            fbUser = user
          }
          // 3. Unblock navigation immediately — set firebaseUser + tokens so
          //    ProtectedRoute lets through before the profile fetch completes.
          set({ firebaseUser: fbUser, spotifyToken: tokens, loading: false })

          // 4. Fetch Spotify profile + upsert Firestore in the background
          fetchSpotifyProfile(tokens.accessToken)
            .then(async profile => {
              const spotifyProfile = {
                displayName: profile.display_name ?? profile.id,
                photoURL:    profile.images?.[0]?.url ?? null,
                spotifyId:   profile.id,
              }
              set({ spotifyProfile })
              await setDoc(
                doc(db, 'users', uid),
                {
                  uid,
                  displayName:  spotifyProfile.displayName,
                  photoURL:     spotifyProfile.photoURL,
                  spotifyId:    spotifyProfile.spotifyId,
                  authProvider: 'spotify',
                  lastSeen:     serverTimestamp(),
                },
                { merge: true }
              )
            })
            .catch(err => console.warn('[auth] profile fetch failed (non-fatal):', err.message))

        } catch (err) {
          set({ error: err.message, loading: false })
        }
      },

      // ── Token management ───────────────────────────────────────────────────

      ensureFreshToken: async () => {
        const { spotifyToken } = get()
        if (!spotifyToken) return null

        const needsRefresh = Date.now() >= spotifyToken.expiresAt - 60_000
        if (!needsRefresh) return spotifyToken.accessToken

        try {
          const refreshed = await refreshAccessToken(spotifyToken.refreshToken)
          set({ spotifyToken: refreshed })
          return refreshed.accessToken
        } catch {
          set({ spotifyToken: null })
          return null
        }
      },

      // ── Session ────────────────────────────────────────────────────────────

      signOut: async () => {
        await logOutPurchases()
        usePremiumStore.getState().reset()
        await firebaseSignOut(auth)
        localStorage.clear()
        sessionStorage.clear()
        set({ firebaseUser: null, spotifyToken: null, spotifyProfile: null })
      },

      /** Call once at app startup. Returns an unsubscribe function. */
      initAuthListener: () => {
        // Fallback: if onAuthStateChanged hasn't fired within 3s (e.g. slow
        // native WebView init), unlock the UI anyway so the button is usable.
        const fallback = setTimeout(() => set({ loading: false }), 3000)
        const unsubscribe = onAuthStateChanged(auth, user => {
          clearTimeout(fallback)
          set({ firebaseUser: user, loading: false })
        })
        return unsubscribe
      },

      isSpotifyConnected: () => Boolean(get().spotifyToken?.accessToken),
    }),
    {
      name: 'spotify-guess-auth',
      // Persist tokens + profile; firebaseUser is restored by onAuthStateChanged.
      partialize: state => ({
        spotifyToken:   state.spotifyToken,
        spotifyProfile: state.spotifyProfile,
      }),
    }
  )
)

export default useAuthStore
