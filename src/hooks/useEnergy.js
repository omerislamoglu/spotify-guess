/**
 * useEnergy — custom hook for energy, diamond & gold system.
 *
 * Returns:
 *   energy              — current energy (0–10+, can overflow via diamond purchase)
 *   maxEnergy           — 10 (natural cap)
 *   costPerGame         — 4
 *   diamonds            — current diamond balance
 *   gold                — current gold balance
 *   isPremium           — whether user has an active premium subscription (ad-free, badge)
 *   canPlay             — whether user can afford a game (energy >= 4)
 *   loading             — true while a Firestore op is in-flight
 *   energyDepletedAt    — epoch ms when energy hit 0 (null if not depleted)
 *   refillAt            — epoch ms when energy will auto-refill (null if not depleted)
 *   consumeEnergy       — deduct energy for a game action
 *   refillEnergy        — restore energy to max
 *   addDiamonds         — credit diamonds after IAP
 *   addGold             — credit gold (e.g. after winning)
 *   buyEnergyWithDiamonds — exchange diamonds for energy pack
 *   buyDiamondsWithGold — exchange gold for diamonds
 *   checkAutoRefill     — re-check Firestore to apply auto-refill
 */

import useEnergyStore from '../store/useEnergyStore'
import usePremiumStore from '../store/usePremiumStore'
import useAuthStore from '../store/useAuthStore'
import { MAX_ENERGY, ENERGY_PER_GAME, REFILL_COOLDOWN } from '../services/energyService'

export default function useEnergy() {
  const energy           = useEnergyStore(s => s.energy)
  const diamonds         = useEnergyStore(s => s.diamonds)
  const gold             = useEnergyStore(s => s.gold)
  const energyDepletedAt = useEnergyStore(s => s.energyDepletedAt)
  const loading          = useEnergyStore(s => s.loading)
  const consume          = useEnergyStore(s => s.consumeEnergy)
  const refill           = useEnergyStore(s => s.refillEnergy)
  const addDia           = useEnergyStore(s => s.addDiamonds)
  const addGoldFn        = useEnergyStore(s => s.addGold)
  const buyEnergy        = useEnergyStore(s => s.buyEnergyWithDiamonds)
  const buyDiaWithGold   = useEnergyStore(s => s.buyDiamondsWithGold)
  const autoRefill       = useEnergyStore(s => s.checkAutoRefill)
  const isPremium        = usePremiumStore(s => s.isPremium)
  const firebaseUser     = useAuthStore(s => s.firebaseUser)

  const uid      = firebaseUser?.uid
  const refillAt = energyDepletedAt ? energyDepletedAt + REFILL_COOLDOWN : null

  return {
    energy,
    maxEnergy:   MAX_ENERGY,
    costPerGame: ENERGY_PER_GAME,
    diamonds,
    gold,
    isPremium,
    canPlay:     energy >= ENERGY_PER_GAME,
    loading,
    energyDepletedAt,
    refillAt,

    consumeEnergy: async (amount = ENERGY_PER_GAME) => {
      if (!uid) return false
      return consume(uid, amount)
    },

    refillEnergy: async (amount = MAX_ENERGY) => {
      if (!uid) return
      return refill(uid, amount)
    },

    addDiamonds: async (amount) => {
      if (!uid) return
      return addDia(uid, amount)
    },

    addGold: async (amount) => {
      if (!uid) return
      return addGoldFn(uid, amount)
    },

    buyEnergyWithDiamonds: async (packageId) => {
      if (!uid) throw new Error('Not authenticated')
      return buyEnergy(uid, packageId)
    },

    buyDiamondsWithGold: async (packageId) => {
      if (!uid) throw new Error('Not authenticated')
      return buyDiaWithGold(uid, packageId)
    },

    checkAutoRefill: async () => {
      if (!uid) return
      return autoRefill(uid)
    },
  }
}
