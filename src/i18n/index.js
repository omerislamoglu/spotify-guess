/**
 * Lightweight i18n — detects device locale, returns translated strings.
 *
 * Usage:
 *   import { t } from '../i18n'
 *   t('dash_hey', { name: 'Ömer' })  →  "Selam, Ömer"
 *
 * Supported locales: 'tr', 'en' (default)
 */

import en from './locales/en'
import tr from './locales/tr'

const LOCALES = { en, tr }

function detectLocale() {
  // navigator.language returns e.g. "tr-TR", "en-US", "en"
  const lang = (navigator.language ?? navigator.userLanguage ?? 'en').split('-')[0].toLowerCase()
  return LOCALES[lang] ? lang : 'en'
}

let currentLocale = detectLocale()
let currentStrings = LOCALES[currentLocale]

/**
 * Get the current locale code.
 */
export function getLocale() {
  return currentLocale
}

/**
 * Translate a key, with optional interpolation.
 *
 * @param {string} key — dot-free key from locale files
 * @param {Record<string, string|number>} [params] — placeholder values
 * @returns {string}
 */
export function t(key, params) {
  let str = currentStrings[key] ?? LOCALES.en[key] ?? key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v))
    }
  }

  return str
}
