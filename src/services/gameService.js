/**
 * Game Service — Firestore operations for game rooms.
 *
 * Room document shape (Firestore: /rooms/{roomId}):
 * {
 *   hostId:          string
 *   code:            string                    // 6-char join code
 *   players:         PlayerEntry[]             // { uid, displayName, avatarUrl }
 *   phase:           'lobby'|'playing'|'finished'
 *   createdAt:       Timestamp
 *
 *   // Set when players pick playlists in the lobby:
 *   playerPlaylists: {
 *     [uid]: { playlistId, playlistName, tracks: Track[] }
 *   }
 *
 *   // Set when host starts the game:
 *   rounds: [{
 *     track:    { id, name, artists, albumArt, previewUrl }
 *     ownerId:  string          // uid of the player this track belongs to
 *     guesses:  { [uid]: string } // uid → guessedOwnerId
 *     revealed: boolean
 *   }]
 *   currentRound: number
 *   scores:        { [uid]: number }
 * }
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  arrayUnion,
  deleteField,
  serverTimestamp,
  query,
  where,
  getDocs,
  runTransaction,
} from 'firebase/firestore'
import { db } from './firebase'

const ROOMS = 'rooms'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Max tracks taken from each player's playlist when building the round pool.
 * Ensures a 2000-track playlist doesn't crowd out a 30-track one.
 */
export const MAX_TRACKS_PER_PLAYER = 50
export const ROUND_COUNT           = 5
export const POINTS_CORRECT_GUESS  = 100
export const POINTS_WRONG_GUESS   = -50

// ─── Lobby ────────────────────────────────────────────────────────────────────

function generateJoinCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

/**
 * Generate a join code that isn't already used by an active (lobby/playing) room.
 * Retries up to 5 times to avoid collisions.
 */
async function generateUniqueJoinCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode()
    const q    = query(
      collection(db, ROOMS),
      where('code', '==', code),
      where('phase', 'in', ['lobby', 'playing'])
    )
    const snap = await getDocs(q)
    if (snap.empty) return code
  }
  // Extremely unlikely — fall back to a longer code
  return generateJoinCode() + generateJoinCode().slice(0, 2)
}

export async function createRoom(host) {
  const code = await generateUniqueJoinCode()
  const ref  = await addDoc(collection(db, ROOMS), {
    hostId:          host.uid,
    code,
    players:         [buildPlayerEntry(host)],
    phase:           'lobby',
    playerPlaylists: {},
    scores:          {},
    createdAt:       serverTimestamp(),
  })
  return { roomId: ref.id, code }
}

export async function joinRoom(code, player) {
  const q    = query(collection(db, ROOMS), where('code', '==', code.toUpperCase()))
  const snap = await getDocs(q)

  if (snap.empty) throw new Error('No room found with that code.')

  const roomDoc = snap.docs[0]
  const room    = roomDoc.data()

  if (room.phase !== 'lobby') throw new Error('This game has already started.')

  const alreadyIn = room.players.some(p => p.uid === player.uid)
  if (!alreadyIn) {
    await updateDoc(roomDoc.ref, { players: arrayUnion(buildPlayerEntry(player)) })
  }

  return roomDoc.id
}

/**
 * Remove a player from the room's players array and delete their playlist entry.
 * Uses a transaction for atomic read-modify-write.
 *   - If the room becomes empty, deletes the document (no ghost rooms).
 *   - If the leaving player was the host, transfers host to the next player.
 *
 * @returns {{ closed: boolean }} — true if the room was deleted.
 */
export async function leaveRoom(roomId, uid) {
  const roomRef = doc(db, ROOMS, roomId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef)
    if (!snap.exists()) return { closed: false }

    const room           = snap.data()
    const updatedPlayers = room.players.filter(p => p.uid !== uid)

    // Last player — delete the room to avoid ghost rooms
    if (updatedPlayers.length === 0) {
      tx.delete(roomRef)
      return { closed: true }
    }

    const updates = { players: updatedPlayers }

    // Remove their playlist entry if present
    if (room.playerPlaylists?.[uid]) {
      updates[`playerPlaylists.${uid}`] = deleteField()
    }

    // If the leaving player was the host, transfer to the next player
    if (room.hostId === uid) {
      updates.hostId = updatedPlayers[0].uid
    }

    tx.update(roomRef, updates)
    return { closed: false }
  })
}

/**
 * Save the playlist a player has chosen to contribute.
 * The track list is pre-fetched and pre-filtered by the client
 * (only tracks with preview_url are included).
 */
