/**
 * Purchase Service — RevenueCat in-app purchases.
 *
 * Handles:
 *  1. Premium subscription (entitlement-based)
 *  2. Consumable diamond packs (product-based)
 *
 * RevenueCat setup:
 *  - Entitlement "premium" → auto-renewable subscription product
 *  - Default offering with two package groups:
 *      • Premium subscription package
 *      • Consumable diamond packages (diamonds_50, diamonds_120, diamonds_300)
 *
 * On web (non-native), all calls are no-ops so the game works unchanged.
 */

import { Capacitor } from '@capacitor/core'
import { Purchases } from '@revenuecat/purchases-capacitor'
import { PREMIUM_DIAMOND_REWARDS } from './energyService'

// ── RevenueCat config ───────────────────────────────────────────────────────
// Replace with your real API keys from https://app.revenuecat.com
const REVENUECAT_IOS_KEY     = import.meta.env.VITE_REVENUECAT_IOS_KEY ?? ''
const REVENUECAT_ANDROID_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_KEY ?? ''

const ENTITLEMENT_ID = 'premium'

// Maps RevenueCat product identifiers → premium tier keys
export const PREMIUM_PRODUCT_MAP = {
  'echoguess_pro_weekly':  'weekly',
  'echoguess_pro_monthly': 'monthly',
  'echoguess_pro_yearly':  'yearly',
}

// Maps RevenueCat product identifiers → our internal diamond package IDs
const DIAMOND_PRODUCT_MAP = {
  'echoguess_diamonds_50':  'diamonds_50',
  'echoguess_diamonds_120': 'diamonds_120',
  'echoguess_diamonds_300': 'diamonds_300',
}

let initialized = false

// ── Initialize ──────────────────────────────────────────────────────────────

/**
 * Initialize RevenueCat SDK. Safe to call multiple times.
 * @param {string} userId — Firebase UID for cross-device identity
 */
export async function initPurchases(userId) {
  if (!Capacitor.isNativePlatform() || initialized) return
  try {
    const apiKey = Capacitor.getPlatform() === 'ios'
      ? REVENUECAT_IOS_KEY
      : REVENUECAT_ANDROID_KEY

    if (!apiKey) {
      console.warn('[RC] RevenueCat API key is not set. Add VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY to your .env file.')
      return
    }

    await Purchases.configure({ apiKey, appUserID: userId })
    initialized = true
    console.log('[RC] initialized ✓ userId:', userId)
  } catch (err) {
    console.warn('[RC] configure failed:', err?.message)
  }
}

// ── Premium (subscription) ──────────────────────────────────────────────────

/**
 * Check if the user currently has the premium entitlement.
 */
export async function checkPremiumStatus() {
  if (!Capacitor.isNativePlatform() || !initialized) return false
  try {
    const { customerInfo } = await Purchases.getCustomerInfo()
    return customerInfo.entitlements.active[ENTITLEMENT_ID] != null
  } catch {
    return false
  }
}

/**
 * Fetch available offerings (premium + diamond packages).
 * Returns the current (default) offering.
 */
export async function getOfferings() {
  if (!Capacitor.isNativePlatform()) return null
  if (!initialized) {
    console.warn('[RC] getOfferings called before RC was initialized.')
    return null
  }
  try {
    const result = await Purchases.getOfferings()
    // Capacitor plugin returns { current, all } directly (not wrapped in { offerings })
    const current = result?.current ?? result?.offerings?.current ?? null
    console.log('[RC] current offering:', current?.identifier,
      '| packages:', current?.availablePackages?.map(p => p.product?.identifier))
    return current
  } catch (err) {
    console.warn('[RC] getOfferings failed:', err?.message)
    return null
  }
}

/**
 * Returns how many diamonds are bundled with a given premium package.
 * @param {object} pkg — a RevenueCat package object
 * @returns {number}
 */
export function getPremiumDiamondReward(pkg) {
  const productId = pkg?.product?.identifier ?? ''
  const tier = PREMIUM_PRODUCT_MAP[productId] ?? 'monthly'
  return PREMIUM_DIAMOND_REWARDS[tier] ?? 500
}

function classifyPurchaseError(err) {
  const code = err.code ?? err.userCancelled ? 1 : -1
  if (code === 1 || err.message?.includes('cancel'))
    return { type: 'cancelled', message: 'User cancelled.' }
  if (code === 2)
    return { type: 'store_error', message: err.message ?? 'Store problem.' }
  if (code === 3)
    return { type: 'not_allowed', message: err.message ?? 'Purchases not allowed.' }
  if (code === 5)
    return { type: 'network', message: err.message ?? 'Network error.' }
  return { type: 'unknown', message: err.message ?? 'Unknown error.', original: err }
}

