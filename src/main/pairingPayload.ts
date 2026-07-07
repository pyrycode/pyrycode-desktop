// The pairing-payload input gate. Desktop pairing is paste-only: the operator pastes the string the
// daemon minted (`pyry pair`), and that paste is the FIRST point where attacker-influenceable text
// enters the pairing flow. This module is that gate. It does two jobs and stops:
//   1. Parse the pasted string into the four QrPayload fields, rejecting any malformed input with a
//      typed rejection (never a partial or defaulted record).
//   2. Validate the relay — the one semantic check the gate owns, and the security-load-bearing one:
//      the URL's scheme must be `wss:` and its host must be in an explicit main-process allowlist.
//      Without it a pasted payload could point the client at an attacker relay before the transport
//      (relayConnection.ts) dials it verbatim — this is the only place the relay is checked.
//
// It lives in src/main (not shared/renderer) because validating transport-facing untrusted input is a
// background-process concern: the token (a bearer credential) and server_static_pubkey (a static key)
// it parses must never transit the renderer (CLAUDE.md "Keep the transport out of the window"; ADR
// 0002). It is a PURE, SYNCHRONOUS, TOTAL function — no persistence, no crypto, no IPC, no socket — and
// LOG-FREE by construction: no console.* anywhere; no field value ever reaches a reason or an error
// (reasons are fixed value-free category strings; caught errors are discarded, never echoed).
//
// The validated output (a QrPayload) is consumed by #53 (fingerprint-confirm-and-persist over the
// paired-server store); this ticket stops at producing a validated record. The wire encoding mirrors
// the daemon's `pair.Encode`: base64url (URL-safe, no padding) of a four-field JSON tuple — there is
// NO `pyry://` URI wrapper (the Figma placeholder's `pyry://…` is a mockup, not the contract).
import type { QrPayload } from '../shared/wire/types'

/**
 * Discriminated result. Success carries the four validated fields as a QrPayload; failure carries only
 * a category reason — never a partial record, never a field value.
 */
export type ParsePairingResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; reason: PairingRejectReason }

/**
 * Rejection categories. Each is a bounded, value-free string — safe to surface or log. Ordered by the
 * pipeline stage that produces it. The consumer (#53) decides how to surface a reason to the operator;
 * this module never logs.
 */
export type PairingRejectReason =
  | 'not-base64url' // outer string is empty or not the URL-safe, no-pad base64url alphabet
  | 'not-json' // decoded bytes are not valid UTF-8 JSON (incl. trailing garbage)
  | 'not-object' // JSON is not a non-null, non-array object
  | 'malformed-field' // a field is missing, not a string, or empty
  | 'relay-not-url' // relay string does not parse as a URL
  | 'relay-scheme-not-wss' // relay scheme is not exactly 'wss:'
  | 'relay-has-credentials' // relay URL carries embedded userinfo (user:pass@)
  | 'relay-host-not-allowed' // relay host is not in RELAY_ALLOWLIST

/**
 * The single source of truth for allowed relay hosts (AC4). Milestone-1 is one pyrybox behind one
 * relay, so the set has one entry: the deployed relay `wss://pyrycode-relay.pyryco.de/v1/client`.
 * Hostnames only, lowercase (URL.hostname normalizes case). Matched by exact `Set.has` — no prefix,
 * suffix, or substring matching — so `pyrycode-relay.pyryco.de.evil.example` and `evil.example` both
 * miss. NEVER derived from the pasted payload; a future multi-relay change adds entries here and
 * nowhere else. A ReadonlySet so a consumer cannot mutate the allowlist at runtime.
 */
export const RELAY_ALLOWLIST: ReadonlySet<string> = new Set(['pyrycode-relay.pyryco.de'])

/**
 * The relay's scheme + host decision, factored out as an injectable seam (#97). It owns EXACTLY the
 * two checks that a test/dev affordance may relax — scheme and host — and nothing else: on failure it
 * returns one of those two reject reasons; the `relay-not-url` and `relay-has-credentials` checks stay
 * in `parsePairingPayload` and wrap the policy call, so they apply on every path. The reject arm is
 * type-constrained to the two scheme/host reasons, so a policy cannot invent a new reason or leak a
 * field value. Default = `productionRelayPolicy` (below); the dev relaxation lives in `relayPolicy.ts`.
 */
export type RelayPolicy = (
  relay: URL
) => { ok: true } | { ok: false; reason: 'relay-scheme-not-wss' | 'relay-host-not-allowed' }

/**
 * The default policy — byte-identical to the inline scheme→host checks this module has always run:
 * scheme must be exactly `wss:`, then the host must be in `RELAY_ALLOWLIST`. Scheme-first, so a
 * non-`wss:` relay reports `relay-scheme-not-wss` regardless of host, exactly as before.
 */
