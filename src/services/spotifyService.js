/**
 * Spotify Service — PKCE OAuth flow + data fetching.
 *
 * Flow summary:
 *  1. authorize()           → redirects user to Spotify login (PKCE)
 *  2. handleCallback()      → exchanges code for tokens
 *  3. fetchPlaylists()      → returns user's playlists
 *  4. fetchPlaylistTracks() → returns previewable tracks from a playlist
 *  5. fetchRecentlyPlayed() → returns recently played tracks
 *
 * No client secret is ever used — safe for a public SPA.
 */

import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { generateCodeVerifier, generateCodeChallenge } from '../utils/pkce'

const CLIENT_ID        = import.meta.env.VITE_SPOTIFY_CLIENT_ID
// On native (iOS/Android) use a custom URL scheme so the OS can route the
// OAuth callback back into the app. On web, derive from current origin so
// localhost ↔ 127.0.0.1 mismatches don't break the state/PKCE check.
const REDIRECT_URI     = Capacitor.isNativePlatform()
  ? 'spotifyguess://spotify-callback'
  : `${window.location.origin}/spotify-callback`
const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com'
const SPOTIFY_API      = 'https://api.spotify.com/v1'

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-private',
  'user-read-email',
  'user-read-recently-played',
].join(' ')

// ─── PKCE Auth ───────────────────────────────────────────────────────────────

/**
 * @param {{ showDialog?: boolean }} options
 *   showDialog — pass true to force Spotify's permission approval screen
 *   even when the user is already logged in. Use for scope re-consent.
 */
export async function authorize({ showDialog = false } = {}) {
  const verifier  = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state     = crypto.randomUUID()

  localStorage.setItem('spotify_code_verifier', verifier)
  localStorage.setItem('spotify_auth_state',    state)

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    state,
    scope:                 SCOPES,
  })

  const url = `${SPOTIFY_ACCOUNTS}/authorize?${params}${showDialog ? '&show_dialog=true' : ''}`

  if (Capacitor.isNativePlatform()) {
    // Open in SFSafariViewController — when Spotify redirects to spotifyguess://
    // the in-app browser closes silently and appUrlOpen fires with no dialog.
    await Browser.open({ url, presentationStyle: 'popover' })
  } else {
    window.location.href = url
  }
}

export async function handleCallback(code, returnedState) {
  const storedState = localStorage.getItem('spotify_auth_state')
  const verifier    = localStorage.getItem('spotify_code_verifier')

  if (returnedState !== storedState) {
    throw new Error('Spotify OAuth state mismatch — possible CSRF attack.')
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     CLIENT_ID,
    code_verifier: verifier,
  })

  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error_description ?? 'Failed to exchange Spotify code.')
  }

  const data = await res.json()
  localStorage.removeItem('spotify_code_verifier')
  localStorage.removeItem('spotify_auth_state')

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    scope:        data.scope,
    expiresIn:    data.expires_in,
    expiresAt:    Date.now() + data.expires_in * 1000,
  }
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     CLIENT_ID,
  })

  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) throw new Error('Failed to refresh Spotify token.')

  const data = await res.json()
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn:    data.expires_in,
    expiresAt:    Date.now() + data.expires_in * 1000,
  }
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function spotifyFetch(endpoint, accessToken) {
  const fullUrl = `${SPOTIFY_API}${endpoint}`
  const res = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const message = err?.error?.message ?? `Spotify API error: ${res.status}`
    if (res.status === 403) {
      throw new Error(`PERMISSION_ERROR: ${message}`)
    }
    throw new Error(message)
  }
  return res.json()
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

export function fetchSpotifyProfile(accessToken) {
  return spotifyFetch('/me', accessToken)
}

export async function fetchPlaylists(accessToken) {
  const data = await spotifyFetch('/me/playlists?limit=50', accessToken)
  const rawItems = data.items ?? []

  // Normalise the track count: Spotify returns it under `tracks.total` for most
  // playlists but some responses use `items.total` — handle both shapes so
  // downstream code always gets a numeric `trackCount`.
  const items = rawItems.map(p => ({
    ...p,
    trackCount: p.tracks?.total ?? p.items?.total ?? 0,
  }))
  return { ...data, items }
}

export function fetchRecentlyPlayed(accessToken) {
  return spotifyFetch('/me/player/recently-played?limit=50', accessToken)
}

/**
 * Fetch the user's 50 recently played tracks and return them in the same
 * shape as fetchPlaylistTracks — no playlist-read-private scope required.
 * Only needs user-read-recently-played.
 */
export async function fetchRecentlyPlayedTracks(accessToken) {
  const data = await spotifyFetch('/me/player/recently-played?limit=50', accessToken)
  const seen  = new Set()
  return (data.items ?? [])
    .map(item => item?.track)
    .filter(track => {
      if (!track?.id || seen.has(track.id)) return false
      seen.add(track.id)
      return true
    })
    .map(track => ({
      id:         track.id,
      name:       track.name,
      artists:    track.artists?.map(a => a.name).join(', ') ?? 'Unknown',
      albumArt:   track.album?.images?.[0]?.url ?? null,
      previewUrl: track.preview_url ?? null,
    }))
}