/**
 * Purchase a premium subscription package.
 * @param {object} pkg — a RevenueCat package object from getOfferings()
 * @returns {{ granted: boolean, diamonds: number }}
 */
export async function purchasePremium(pkg) {
  if (!Capacitor.isNativePlatform() || !initialized) return { granted: false, diamonds: 0 }
  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg })
    // If we reach here the purchase completed without error or cancellation.
    // Treat it as granted immediately — RC entitlement can take a few seconds to
    // propagate after StoreKit confirms, so don't gate diamond credit on it.
    const granted = customerInfo.entitlements.active[ENTITLEMENT_ID] != null
    const diamonds = getPremiumDiamondReward(pkg)
    console.log('[RC] purchasePremium: granted=', granted, 'diamonds=', diamonds)
    return { granted: true, diamonds }   // purchase completed → always grant
  } catch (err) {
    throw classifyPurchaseError(err)
  }
}

/**
 * Restore previous purchases (e.g. after reinstall or new device).
 * @returns {{ granted: boolean, diamonds: number }}
 *   diamonds is 0 on restore (user already received them at time of purchase)
 */
export async function restorePurchases() {
  if (!Capacitor.isNativePlatform() || !initialized) return { granted: false, diamonds: 0 }
  try {
    const { customerInfo } = await Purchases.restorePurchases()
    const granted = customerInfo.entitlements.active[ENTITLEMENT_ID] != null
    return { granted, diamonds: 0 }
  } catch {
    return { granted: false, diamonds: 0 }
  }
}

export async function logOutPurchases() {
  if (!Capacitor.isNativePlatform() || !initialized) return
  try {
    await Purchases.logOut()
  } catch (err) {
    console.warn('[RC] logOut failed:', err?.message)
  }
  initialized = false
}

// ── Diamonds (consumable) ───────────────────────────────────────────────────

/**
 * Purchase a consumable diamond package via RevenueCat.
 *
 * @param {object} pkg — a RevenueCat package object (consumable)
 * @returns {{ purchased: boolean, internalId: string|null, diamonds: number }}
 *   purchased  — true if the purchase completed
 *   internalId — our DIAMOND_PACKAGES id (e.g. 'diamonds_50')
 *   diamonds   — number of diamonds to credit
 */
export async function purchaseDiamonds(pkg) {
  if (!Capacitor.isNativePlatform() || !initialized) {
    return { purchased: false, internalId: null, diamonds: 0 }
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg })

    // Find which diamond product was purchased
    const allPurchasedIds = customerInfo.allPurchasedProductIdentifiers ?? []
    const productId = pkg.product?.identifier ?? ''

    const internalId = DIAMOND_PRODUCT_MAP[productId] ?? null

    // Determine diamond count from the product identifier
    const diamondCounts = {
      'diamonds_50':  50,
      'diamonds_120': 120,
      'diamonds_300': 300,
    }

    const diamonds = diamondCounts[internalId] ?? 0

    return { purchased: true, internalId, diamonds }
  } catch (err) {
    throw classifyPurchaseError(err)
  }
}

/**
 * Helper: extract diamond packages from an offering.
 * Filters packages whose product identifier matches our diamond products.
 *
 * @param {object} offering — RevenueCat offering from getOfferings()
 * @returns {object[]} array of RevenueCat packages for diamond products
 */
export function getDiamondPackages(offering) {
  if (!offering?.availablePackages) return []
  return offering.availablePackages.filter(
    pkg => DIAMOND_PRODUCT_MAP[pkg.product?.identifier] != null
  )
}

/**
 * Helper: extract premium subscription packages from an offering.
 * Filters packages whose product identifier is in PREMIUM_PRODUCT_MAP.
 *
 * @param {object} offering — RevenueCat offering from getOfferings()
 * @returns {object[]} array of RevenueCat packages for premium subscription
 */
export function getPremiumPackages(offering) {
  if (!offering?.availablePackages) return []

  // Primary: packages whose product ID is explicitly mapped
  const mapped = offering.availablePackages.filter(
    pkg => PREMIUM_PRODUCT_MAP[pkg.product?.identifier] != null
  )
  if (mapped.length > 0) return mapped

  // Fallback: any package that isn't a known diamond consumable.
  // Handles cases where product IDs in RC don't match PREMIUM_PRODUCT_MAP yet.
  console.warn('[RC] No packages matched PREMIUM_PRODUCT_MAP — falling back to non-diamond packages.',
    'Found IDs:', offering.availablePackages.map(p => p.product?.identifier))
  return offering.availablePackages.filter(
    pkg => DIAMOND_PRODUCT_MAP[pkg.product?.identifier] == null
  )
}
