import { initializeApp } from 'firebase/app'
import { initializeAuth, getAuth, browserLocalPersistence, indexedDBLocalPersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { Capacitor } from '@capacitor/core'

const firebaseConfig = {
  apiKey:     'AIzaSyCBa387ccuyRj4Lw16U5CeSENud1TuCX34',
  authDomain: 'spotify-guess-30d26.firebaseapp.com',
  projectId:  'spotify-guess-30d26',
  appId:      '1:177388613740:web:f763a25116dd79facaa849',
}

const app = initializeApp(firebaseConfig)

// On native Capacitor (WKWebView) the default indexedDB persistence hangs,
// so we force browserLocalPersistence (localStorage-based).
// On web, use the default getAuth which picks the best available persistence.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: browserLocalPersistence })
  : getAuth(app)

export const db = getFirestore(app)
