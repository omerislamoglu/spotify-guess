/**
 * AdMob Service — interstitial + rewarded ads via @capacitor-community/admob.
 *
 * - Interstitial: shown at end of each game (skipped for premium)
 * - Rewarded: user watches ad to earn 4 energy
 *
 * On web (non-native), all calls are no-ops so the game works unchanged.
 */

import { Capacitor } from '@capacitor/core'
import { AdMob, InterstitialAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob'
import usePremiumStore from '../store/usePremiumStore'

let initialized = false

// ── Ad Unit IDs ─────────────────────────────────────────────────────────────
// Set VITE_ADMOB_ENV=production in your .env for real ads.
// Defaults to test IDs for development.
const IS_TESTING = import.meta.env.VITE_ADMOB_ENV !== 'production'

const INTERSTITIAL_ID =
  Capacitor.getPlatform() === 'ios'
    ? (IS_TESTING ? 'ca-app-pub-3940256099942544/4411468910' : (import.meta.env.VITE_ADMOB_INTERSTITIAL_IOS ?? ''))
    : (IS_TESTING ? 'ca-app-pub-3940256099942544/1033173712' : (import.meta.env.VITE_ADMOB_INTERSTITIAL_ANDROID ?? ''))

const REWARDED_ID =
  Capacitor.getPlatform() === 'ios'
    ? (IS_TESTING ? 'ca-app-pub-3940256099942544/1712485313' : (import.meta.env.VITE_ADMOB_REWARDED_IOS ?? ''))
    : (IS_TESTING ? 'ca-app-pub-3940256099942544/5224354917' : (import.meta.env.VITE_ADMOB_REWARDED_ANDROID ?? ''))

/**
 * Initialize AdMob SDK. Safe to call multiple times — only runs once.
 * On iOS, requests App Tracking Transparency authorization before init.
 */
export async function initAdMob() {
  if (!Capacitor.isNativePlatform() || initialized) return
  try {
    // iOS 14+: request ATT permission before initializing ads
    if (Capacitor.getPlatform() === 'ios') {
      try {
        await AdMob.requestTrackingAuthorization()
      } catch {
        // ATT API not available on this OS version — continue without it
      }
    }
    await AdMob.initialize({
      initializeForTesting: IS_TESTING,
    })
    initialized = true
  } catch {
    // AdMob init can fail on simulators — non-fatal
  }
}

/**
 * Prepare and show a full-screen interstitial ad.
 * Returns a promise that resolves when the ad is dismissed (or if it fails to load).
 * Never throws — a failed ad should not block the user.
 */
export async function showInterstitial() {
  if (!Capacitor.isNativePlatform() || !initialized) return

  // Premium users never see ads
  if (usePremiumStore.getState().isPremium) return

  try {
    await AdMob.prepareInterstitial({
      adId: INTERSTITIAL_ID,
      isTesting: IS_TESTING,
    })

    await AdMob.showInterstitial()

    await new Promise(resolve => {
      const listener = AdMob.addListener(
        InterstitialAdPluginEvents.Dismissed,
        () => { listener.remove(); resolve() }
      )
      setTimeout(() => { listener.remove(); resolve() }, 30000)
    })
  } catch {
    // Failed ad should not block the user
  }
}

/**
 * Show a rewarded ad. The user watches the full ad to earn a reward.
 *
 * @returns {Promise<boolean>} true if the user earned the reward, false otherwise.
 * Never throws — returns false on failure.
 */
export async function showRewardedAd() {
  if (!Capacitor.isNativePlatform() || !initialized) return false

  try {
    await AdMob.prepareRewardVideoAd({
      adId: REWARDED_ID,
      isTesting: IS_TESTING,
    })

    await AdMob.showRewardVideoAd()

    // Wait for the reward event
    const rewarded = await new Promise(resolve => {
      let earned = false

      const rewardListener = AdMob.addListener(
        RewardAdPluginEvents.Rewarded,
        () => { earned = true }
      )

      const dismissListener = AdMob.addListener(
        RewardAdPluginEvents.Dismissed,
        () => {
          rewardListener.remove()
          dismissListener.remove()
          resolve(earned)
        }
      )

      // Safety timeout
      setTimeout(() => {
        rewardListener.remove()
        dismissListener.remove()
        resolve(earned)
      }, 60000)
    })

    return rewarded
  } catch {
    return false
  }
}
