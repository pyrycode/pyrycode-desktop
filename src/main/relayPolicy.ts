// The test/dev-only relay affordance (#97), quarantined to its own module so the production gate
// (pairingPayload.ts) stays free of any dev/loopback/env code. It answers ONE question — "which
// RelayPolicy should the pairing gate use?" — and is the only place a `ws://` loopback relay can ever
// be accepted. Everything here is pure and synchronous; `selectRelayPolicy` runs ONCE at the
// composition root (index.ts) producing an immutable policy closure. Nothing here reads
// `app.isPackaged` or `process.env` itself — the effectful choice is passed in, so this module unit-
// tests with plain values (mirroring the injected-seam posture elsewhere in main).
//
// The relaxation is bounded on three independent axes, ALL required simultaneously: (1) `!isPackaged`
// — a deterministic code gate checked false-first, so a packaged build never even reads the flag and
// is byte-identical to today; (2) an explicit env opt-in equal to exactly `'1'`; (3) scheme `ws:` AND
// host exactly `127.0.0.1` (loopback only, any port — the exact URL `startFakeRelayForwarder` dials).
// The `relay-not-url` and `relay-has-credentials` checks are NOT relaxed — they live in
// parsePairingPayload and apply on both paths, so a `ws://user:pass@127.0.0.1/` relay is still rejected.
//
// The dev policy delegates its scheme+host verdict to `productionRelayPolicy`, so `RELAY_ALLOWLIST`
// stays the single source of truth for allowed hosts — this affordance is additive and never edits it.
import { productionRelayPolicy, type RelayPolicy } from './pairingPayload'

/**
 * The environment variable that opts a non-packaged build into the loopback affordance. Single-sourced
 * here so a rename is one edit; #93 sets this exact var when driving the built app at the fake relay.
 * Narrower and more honest than an "insecure relay" flag: it relaxes loopback only, never arbitrary hosts.
 */
export const LOOPBACK_RELAY_ENV_FLAG = 'PYRY_ALLOW_LOOPBACK_RELAY'

/**
 * Module-private — the affordance's guts are not importable elsewhere. Accepts the full production case
 * OR a loopback `ws:` relay on any port; otherwise returns production's (scheme-first) reject reason.
 *
 * Host match is the exact string `127.0.0.1`. This is deliberately correct against IPv4 encoding tricks:
 * WHATWG `URL` canonicalizes numeric IPv4 hosts (`ws://2130706433/`, `ws://0x7f000001/`, `ws://127.1/`
 * all yield `hostname === '127.0.0.1'`) — those are genuinely loopback, so accepting them is fine —
 * while `localhost` (a name) and `[::1]` (a different address) are NOT normalized to `127.0.0.1` and are
 * correctly rejected (AC2: "not `localhost`, not `::1`").
 */
const loopbackDevRelayPolicy: RelayPolicy = (relay) => {
  const production = productionRelayPolicy(relay)
  if (production.ok) return production
  if (relay.protocol === 'ws:' && relay.hostname === '127.0.0.1') return { ok: true }
  return production
}

/**
 * The deterministic, `isPackaged`-false-first gate — belt-and-suspenders "different fabric" (code, not
 * config). When packaged, the env flag is NEVER read, so a shipped build's relay validation is byte-
 * identical to today regardless of environment (AC3). Opt-in is exact: only the string `'1'` enables the
 * affordance — an unset var, empty string, `'0'`, or `'true'` all resolve to the production policy.
 */
export function selectRelayPolicy(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
}): RelayPolicy {
  if (opts.isPackaged) return productionRelayPolicy
  if (opts.env[LOOPBACK_RELAY_ENV_FLAG] === '1') return loopbackDevRelayPolicy
  return productionRelayPolicy
}
