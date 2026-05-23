import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Capacitor } from '@capacitor/core'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../services/firebase'
import {
  initPurchases,
  checkPremiumStatus,
  getOfferings,
  purchasePremium,
  restorePurchases,
  getPremiumPackages,
} from '../services/purchaseService'

const ACTIVATION_TIMEOUT_MS = 10_000

const usePremiumStore = create(
  persist(
    (set, get) => ({
      isPremium:       false,
      loading:         false,
      activating:      false,
      offerings:       null,
      premiumPackages: [],
      _unsubscribe:    null,
      _activationTimer: null,

      init: async (userId) => {
        get()._listenToFirestore(userId)

        if (Capacitor.isNativePlatform()) {
          await initPurchases(userId)
          const premium = await checkPremiumStatus()
          set({ isPremium: premium })
        }
      },

      _listenToFirestore: (userId) => {
        const prev = get()._unsubscribe
        if (prev) prev()

        const unsub = onSnapshot(doc(db, 'users', userId), (snap) => {
          if (!snap.exists()) return
          const data = snap.data()
          const premium = data.isPremium === true
          set({ isPremium: premium, activating: false })
        })
        set({ _unsubscribe: unsub })
      },

      loadOfferings: async () => {
        set({ loading: true })
        try {
          const offerings = await getOfferings()
          const premiumPackages = getPremiumPackages(offerings)
          set({ offerings, premiumPackages, loading: false })
        } catch (err) {
          console.warn('[premiumStore] loadOfferings failed:', err.message)
          set({ loading: false })
        }
      },

      purchase: async (pkg) => {
        set({ loading: true })
        try {
          const result = await purchasePremium(pkg)
          if (result.granted) {
            if (get()._activationTimer) clearTimeout(get()._activationTimer)
            const timer = setTimeout(() => {
              if (get().activating) set({ activating: false, _activationTimer: null })
            }, ACTIVATION_TIMEOUT_MS)
            set({ activating: true, _activationTimer: timer })
          }
          return result
        } finally {
          set({ loading: false })
        }
      },

      reset: () => {
        const unsub = get()._unsubscribe
        if (unsub) unsub()
        if (get()._activationTimer) clearTimeout(get()._activationTimer)
        set({ isPremium: false, loading: false, activating: false, offerings: null, premiumPackages: [], _unsubscribe: null, _activationTimer: null })
      },

      restore: async () => {
        set({ loading: true })
        try {
          const result = await restorePurchases()
          if (result.granted) {
            if (get()._activationTimer) clearTimeout(get()._activationTimer)
            const timer = setTimeout(() => {
              if (get().activating) set({ activating: false, _activationTimer: null })
            }, ACTIVATION_TIMEOUT_MS)
            set({ activating: true, _activationTimer: timer })
          }
          return result
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'echoguess-premium',
      partialize: state => ({ isPremium: state.isPremium }),
    }
  )
)

export default usePremiumStore
