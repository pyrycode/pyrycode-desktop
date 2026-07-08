// The one-per-session diagnostics banner (#132). At app start the composition root emits exactly
// one content-free "session start" record carrying the client build and the wire-protocol identity,
// so a debug bundle can be attributed to a specific version pair — the first thing you need when a
// fault turns out to be a version mismatch (the exact Noise variant is load-bearing and a mismatch
// fails the handshake SILENTLY; CLAUDE.md, ADR 0002).
//
// This is a tiny dedicated module purely for the unit-test surface: the emission seam lives inside
// app.whenReady() at the root, which is not unit-testable. It is Electron-FREE — the only
// Electron-sourced value, app.getVersion(), is passed in as `appVersion`, keeping the Electron
// coupling at the composition root exactly like diagnosticLog.ts itself. The two wire constants are
// imported verbatim from the shared contract, never retyped (@shared alias is unavailable in
// src/main — see transport/codec.ts for the relative-import idiom).
import type { DiagnosticLog } from './diagnosticLog'
import { NOISE_PROTOCOL, PROTOCOL_VERSION } from '../shared/wire/types'

/**
 * Emit the once-per-session diagnostics banner through the #126 logger. Fire-once at startup — call
 * it from the composition root immediately after the logger exists so the banner is seq 0 (the first
 * line of every bundle), NEVER from the transport start/reconnect/dial paths (AC3: re-running the
 * transport must not re-emit it). Every field is a static, non-secret attribution string:
 *  - `appVersion`      — which desktop client build (from app.getVersion(), injected).
 *  - `noiseProtocol`   — the Noise handshake variant (the silent-failure axis).
 *  - `protocolVersion` — the outer wire-protocol version (v1 vs v2; the two share the same Noise
 *                        variant, so this is the only v1↔v2 negotiation-drift discriminator).
 * seq/ts are stamped by the logger. event() never throws, so there is no failure branch here.
 */
export function logSessionStart(log: DiagnosticLog, appVersion: string): void {
  log.event({
    event: 'session-start',
    appVersion,
    noiseProtocol: NOISE_PROTOCOL,
    protocolVersion: PROTOCOL_VERSION
  })
}