/**
 * Fetch tracks from a playlist, filtered to only those with a 30-second preview URL.
 *
 * Fairness note: callers should cap usage of the returned array at MAX_TRACKS_PER_PLAYER
 * (defined in gameService) so no single large playlist dominates the round pool.
 *
 * @param {string} accessToken
 * @param {string} playlistId
 * @returns {Promise<Track[]>} Track shape: { id, name, artists, albumArt, previewUrl }
 */
export async function fetchPlaylistTracks(accessToken, playlistId) {
  // ── Step 1: Fetch playlist items ───────────────────────────────────────────
  const allItems = []
  let offset = 0
  while (true) {
    const data = await spotifyFetch(
      `/playlists/${playlistId}/items?limit=100&offset=${offset}`, accessToken
    )
    const items = data.items ?? []
    allItems.push(...items)
    if (!data.next || items.length < 100) break
    offset += 100
  }

  // ── Step 2: Extract tracks ──────────────────────────────────────────────
  // /items endpoint returns { item: trackObj } instead of { track: trackObj }
  const toTrack = (entry) => entry?.item ?? entry?.track ?? entry

  let tracks = allItems
    .map(toTrack)
    .filter(track => track?.id && track?.name)
    .map(track => ({
      id:         track.id,
      name:       track.name,
      artists:    track.artists?.map(a => a.name).join(', ') ?? 'Unknown',
      albumArt:   track.album?.images?.[0]?.url ?? null,
      previewUrl: track.preview_url ?? null,
    }))

  // ── Step 3: If items lack full data, extract IDs and batch-fetch ───────────
  if (tracks.length === 0 && allItems.length > 0) {
    const trackIds = allItems
      .map(entry => {
        const t = toTrack(entry)
        return t?.id ?? t?.uri?.split(':').pop()
      })
      .filter(Boolean)

    if (trackIds.length > 0) {
      const batchTracks = []
      for (let i = 0; i < trackIds.length; i += 50) {
        const batch = trackIds.slice(i, i + 50)
        const data = await spotifyFetch(`/tracks?ids=${batch.join(',')}`, accessToken)
        batchTracks.push(...(data.tracks ?? []))
      }
      tracks = batchTracks
        .filter(t => t?.id && t?.name)
        .map(track => ({
          id:         track.id,
          name:       track.name,
          artists:    track.artists?.map(a => a.name).join(', ') ?? 'Unknown',
          albumArt:   track.album?.images?.[0]?.url ?? null,
          previewUrl: track.preview_url ?? null,
        }))
    }
  }

  const withPreview = tracks.filter(t => t.previewUrl).length
  console.debug(
    `[fetchPlaylistTracks] ${allItems.length} items → ${tracks.length} tracks ` +
    `(${withPreview} Spotify preview, ${tracks.length - withPreview} need iTunes fallback)`
  )
  return tracks
}

/**
 * Fetch the user's liked (saved) tracks — up to `limit` songs, newest first.
 * Uses the /me/tracks endpoint which requires the `user-library-read` scope
 * (already included in SCOPES).
 *
 * @param {string} accessToken
 * @param {number} [limit=500] — max tracks to fetch
 * @returns {Promise<Track[]>}
 */
export async function fetchLikedTracks(accessToken, limit = 500) {
  const allItems = []
  let offset = 0

  while (allItems.length < limit) {
    const batchSize = Math.min(50, limit - allItems.length)
    const data = await spotifyFetch(
      `/me/tracks?limit=${batchSize}&offset=${offset}`, accessToken
    )
    const items = data.items ?? []
    allItems.push(...items)
    if (!data.next || items.length < batchSize) break
    offset += batchSize
  }

  const seen = new Set()
  return allItems
    .map(item => item?.track)
    .filter(track => {
      if (!track?.id || seen.has(track.id)) return false
      seen.add(track.id)
      return true
    })
    .map(track => ({
      id:         track.id,
      name:       track.name,
      artists:    track.artists?.map(a => a.name).join(', ') ?? 'Unknown',
      albumArt:   track.album?.images?.[0]?.url ?? null,
      previewUrl: track.preview_url ?? null,
    }))
}

/**
 * Look up a 30-second preview clip from the iTunes Search API.
 * Free, no auth required, CORS-friendly from the browser.
 *
 * @returns {Promise<string|null>} preview URL, or null if nothing found
 */
export async function fetchDeezerPreview(artist, trackName) {
  // Deezer API doesn't support CORS — only works on native (Capacitor)
  if (!Capacitor.isNativePlatform()) return null
  try {
    const q = `track:"${trackName}" artist:"${artist}"`
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json()
    return data?.data?.[0]?.preview || null
  } catch (err) {
    console.warn('[fetchDeezerPreview] failed:', err.message)
    return null
  }
}

export async function fetchItunesPreview(artist, trackName) {
  try {
    const term = encodeURIComponent(`${artist} ${trackName}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=1`,
      { signal: controller.signal }
    )
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json()
    return data.results?.[0]?.previewUrl ?? null
  } catch (err) {
    console.warn('[fetchItunesPreview] failed:', err.message)
    return null
  }
}
