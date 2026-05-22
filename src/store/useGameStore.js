/**
 * Game Store — Zustand
 *
 * Owns all active-game state and orchestrates the game loop:
 *   lobby → playing → finished
 *
 * Cross-store access: reads useAuthStore.getState() for the current Firebase
 * user UID without creating a circular import.
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import { t } from '../i18n'
import {
  createRoom,
  joinRoom,
  listenToRoom,
  leaveRoom        as fsLeaveRoom,
  connectPlaylist  as fsConnectPlaylist,
  startGame        as fsStartGame,
  submitGuess      as fsSubmitGuess,
  revealRound      as fsRevealRound,
  advanceRound     as fsAdvanceRound,
  MAX_TRACKS_PER_PLAYER,
  ROUND_COUNT,
  POINTS_CORRECT_GUESS,
  POINTS_WRONG_GUESS,
} from '../services/gameService'
import { fetchPlaylistTracks, fetchRecentlyPlayedTracks, fetchLikedTracks, fetchDeezerPreview, fetchItunesPreview } from '../services/spotifyService'
import useAuthStore from './useAuthStore'
import useEnergyStore from './useEnergyStore'
import { ENERGY_PER_GAME } from '../services/energyService'

const AUTO_REVEAL_DELAY_MS = 800
const AUTO_ADVANCE_DELAY_MS = 4000
const PREVIEW_BATCH_SIZE = 10
const MIN_PLAYABLE_TRACKS = 3

async function resolveTrackPreview(track) {
  if (track.previewUrl) return track.previewUrl
  try {
    const deezer = await fetchDeezerPreview(track.artists, track.name)
    if (deezer) return deezer
  } catch {}
  try {
    const itunes = await fetchItunesPreview(track.artists, track.name)
    if (itunes) return itunes
  } catch {}
  return null
}

async function resolvePlaylistPreviews(tracks) {
  const result = []
  for (let i = 0; i < tracks.length; i += PREVIEW_BATCH_SIZE) {
    const batch = tracks.slice(i, i + PREVIEW_BATCH_SIZE)
    const checked = await Promise.all(batch.map(async (track) => {
      const url = await resolveTrackPreview(track)
      return url ? { ...track, previewUrl: url } : null
    }))
    result.push(...checked.filter(Boolean))
  }
  return result
}

function getOwnerIds(round) {
  return round?.ownerIds ?? (round?.ownerId ? [round.ownerId] : [])
}

function hasEveryVoterGuessed(room, round) {
  const ownerSet = new Set(getOwnerIds(round))
  const voters = (room.players ?? []).filter(p => !ownerSet.has(p.uid))
  return voters.length > 0 && voters.every(p => round.guesses?.[p.uid] != null)
}

// ─── Fisher-Yates shuffle (in-place) ─────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Build the rounds array from the playerPlaylists map stored in Firestore.
 *
 * Guarantees:
 *  - Result length = min(roundCount, totalUniqueTracks).
 *  - Round-robin quota across players: each player contributes roughly the
 *    same number of tracks. When a player runs out, the slot passes to the
 *    next player who still has tracks.
 *  - Post-shuffle de-dup: consecutive rounds with the same ownerSet are
 *    swapped with the next differing round when possible.
 */
