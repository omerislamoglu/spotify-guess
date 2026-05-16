/**
 * PKCE (Proof Key for Code Exchange) helpers for Spotify OAuth.
 * These run entirely in the browser — no client secret is ever used.
 */

/** Generate a cryptographically random code verifier (43–128 chars, URL-safe). */
export function generateCodeVerifier() {
  const array = new Uint8Array(64)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/** Derive the SHA-256 code challenge from a verifier. */
export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