export const productionRelayPolicy: RelayPolicy = (relay) => {
  if (relay.protocol !== 'wss:') return { ok: false, reason: 'relay-scheme-not-wss' }
  if (!RELAY_ALLOWLIST.has(relay.hostname)) return { ok: false, reason: 'relay-host-not-allowed' }
  return { ok: true }
}

/** The four QrPayload field names, re-picked explicitly on success to drop any stray JSON keys. */
const FIELDS = ['server', 'relay', 'token', 'server_static_pubkey'] as const

/**
 * The URL-safe base64url alphabet with no padding (Go's RawURLEncoding). Node's
 * `Buffer.from(s, 'base64url')` is LENIENT — it silently drops out-of-alphabet characters — so this
 * strict pre-check restores the daemon's encoding strictness: the desktop accepts exactly what the
 * phone/daemon contract emits, nothing more.
 */
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/

/**
 * Parse + validate an untrusted pasted pairing payload. Pure, synchronous, total, throw-free: every
 * failure is an `ok: false` arm with a value-free reason, every success a fully-validated QrPayload.
 * The pipeline is linear — the first failing stage returns and nothing downstream runs.
 *
 * The relay's scheme + host decision is delegated to the injected `relayPolicy`, defaulting to
 * `productionRelayPolicy` (#97). The default keeps every existing caller and test byte-identical; the
 * composition root swaps in the dev affordance only when unpackaged AND opted in. The URL-parse and
 * embedded-credentials checks are NOT part of the policy — they run here, on both paths.
 */
export function parsePairingPayload(
  pasted: string,
  relayPolicy: RelayPolicy = productionRelayPolicy
): ParsePairingResult {
  // 1. Normalize + strict base64url alphabet. A pasted string commonly carries surrounding whitespace
  //    or a trailing newline; none of it is in the base64url alphabet, so trimming can never drop
  //    payload bytes. Then require a non-empty, strictly-in-alphabet string.
  const trimmed = pasted.trim()
  if (trimmed.length === 0 || !BASE64URL_ALPHABET.test(trimmed)) {
    return reject('not-base64url')
  }

  // 2. base64url decode → UTF-8 (fatal: reject invalid bytes rather than emit replacement chars) →
  //    JSON. Trailing garbage is free: JSON.parse('{...}x') throws, so no separate trailing-byte
  //    check is needed. Any throw here maps to a single category; the caught error is discarded.
  let parsed: unknown
  try {
    const bytes = Buffer.from(trimmed, 'base64url')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    parsed = JSON.parse(text)
  } catch {
    return reject('not-json')
  }

  // 3. Object shape: a non-null, non-array object.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return reject('not-object')
  }

  // 4. Field presence + type: each of the four fields must be a NON-EMPTY string. An empty relay /
  //    token / server / pubkey is not "well-formed" (mirrors the daemon's Decode and the AC's "never
  //    a partial or defaulted record").
  const candidate = parsed as Record<string, unknown>
  for (const field of FIELDS) {
    const value = candidate[field]
    if (typeof value !== 'string' || value.length === 0) {
      return reject('malformed-field')
    }
  }

  // 5. Relay semantic validation — the security-load-bearing check.
  const relay = candidate.relay as string
  let relayUrl: URL
  try {
    relayUrl = new URL(relay)
  } catch {
    return reject('relay-not-url')
  }
  // Scheme + host verdict via the injected policy (default = production `wss:` + allowlist). The
  // production policy is scheme-first then exact-host, identical to the inline checks it replaced;
  // URL.hostname is lowercased and userinfo-stripped, so a look-alike host like
  // `pyrycode-relay.pyryco.de.evil.example` correctly misses — regardless of any `user@` prefix.
  const verdict = relayPolicy(relayUrl)
  if (!verdict.ok) {
    return reject(verdict.reason)
  }
  // On the now-accepted host, reject embedded userinfo — a pasted `wss://user:pass@host/` is
  // anomalous, and `ws` would forward it as a Basic-auth header. This closes the last path by which a
  // credential could reach the socket on a trusted host; nothing here is ever handed to `ws`.
  if (relayUrl.username !== '' || relayUrl.password !== '') {
    return reject('relay-has-credentials')
  }

  // 6. Success — pick exactly the four fields, dropping any stray keys the JSON carried.
  return {
    ok: true,
    payload: {
      server: candidate.server as string,
      relay: candidate.relay as string,
      token: candidate.token as string,
      server_static_pubkey: candidate.server_static_pubkey as string
    }
  }
}

/** Build a reject arm. Isolated so the "no field value in a reason" property stays structural. */
function reject(reason: PairingRejectReason): ParsePairingResult {
  return { ok: false, reason }
}
