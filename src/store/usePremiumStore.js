/**
 * Premium Store — Zustand
 *
 * Tracks the user's premium status and RevenueCat offerings.
 * Persisted to localStorage so the app remembers premium state
 * between launches (verified on startup via RevenueCat).
 *
 * Cross-platform sync:
 *  - On native (iOS/Android): RevenueCat is the source of truth.
 *    After a purchase or restore, isPremium is also written to Firestore
 *    so other platforms can read it.
 *  - On web: RevenueCat is not available, so isPremium falls back to
 *    reading the Firestore user document.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Capacitor } from '@capacitor/core'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import {
  initPurchases,
  checkPremiumStatus,
  getOfferings,
  purchasePremium,
  restorePurchases,
  getPremiumPackages,
} from '../services/purchaseService'
import useAuthStore from './useAuthStore'

/** Write isPremium flag to Firestore user doc (for cross-platform sync). */
async function syncPremiumToFirestore(isPremium) {
  const uid = useAuthStore.getState().firebaseUser?.uid
  if (!uid) return
  try {
    await setDoc(doc(db, 'users', uid), { isPremium }, { merge: true })
    console.log('[Premium] synced isPremium =', isPremium, 'to Firestore')
  } catch (err) {
    console.warn('[Premium] Firestore sync failed:', err?.message)
  }
}

const usePremiumStore = create(
  persist(
    (set, get) => ({
      isPremium:       false,
      loading:         false,
      offerings:       null,   // RevenueCat offering (full, contains all packages)
      premiumPackages: [],     // Filtered premium subscription packages

      /**
       * Initialize RevenueCat and check current entitlement status.
       * On web (non-native), falls back to Firestore user document.
       * Call once after Firebase auth is ready.
       */
      init: async (userId) => {
        if (Capacitor.isNativePlatform()) {
          // Native: RevenueCat is the source of truth
          await initPurchases(userId)
          const premium = await checkPremiumStatus()
          set({ isPremium: premium })
          // Keep Firestore in sync whenever we verify on native
          if (premium) syncPremiumToFirestore(true)
        } else {
          // Web: read from Firestore (RC not available)
          try {
            const snap = await getDoc(doc(db, 'users', userId))
            const premium = snap.exists() ? (snap.data().isPremium === true) : false
            set({ isPremium: premium })
          } catch (err) {
            console.warn('[Premium] Firestore read failed:', err?.message)
          }
        }
      },

      /**
       * Load available purchase packages for display.
       */
      loadOfferings: async () => {
        set({ loading: true })
        const offerings = await getOfferings()
        const premiumPackages = getPremiumPackages(offerings)
        set({ offerings, premiumPackages, loading: false })
      },

      /**
       * Purchase a premium subscription package.
       * @param {object} pkg — RevenueCat package from premiumPackages
       * @returns {{ granted: boolean, diamonds: number }}
       */
      purchase: async (pkg) => {
        set({ loading: true })
        try {
          const result = await purchasePremium(pkg)
          if (result.granted) {
            set({ isPremium: true })
            syncPremiumToFirestore(true)
          }
          return result
        } finally {
          set({ loading: false })
        }
      },

      /**
       * Restore previous purchases.
       * @returns {{ granted: boolean, diamonds: number }}
       *   diamonds is always 0 on restore (already granted at purchase time)
       */
      restore: async () => {
        set({ loading: true })
        try {
          const result = await restorePurchases()
          set({ isPremium: result.granted })
          if (result.granted) syncPremiumToFirestore(true)
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
