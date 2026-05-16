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
import { fetchPlaylistTracks, fetchRecentlyPlayedTracks, fetchLikedTracks } from '../services/spotifyService'
import useAuthStore from './useAuthStore'

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
 * Fairness guarantee:
 *  Each player gets an equal number of round slots (ROUND_COUNT / numPlayers).
 *  Remainder slots are randomly assigned. Tracks within each player's pool are
 *  shuffled independently so no playlist-order bias creeps in.
 */
function buildRounds(playerPlaylists, roundCount = ROUND_COUNT) {
  const players = Object.entries(playerPlaylists).map(([uid, { tracks }]) => ({
    uid,
    tracks: shuffle([...tracks]),
  }))

  if (players.length === 0) return []

  // Track shared ownership: trackId → Set<uid>
  const ownershipMap = new Map()
  for (const p of players) {
    for (const track of p.tracks) {
      if (!ownershipMap.has(track.id)) ownershipMap.set(track.id, new Set())
      ownershipMap.get(track.id).add(p.uid)
    }
  }

  // Randomise who gets the extra slot(s) when roundCount isn't evenly divisible
  shuffle(players)

  const baseCount = Math.floor(roundCount / players.length)
  let remainder   = roundCount % players.length

  const allocation = new Map()
  for (const p of players) {
    const want = baseCount + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder--
    allocation.set(p.uid, Math.min(want, p.tracks.length))
  }

  let total = [...allocation.values()].reduce((a, b) => a + b, 0)
  if (total < roundCount) {
    for (const p of players) {
      const cur    = allocation.get(p.uid)
      const canAdd = p.tracks.length - cur
      if (canAdd > 0) {
        const add = Math.min(canAdd, roundCount - total)
        allocation.set(p.uid, cur + add)
        total += add
        if (total >= roundCount) break
      }
    }
  }

  const usedTrackIds = new Set()
  const rounds = []
  for (const p of players) {
    const count = allocation.get(p.uid)
    let picked  = 0
    for (const track of p.tracks) {
      if (picked >= count) break
      if (usedTrackIds.has(track.id)) continue
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
      picked++
    }
  }

  shuffle(rounds)
  return rounds
}

// ─── Store ────────────────────────────────────────────────────────────────────

const useGameStore = create((set, get) => ({
  room:         null,
  loading:      false,
  error:        null,
  _unsubscribe: null,

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

    const playerPlaylists = room.playerPlaylists ?? {}
    const connectedCount  = Object.keys(playerPlaylists).length

    if (connectedCount < 2) {
      set({ error: 'At least 2 players must connect a playlist.' })
      return
    }

    const rounds = buildRounds(playerPlaylists, roundCount)
    if (rounds.length < 1) {
      set({ error: 'Not enough tracks to build rounds. Connect playlists with more songs.' })
      return
    }

    set({ loading: true, error: null })
    try {
      await fsStartGame(room.id, rounds)
      set({ loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
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
      if (pts > 0) increments[uid] = pts
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
    const { room, _unsubscribe } = get()
    const { firebaseUser } = useAuthStore.getState()

    // Unsubscribe first so the local listener doesn't react to our own removal
    if (_unsubscribe) _unsubscribe()

    // Remove the player from Firestore so other players see them leave
    if (room?.id && firebaseUser?.uid) {
      await fsLeaveRoom(room.id, firebaseUser.uid).catch(() => {})
    }

    set({ room: null, loading: false, error: null, _unsubscribe: null })
  },

  clearError: () => set({ error: null }),

  // ── Internal ───────────────────────────────────────────────────────────────

  _subscribe: (roomId) => {
    const { _unsubscribe } = get()
    if (_unsubscribe) _unsubscribe()

    const unsub = listenToRoom(roomId, roomData => set({ room: roomData }))
    set({ _unsubscribe: unsub })
  },
}))

export default useGameStore