export async function connectPlaylist(roomId, uid, playlistId, playlistName, tracks) {
  await updateDoc(doc(db, ROOMS, roomId), {
    [`playerPlaylists.${uid}`]: { playlistId, playlistName, tracks },
  })
}

// ─── Game Start ───────────────────────────────────────────────────────────────

/**
 * Write the pre-built rounds array to Firestore and advance phase to 'playing'.
 * Round selection (fairness + shuffle) happens on the host's client in useGameStore.
 *
 * @param {string} roomId
 * @param {Round[]} rounds
 */
export async function startGame(roomId, rounds) {
  await updateDoc(doc(db, ROOMS, roomId), {
    rounds,
    currentRound: 0,
    phase:        'playing',
    scores:       {},
    playerPlaylists: {},
  })
}

// ─── Round Play ───────────────────────────────────────────────────────────────

/**
 * Record a player's guess for the current round.
 * Uses a transaction to read-modify-write the rounds array safely
 * (Firestore doesn't support dot-notation index updates on arrays).
 */
export async function submitGuess(roomId, roundIndex, uid, guessedUids) {
  const roomRef = doc(db, ROOMS, roomId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef)
    if (!snap.exists()) return
    const rounds = [...snap.data().rounds]
    rounds[roundIndex] = {
      ...rounds[roundIndex],
      guesses: { ...rounds[roundIndex].guesses, [uid]: guessedUids },
    }
    tx.update(roomRef, { rounds })
  })
}

/**
 * Mark a round as revealed and atomically apply score increments.
 * Uses a transaction so the rounds array stays an array.
 *
 * @param {string} roomId
 * @param {number} roundIndex
 * @param {{ [uid]: number }} scoreIncrements  e.g. { "uid123": 100 }
 */
export async function revealRound(roomId, roundIndex, scoreIncrements) {
  const roomRef = doc(db, ROOMS, roomId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef)
    if (!snap.exists()) return
    const data = snap.data()
    const rounds = [...data.rounds]
    rounds[roundIndex] = { ...rounds[roundIndex], revealed: true }

    const scores = { ...(data.scores ?? {}) }
    for (const [uid, pts] of Object.entries(scoreIncrements)) {
      // Skor 0'ın altına düşmesin — moral kırmasın.
      scores[uid] = Math.max(0, (scores[uid] ?? 0) + pts)
    }
    tx.update(roomRef, { rounds, scores })
  })
}

/**
 * Advance to the next round, or end the game if all rounds are done.
 */
export async function advanceRound(roomId, nextIndex, totalRounds) {
  await updateDoc(doc(db, ROOMS, roomId), {
    currentRound: nextIndex,
    phase:        nextIndex >= totalRounds ? 'finished' : 'playing',
  })
}

// ─── Reset to Lobby ──────────────────────────────────────────────────────────

export async function resetToLobby(roomId) {
  const roomRef = doc(db, ROOMS, roomId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef)
    if (!snap.exists()) return
    const data = snap.data()
    const players = (data.players ?? []).map(p => ({ ...p }))
    tx.update(roomRef, {
      phase: 'lobby',
      currentRound: 0,
      rounds: [],
      scores: {},
      goldAwarded: false,
      playerPlaylists: {},
    })
  })
}

// ─── Gold Award ──────────────────────────────────────────────────────────────

/**
 * Atomically mark that the winner's gold has been awarded for this room.
 * Returns true if this call was the one that set the flag (i.e. first caller wins).
 * Returns false if gold was already awarded.
 */
export async function markGoldAwarded(roomId) {
  const roomRef = doc(db, ROOMS, roomId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef)
    if (!snap.exists()) return false
    if (snap.data().goldAwarded) return false
    tx.update(roomRef, { goldAwarded: true })
    return true
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function listenToRoom(roomId, onUpdate) {
  return onSnapshot(doc(db, ROOMS, roomId), snapshot => {
    if (snapshot.exists()) onUpdate({ id: snapshot.id, ...snapshot.data() })
  })
}

export async function getRoom(roomId) {
  const snap = await getDoc(doc(db, ROOMS, roomId))
  if (!snap.exists()) throw new Error('Room not found.')
  return { id: snap.id, ...snap.data() }
}

function buildPlayerEntry({ uid, displayName, avatarUrl = null, isPremium = false }) {
  return { uid, displayName, avatarUrl, isPremium }
}
