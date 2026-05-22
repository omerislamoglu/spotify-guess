/**
 * Energy, Diamond & Gold Service — Firestore operations.
 *
 * User document shape (Firestore: /users/{uid}):
 *   energy:           number     (0–10, default 10)
 *   lastEnergyUpdate: Timestamp  (set whenever energy changes)
 *   energyDepletedAt: Timestamp | null  (set when energy hits 0, cleared on refill)
 *   diamonds:         number     (default 10 for new users)
 *   gold:             number     (default 10 for new users)
 *   isPremium:        boolean
 *
 * Refill rule:
 *   When energy is 0, a 24-hour countdown starts (energyDepletedAt).
 *   After 24 hours the energy auto-refills to MAX_ENERGY (10/10).
 *   The check runs client-side on fetchEnergy — if 24h have passed,
 *   it writes the refill to Firestore immediately.
 *
 * Gold:
 *   Earned by winning games (1st place gets 10 gold).
 *   Can be exchanged for diamonds via GOLD_PACKAGES.
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
  Timestamp,
} from 'firebase/firestore'
import { db, functions } from './firebase'
import { httpsCallable } from 'firebase/functions'

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_ENERGY        = 10
export const ENERGY_PER_GAME   = 4
export const REFILL_COOLDOWN   = 24 * 60 * 60 * 1000   // 24 hours in ms

/** Diamond IAP packages (UI + validation reference) */
export const DIAMOND_PACKAGES = [
  { id: 'diamonds_50',  diamonds: 50,  priceTL: 49.99,  label: '50 Diamonds',  badge: null       },
  { id: 'diamonds_120', diamonds: 120, priceTL: 99.99,  label: '120 Diamonds', badge: 'Popular'  },
  { id: 'diamonds_300', diamonds: 300, priceTL: 199.99, label: '300 Diamonds', badge: 'Best Deal' },
]

/** Energy exchange packages (diamonds → energy) */
export const ENERGY_PACKAGES = [
  { id: 'energy_10', energyGain: 10, diamondCost: 5,  label: '10 Energy'  },
  { id: 'energy_30', energyGain: 30, diamondCost: 10, label: '30 Energy' },
]

/** Gold → Diamond exchange packages */
export const GOLD_PACKAGES = [
  { id: 'gold_60',  goldCost: 60,  diamondGain: 5,  label: '5 Diamonds'  },
  { id: 'gold_200', goldCost: 200, diamondGain: 20, label: '20 Diamonds', badge: 'Popular' },
  { id: 'gold_360', goldCost: 360, diamondGain: 40, label: '40 Diamonds', badge: 'Best Deal' },
]

/** Gold reward for winning a game (1st place) */
export const GOLD_PER_WIN = 10

/** Diamonds granted immediately when purchasing each premium tier */
export const PREMIUM_DIAMOND_REWARDS = {
  weekly:  100,
  monthly: 500,
  yearly:  5000,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a Firestore Timestamp (or {seconds} object) to epoch ms. */
function toMs(ts) {
  if (!ts) return null
  if (ts.toMillis) return ts.toMillis()        // Firestore Timestamp
  if (ts.seconds)  return ts.seconds * 1000     // plain object from cache
  return null
}

// ─── Energy ──────────────────────────────────────────────────────────────────

/**
 * Fetch (or initialize) a user's energy + diamonds from Firestore.
 *
 * Auto-refill logic:
 *   If energy < MAX_ENERGY and `energyDepletedAt` exists and 24h have
 *   passed since depletion, the energy is reset to MAX_ENERGY and
 *   `energyDepletedAt` is cleared — both in Firestore and the return value.
 *
 * @returns {{ energy, diamonds, energyDepletedAt: number|null }}
 *   energyDepletedAt is epoch ms (or null if not depleted).
 */
export async function fetchEnergy(uid) {
  const ref  = doc(db, 'users', uid)
  const snap = await getDoc(ref)

  // First-time user — seed with full energy, 10 diamonds, 10 gold
  if (!snap.exists() || snap.data().energy == null) {
    await setDoc(ref, {
      energy:           MAX_ENERGY,
      diamonds:         10,
      gold:             10,
      energyDepletedAt: null,
      lastEnergyUpdate: serverTimestamp(),
    }, { merge: true })
    return { energy: MAX_ENERGY, diamonds: 10, gold: 10, energyDepletedAt: null }
  }

  const data         = snap.data()
  let energy         = data.energy
  const diamonds     = data.diamonds ?? 0
  const gold         = data.gold ?? 0
  let depletedAt     = toMs(data.energyDepletedAt)

  // ── 24-hour auto-refill check ──────────────────────────────────────────
  if (energy < MAX_ENERGY && depletedAt && Date.now() - depletedAt >= REFILL_COOLDOWN) {
    energy     = MAX_ENERGY
    depletedAt = null
    await setDoc(ref, {
      energy:           MAX_ENERGY,
      energyDepletedAt: null,
      lastEnergyUpdate: serverTimestamp(),
    }, { merge: true })
  }

  return { energy, diamonds, gold, energyDepletedAt: depletedAt }
}

/**
 * Consume `amount` energy atomically via transaction.
 * When energy reaches 0, sets `energyDepletedAt` to start the 24h countdown.
 * Returns { energy, energyDepletedAt }.
 * Throws if insufficient energy.
 */
export async function consumeEnergy(uid, amount = ENERGY_PER_GAME) {
  const ref = doc(db, 'users', uid)

  return runTransaction(db, async (tx) => {
    const snap    = await tx.get(ref)
    const data    = snap.exists() ? snap.data() : {}
    const current = data.energy ?? MAX_ENERGY

    if (current < amount) {
      throw new Error('NOT_ENOUGH_ENERGY')
    }

    const newEnergy = current - amount
    const updates   = {
      energy:           newEnergy,
      lastEnergyUpdate: serverTimestamp(),
    }

    // Start the 24h countdown when energy hits 0
    if (newEnergy === 0 && !data.energyDepletedAt) {
      updates.energyDepletedAt = Timestamp.now()
    }

    tx.update(ref, updates)

    return {
      energy:           newEnergy,
      energyDepletedAt: newEnergy === 0 ? (toMs(data.energyDepletedAt) ?? Date.now()) : toMs(data.energyDepletedAt),
    }
  })
}

/**
 * Refill energy to a specific value (e.g. after watching a reward ad or admin grant).
 * Clears the depletion timer.
 */
export async function refillEnergy(uid, amount = MAX_ENERGY) {
  const ref = doc(db, 'users', uid)
  const newEnergy = Math.min(amount, MAX_ENERGY)
  await setDoc(ref, {
    energy:           newEnergy,
    energyDepletedAt: null,
    lastEnergyUpdate: serverTimestamp(),
  }, { merge: true })
  return newEnergy
}

/**
 * Add energy atomically (e.g. after watching a reward ad or refunding a failed room).
 * Unlike refillEnergy (which sets a fixed value), this adds to the current balance.
 * Clears energyDepletedAt since the user now has energy again.
 *
 * @param {string} uid
 * @param {number} amount — energy to add
 * @param {number} [cap=0] — if > 0, clamp the result to this max (0 = no cap, allows overflow)
 * @returns {number} new energy value
 */
export async function addEnergy(uid, amount, cap = 0) {
  const ref = doc(db, 'users', uid)

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists() ? snap.data() : {}
    const current = data.energy ?? 0

    let newEnergy = current + amount
    if (cap > 0) newEnergy = Math.min(newEnergy, cap)

    tx.set(ref, {
      energy:           newEnergy,
      energyDepletedAt: null,
      lastEnergyUpdate: serverTimestamp(),
    }, { merge: true })

    return newEnergy
  })
}