function buildRounds(playerPlaylists, roundCount = ROUND_COUNT) {
  // (a) Build per-player shuffled track pools & global ownershipMap
  const players = Object.entries(playerPlaylists).map(([uid, { tracks }]) => ({
    uid,
    tracks: shuffle([...tracks]),
    cursor: 0,                       // index of next unused track
  }))

  if (players.length === 0) return []

  // trackId → Set<uid>  (shared ownership across playlists)
  const ownershipMap = new Map()
  for (const p of players) {
    for (const track of p.tracks) {
      if (!ownershipMap.has(track.id)) ownershipMap.set(track.id, new Set())
      ownershipMap.get(track.id).add(p.uid)
    }
  }

  // Randomise starting order so the "first" player isn't deterministic
  shuffle(players)

  // (b) Round-robin selection
  const usedTrackIds = new Set()
  const rounds       = []
  let playerIdx      = 0
  let emptyStreak    = 0         // consecutive players with no remaining tracks

  while (rounds.length < roundCount && emptyStreak < players.length) {
    const p = players[playerIdx % players.length]

    // Find the next unused track for this player
    let picked = false
    while (p.cursor < p.tracks.length) {
      const track = p.tracks[p.cursor]
      p.cursor++
      if (usedTrackIds.has(track.id)) continue   // duplicate across playlists

      usedTrackIds.add(track.id)
      rounds.push({
        track: {
          id:         track.id,
          name:       track.name,
          artists:    track.artists,
          albumArt:   track.albumArt,
          previewUrl: track.previewUrl,
        },
        ownerIds: [...ownershipMap.get(track.id)],
        guesses:  {},
        revealed: false,
      })
      picked = true
      break
    }

    if (picked) {
      emptyStreak = 0
    } else {
      emptyStreak++              // this player is exhausted — skip
    }

    playerIdx++
  }

  // (d) Shuffle the final list
  shuffle(rounds)

  // (3) Sliding-window de-dup: avoid consecutive identical ownerSets
  for (let i = 1; i < rounds.length; i++) {
    const prevKey = rounds[i - 1].ownerIds.slice().sort().join(',')
    const currKey = rounds[i].ownerIds.slice().sort().join(',')
    if (prevKey === currKey) {
      // Try to swap with the nearest non-matching round ahead
      for (let j = i + 1; j < rounds.length; j++) {
        const candKey = rounds[j].ownerIds.slice().sort().join(',')
        if (candKey !== currKey) {
          ;[rounds[i], rounds[j]] = [rounds[j], rounds[i]]
          break
        }
      }
      // If no swap candidate found, accept the collision silently
    }
  }

  // Debug log for testing
  const perPlayer = {}
  for (const r of rounds) {
    for (const uid of r.ownerIds) {
      perPlayer[uid] = (perPlayer[uid] ?? 0) + 1
    }
  }
  console.debug('[buildRounds]', { requested: roundCount, built: rounds.length, perPlayer })

  return rounds
}

// ─── Store ────────────────────────────────────────────────────────────────────

