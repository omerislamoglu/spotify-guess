/**
 * Energy, Diamond & Gold Store — Zustand
 *
 * Manages the user's energy + diamond + gold state.
 * All are stored in Firestore and cached locally.
 *
 * Energy rules:
 *  - Max 10/10 (natural refill cap)
 *  - Creating or joining a room costs 4 energy
 *  - Purchased energy (via diamonds) can overflow past 10
 *  - When energy hits 0, a 24-hour countdown starts.
 *    After 24h the energy auto-refills to 10/10.
 *
 * Gold:
 *  - Earned by winning games (1st place = 10 gold)
 *  - Exchangeable for diamonds via gold packages
 */

import { create } from 'zustand'
import {
  fetchEnergy,
  consumeEnergy     as fsConsumeEnergy,
  refillEnergy      as fsRefillEnergy,
  addEnergy         as fsAddEnergy,
  addDiamonds       as fsAddDiamonds,
  addGold           as fsAddGold,
  convertDiamondsToEnergy as fsConvert,
  convertGoldToDiamonds   as fsConvertGold,
  MAX_ENERGY,
  ENERGY_PER_GAME,
} from '../services/energyService'

const useEnergyStore = create((set, get) => ({
  energy:           MAX_ENERGY,
  diamonds:         0,
  gold:             0,
  energyDepletedAt: null,   // epoch ms — when energy hit 0 (null = not depleted)
  energyLoaded:     false,  // true once Firestore energy data has been fetched
  loading:          false,

  // ── Load ───────────────────────────────────────────────────────────────────

  /**
   * Load current energy + diamonds from Firestore. Call after auth is ready.
   * Handles the 24h auto-refill check (done server-side in fetchEnergy).
   */
  loadEnergy: async (uid) => {
    try {
      const { energy, diamonds, gold, energyDepletedAt } = await fetchEnergy(uid)
      set({ energy, diamonds, gold, energyDepletedAt, energyLoaded: true })
    } catch (err) {
      console.warn('[energyStore] loadEnergy failed:', err.message)
      set({ energyLoaded: true })
    }
  },

  // ── Energy ─────────────────────────────────────────────────────────────────

  /**
   * Consume energy for a game action.
   * Returns true if the action is allowed, false if insufficient energy.
   */
  consumeEnergy: async (uid, amount = ENERGY_PER_GAME) => {
    const { energy } = get()
    if (energy < amount) return false

    set({ loading: true })
    try {
      const result = await fsConsumeEnergy(uid, amount)
      set({
        energy:           result.energy,
        energyDepletedAt: result.energyDepletedAt,
        loading:          false,
      })
      return true
    } catch (err) {
      set({ loading: false })
      if (err.message === 'NOT_ENOUGH_ENERGY') return false
      console.error('[energyStore] consumeEnergy failed:', err.message)
      return false
    }
  },

  /**
   * Refill energy (e.g. after reward ad or admin action).
   * Clears the depletion timer.
   */
  refillEnergy: async (uid, amount = MAX_ENERGY) => {
    set({ loading: true })
    try {
      const newEnergy = await fsRefillEnergy(uid, amount)
      set({ energy: newEnergy, energyDepletedAt: null, loading: false })
    } catch (err) {
      console.warn('[energyStore] refillEnergy failed:', err.message)
      set({ loading: false })
    }
  },

  /**
   * Called by the client-side timer when 24h have elapsed.
   * Re-fetches from Firestore to apply the auto-refill.
   */
  checkAutoRefill: async (uid) => {
    try {
      const { energy, diamonds, gold, energyDepletedAt } = await fetchEnergy(uid)
      set({ energy, diamonds, gold, energyDepletedAt })
    } catch (err) {
      console.warn('[energyStore] checkAutoRefill failed:', err.message)
    }
  },

  /**
   * Check if the user can afford a game action.
   */
  canAfford: (amount = ENERGY_PER_GAME) => {
    return get().energy >= amount
  },

  /**
   * Add energy atomically (for ad reward or refund).
   * @param {number} cap — if > 0, clamp result to this max (0 = no cap)
   */
  addEnergy: async (uid, amount, cap = 0) => {
    set({ loading: true })
    try {
      const newEnergy = await fsAddEnergy(uid, amount, cap)
      set({ energy: newEnergy, energyDepletedAt: null, loading: false })
      return newEnergy
    } catch (err) {
      console.error('[energyStore] addEnergy failed:', err.message)
      set({ loading: false })
      throw err
    }
  },

  // ── Diamonds ───────────────────────────────────────────────────────────────

  addDiamonds: async (uid, amount) => {
    set({ loading: true })
    try {
      const newCount = await fsAddDiamonds(uid, amount)
      set({ diamonds: newCount, loading: false })
      return newCount
    } catch (err) {
      console.error('[energyStore] addDiamonds failed:', err.message)
      set({ loading: false })
      throw err
    }
  },

  buyEnergyWithDiamonds: async (uid, packageId) => {
    set({ loading: true })
    try {
      const { energy, diamonds } = await fsConvert(uid, packageId)
      set({ energy, diamonds, energyDepletedAt: null, loading: false })
      return { energy, diamonds }
    } catch (err) {
      set({ loading: false })
      throw err
    }
  },

  // ── Gold ────────────────────────────────────────────────────────────────────

  addGold: async (uid, amount) => {
    set({ loading: true })
    try {
      const newCount = await fsAddGold(uid, amount)
      set({ gold: newCount, loading: false })
      return newCount
    } catch (err) {
      console.error('[energyStore] addGold failed:', err.message)
      set({ loading: false })
      throw err
    }
  },

  buyDiamondsWithGold: async (uid, packageId) => {
    set({ loading: true })
    try {
      const { gold, diamonds } = await fsConvertGold(uid, packageId)
      set({ gold, diamonds, loading: false })
      return { gold, diamonds }
    } catch (err) {
      set({ loading: false })
      throw err
    }
  },
}))

export default useEnergyStore