// ─── Diamonds ────────────────────────────────────────────────────────────────

/**
 * Add diamonds to a user's balance (called after successful IAP).
 * Returns the new diamond count.
 */
export async function addDiamonds(uid, amount) {
  const ref = doc(db, 'users', uid)

  return runTransaction(db, async (tx) => {
    const snap     = await tx.get(ref)
    const current  = snap.exists() ? (snap.data().diamonds ?? 0) : 0
    const newCount = current + amount

    tx.set(ref, { diamonds: newCount }, { merge: true })
    return newCount
  })
}

/**
 * Fetch current diamond balance.
 */
export async function fetchDiamonds(uid) {
  const ref  = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  return snap.exists() ? (snap.data().diamonds ?? 0) : 0
}

// ─── Diamond → Energy Conversion ─────────────────────────────────────────────

/**
 * Convert diamonds to energy via Cloud Function (spendDiamonds).
 * The server handles the atomic transaction to prevent client-side diamond manipulation.
 *
 * @param {string} _uid — unused (auth is handled by the callable)
 * @param {string} packageId — one of ENERGY_PACKAGES[].id
 * @returns {{ energy: number, diamonds: number }} new balances
 * @throws if insufficient diamonds or invalid package
 */
export async function convertDiamondsToEnergy(_uid, packageId) {
  const pkg = ENERGY_PACKAGES.find(p => p.id === packageId)
  if (!pkg) throw new Error('INVALID_PACKAGE')

  const spendDiamonds = httpsCallable(functions, 'spendDiamonds')
  const result = await spendDiamonds({ packageId })
  return result.data
}

// ─── Gold ────────────────────────────────────────────────────────────────────

/**
 * Add gold to a user's balance (e.g. after winning a game).
 * Returns the new gold count.
 */
export async function addGold(uid, amount) {
  const ref = doc(db, 'users', uid)

  return runTransaction(db, async (tx) => {
    const snap    = await tx.get(ref)
    const current = snap.exists() ? (snap.data().gold ?? 0) : 0
    const newCount = current + amount

    tx.set(ref, { gold: newCount }, { merge: true })
    return newCount
  })
}

/**
 * Convert gold to diamonds via Cloud Function (exchangeGoldForDiamonds).
 * The server handles the atomic transaction to prevent client-side diamond manipulation.
 *
 * @param {string} _uid — unused (auth is handled by the callable)
 * @param {string} packageId — one of GOLD_PACKAGES[].id
 * @returns {{ gold: number, diamonds: number }} new balances
 * @throws if insufficient gold or invalid package
 */
export async function convertGoldToDiamonds(_uid, packageId) {
  const pkg = GOLD_PACKAGES.find(p => p.id === packageId)
  if (!pkg) throw new Error('INVALID_PACKAGE')

  const exchange = httpsCallable(functions, 'exchangeGoldForDiamonds')
  const result = await exchange({ packageId })
  return result.data
}