const useGameStore = create((set, get) => ({
  room:         null,
  loading:      false,
  preparing:    false,
  error:        null,
  _unsubscribe: null,
  _autoRevealRounds: new Set(),
  _autoAdvanceRounds: new Set(),
  _autoTimers: new Map(),

  // ── Lobby ──────────────────────────────────────────────────────────────────

  createRoom: async (host) => {
    set({ loading: true, error: null })
    try {
      const { roomId } = await createRoom(host)
      get()._subscribe(roomId)
      set({ loading: false })
      return roomId
    } catch (err) {
      set({ error: err.message, loading: false })
      return null
    }
  },

  joinRoom: async (code, player) => {
    set({ loading: true, error: null })
    try {
      const roomId = await joinRoom(code, player)
      get()._subscribe(roomId)
      set({ loading: false })
      return roomId
    } catch (err) {
      set({ error: err.message, loading: false })
      return null
    }
  },

  /**
   * Fetch a player's playlist tracks (using their own Spotify token) and sync
   * the result to the Firestore room document.
   *
   * @param {string} accessToken  Fresh Spotify access token (caller must ensure freshness)
   * @param {string} playlistId
   * @param {string} playlistName
   */
  connectPlaylist: async (accessToken, playlistId, playlistName) => {
    const { room } = get()
    const { firebaseUser } = useAuthStore.getState()
    if (!room || !firebaseUser) return

    set({ loading: true, error: null })
    try {
      let allTracks
      try {
        allTracks = await fetchPlaylistTracks(accessToken, playlistId)
      } catch (spotifyErr) {
        if (spotifyErr.message?.startsWith('PERMISSION_ERROR:')) {
          toast.error(
            'Playlist access denied (403). Make it "Public" in Spotify or use "Recently Played".',
            { duration: 8000 }
          )
        }
        throw spotifyErr
      }

      if (allTracks.length === 0) {
        throw new Error('No tracks found in this playlist. Try a different one.')
      }

      // Cap what we save to Firestore to avoid document size issues.
      const tracks = allTracks.slice(0, MAX_TRACKS_PER_PLAYER)

      try {
        await fsConnectPlaylist(room.id, firebaseUser.uid, playlistId, playlistName, tracks)
      } catch (firestoreErr) {
        console.error('[connectPlaylist] Firestore write failed:', firestoreErr)
        if (firestoreErr.code === 'permission-denied') {
          throw new Error(
            'Firestore permission denied. The security rules need to allow authenticated users to write to rooms. ' +
            'Update your rules in the Firebase Console.'
          )
        }
        throw firestoreErr
      }

      set({ loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  /**
   * Use the player's 50 recently played tracks instead of a playlist.
   * Requires only user-read-recently-played — always works.
   */
  connectRecentlyPlayed: async (accessToken) => {
    const { room } = get()
    const { firebaseUser } = useAuthStore.getState()
    if (!room || !firebaseUser) return

    set({ loading: true, error: null })
    try {
      const allTracks = await fetchRecentlyPlayedTracks(accessToken)
      if (allTracks.length === 0) {
        throw new Error('No recently played tracks found. Play some songs on Spotify first.')
      }
      const tracks = allTracks.slice(0, MAX_TRACKS_PER_PLAYER)
      await fsConnectPlaylist(room.id, firebaseUser.uid, 'recently-played', 'Recently Played', tracks)
      set({ loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  /**
   * Use the player's liked (saved) tracks — up to 500 songs, newest first.
   * Requires user-library-read scope.
   */
  connectLikedSongs: async (accessToken) => {
    const { room } = get()
    const { firebaseUser } = useAuthStore.getState()
    if (!room || !firebaseUser) return

    set({ loading: true, error: null })
    try {
      const allTracks = await fetchLikedTracks(accessToken, 500)
      if (allTracks.length === 0) {
        throw new Error('No liked songs found. Like some songs on Spotify first.')
      }
      const tracks = allTracks.slice(0, MAX_TRACKS_PER_PLAYER)
      await fsConnectPlaylist(room.id, firebaseUser.uid, 'liked-songs', 'Liked Songs', tracks)
      set({ loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  // ── Game start (host only) ──────────────────────────────────────────────────

  /**
   * Build the round pool from all connected playlists and write to Firestore.
   * Only the host should call this.
   */
  startGame: async (roundCount) => {
    const { room } = get()
    if (!room) return

    const uid = useAuthStore.getState().firebaseUser?.uid
    const energy = useEnergyStore.getState().energy
    if (energy < ENERGY_PER_GAME) {
      toast.error(t('energy_insufficient_start'))
      return
    }

    const playerPlaylists = room.playerPlaylists ?? {}
    const connectedCount  = Object.keys(playerPlaylists).length

    if (connectedCount < 2) {
      set({ error: 'At least 2 players must connect a playlist.' })
      return
    }

    set({ preparing: true, error: null })
    try {
      const resolvedPlaylists = {}
      for (const [pUid, playlist] of Object.entries(playerPlaylists)) {
        const capped = playlist.tracks.slice(0, MAX_TRACKS_PER_PLAYER)
        const playable = await resolvePlaylistPreviews(capped)
        if (playable.length < MIN_PLAYABLE_TRACKS) {
          const player = room.players.find(p => p.uid === pUid)
          set({ preparing: false, error: t('insufficient_previews', { name: player?.displayName ?? pUid, min: MIN_PLAYABLE_TRACKS }) })
          return
        }
        resolvedPlaylists[pUid] = { ...playlist, tracks: playable }
      }
      set({ preparing: false })

      const rounds = buildRounds(resolvedPlaylists, roundCount)
      if (rounds.length < 1) {
        set({ error: 'Not enough tracks to build rounds. Connect playlists with more songs.' })
        return
      }

      if (rounds.length < roundCount) {
        toast(t('lobby_fewer_rounds', { count: rounds.length }), { duration: 5000 })
      }

      set({ loading: true, error: null })
      if (uid) {
        const allowed = await useEnergyStore.getState().consumeEnergy(uid, ENERGY_PER_GAME)
        if (!allowed) {
          toast.error(t('energy_insufficient_start'))
          set({ loading: false })
          return
        }
      }
      await fsStartGame(room.id, rounds)
      set({ loading: false })
    } catch (err) {
      set({ error: err.message, loading: false, preparing: false })
    }
  },

  // ── Round play ─────────────────────────────────────────────────────────────

  submitGuess: async (guessedUids) => {
    const { room } = get()
    const { firebaseUser } = useAuthStore.getState()
    if (!room || !firebaseUser) return

    try {
      await fsSubmitGuess(room.id, room.currentRound, firebaseUser.uid, guessedUids)
    } catch (err) {
      set({ error: err.message })
    }
  },

  /**
   * Reveal the current round and award points to correct guessers.
   * Only the host should call this.
   */
  revealRound: async () => {
    const { room } = get()
    if (!room) return

    const round  = room.rounds[room.currentRound]
    if (!round || round.revealed) return

    const ownerIds = round.ownerIds ?? (round.ownerId ? [round.ownerId] : [])
    const ownerSet = new Set(ownerIds)

    // Tally correct/wrong guesses → score increments
    const increments = {}
    for (const [uid, guessedUids] of Object.entries(round.guesses ?? {})) {
      if (ownerSet.has(uid)) continue           // owners can't win their own round
      const guesses = Array.isArray(guessedUids) ? guessedUids : [guessedUids]
      let pts = 0
      for (const g of guesses) {
        pts += ownerSet.has(g) ? POINTS_CORRECT_GUESS : POINTS_WRONG_GUESS
      }
      if (pts !== 0) increments[uid] = pts
    }

    set({ loading: true })
    try {
      await fsRevealRound(room.id, room.currentRound, increments)
      set({ loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  /**
   * Move to the next round (or end the game).
   * Only the host should call this.
   */
  advanceRound: async () => {
    const { room } = get()
    if (!room) return

    const nextIndex = (room.currentRound ?? 0) + 1
    try {
      await fsAdvanceRound(room.id, nextIndex, room.rounds.length)
    } catch (err) {
      set({ error: err.message })
    }
  },

  // ── Room lifecycle ─────────────────────────────────────────────────────────

  leaveRoom: async () => {
    const { room, _unsubscribe, _autoTimers } = get()
    const { firebaseUser } = useAuthStore.getState()

    // Unsubscribe first so the local listener doesn't react to our own removal
    if (_unsubscribe) _unsubscribe()
    for (const timer of _autoTimers.values()) clearTimeout(timer)

    // Remove the player from Firestore so other players see them leave
    if (room?.id && firebaseUser?.uid) {
      try {
        const { closed } = await fsLeaveRoom(room.id, firebaseUser.uid)
        // closed === true → room was deleted (last player left); no extra toast needed
        void closed
      } catch {
        // best-effort — player is already navigating away
      }
    }

    set({
      room: null,
      loading: false,
      error: null,
      _unsubscribe: null,
      _autoRevealRounds: new Set(),
      _autoAdvanceRounds: new Set(),
      _autoTimers: new Map(),
    })
  },

  clearError: () => set({ error: null }),

  // ── Internal ───────────────────────────────────────────────────────────────

  _subscribe: (roomId) => {
    const { _unsubscribe } = get()
    if (_unsubscribe) _unsubscribe()

    for (const timer of get()._autoTimers.values()) clearTimeout(timer)

    const autoRevealRounds = new Set()
    const autoAdvanceRounds = new Set()
    const autoTimers = new Map()

    const scheduleTimer = (key, delay, callback) => {
      if (autoTimers.has(key)) return
      const timer = setTimeout(() => {
        autoTimers.delete(key)
        callback()
      }, delay)
      autoTimers.set(key, timer)
    }

    const unsub = listenToRoom(roomId, roomData => {
      set({ room: roomData })

      const { firebaseUser } = useAuthStore.getState()
      const roundIndex = roomData.currentRound ?? 0
      const round = roomData.rounds?.[roundIndex]

      if (
        !firebaseUser ||
        roomData.hostId !== firebaseUser.uid ||
        roomData.phase !== 'playing' ||
        !round
      ) return

      if (!round.revealed && hasEveryVoterGuessed(roomData, round)) {
        if (!autoRevealRounds.has(roundIndex)) {
          autoRevealRounds.add(roundIndex)
          scheduleTimer(`reveal:${roundIndex}`, AUTO_REVEAL_DELAY_MS, () => {
            const { room: latest } = get()
            const { firebaseUser: latestUser } = useAuthStore.getState()
            const latestRound = latest?.rounds?.[roundIndex]
            if (
              latest?.id === roomId &&
              latestUser?.uid === latest.hostId &&
              latest.phase === 'playing' &&
              latest.currentRound === roundIndex &&
              latestRound &&
              !latestRound.revealed &&
              hasEveryVoterGuessed(latest, latestRound)
            ) {
              get().revealRound()
            }
          })
        }
      }

      if (round.revealed) {
        if (!autoAdvanceRounds.has(roundIndex)) {
          autoAdvanceRounds.add(roundIndex)
          scheduleTimer(`advance:${roundIndex}`, AUTO_ADVANCE_DELAY_MS, () => {
            const { room: latest } = get()
            const { firebaseUser: latestUser } = useAuthStore.getState()
            const latestRound = latest?.rounds?.[roundIndex]
            if (
              latest?.id === roomId &&
              latestUser?.uid === latest.hostId &&
              latest.phase === 'playing' &&
              latest.currentRound === roundIndex &&
              latestRound?.revealed
            ) {
              get().advanceRound()
            }
          })
        }
      }
    })
    set({ _unsubscribe: unsub, _autoRevealRounds: autoRevealRounds, _autoAdvanceRounds: autoAdvanceRounds, _autoTimers: autoTimers })
  },
}))

export default useGameStore
