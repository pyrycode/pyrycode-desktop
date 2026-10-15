import { startFakeDaemon, type FakeDaemon, type FakeDaemonOptions } from '../../src/main/transport/fakeDaemon'
import { NoiseLoadError } from '../../src/main/transport/noiseLib'
import type { FakeRelaySetupDiagnostics } from '../../src/main/transport/fakeRelayForwarder'

export interface FakeDaemonSetupAttempt {
  attempt: number
  outcome: 'opened' | 'retry-reset' | 'failed'
  failureClass: string | null
  responder: 'http-parser' | 'websocket-upgrade' | 'opened' | 'unobserved'
  parserObserved: boolean
  upgradeObserved: boolean
  upgradeRejected: boolean
  connectionObserved: boolean
  parserClass: FakeRelaySetupDiagnostics['parserClass']
  methodValid: boolean
  upgradeValid: boolean
  keyValid: boolean
  versionValid: boolean
}

const NOISE_LOAD_REASONS = ['wasm-load-failed', 'wasm-load-timeout'] as const
const SOCKET_CODES = [
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED',
  'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'EAI_AGAIN', 'ENOTFOUND'
] as const

// Every returned value is one of our own constants or three matched digits, never error text.
function classifySetupFailure(error: unknown): string {
  if (error instanceof NoiseLoadError) {
    const reason = NOISE_LOAD_REASONS.find(known => known === error.reason)
    if (reason !== undefined) return reason
  }
  if (!(error instanceof Error)) return 'unclassified'
  const code = 'code' in error ? error.code : undefined
  const socketCode = SOCKET_CODES.find(known => known === code)
  if (socketCode !== undefined) return socketCode
  const status = /^Unexpected server response: (\d{3})$/.exec(error.message)
  return status === null ? 'unclassified' : `HTTP ${status[1]}`
}

// The paired fixture dials its fake daemons before launching Electron, so launch-fate
// cannot identify these failures. Report only a fixed stage and a fixed failure class.
export async function startFakeDaemonForTest(options: FakeDaemonOptions, capture?: {
  snapshot(): FakeRelaySetupDiagnostics
  record(attempt: FakeDaemonSetupAttempt): void
}): Promise<FakeDaemon> {
  for (let attempt = 0; ; attempt += 1) {
    const before = capture?.snapshot()
    const record = (outcome: FakeDaemonSetupAttempt['outcome'], failureClass: string | null): void => {
      if (capture === undefined || before === undefined) return
      const after = capture.snapshot()
      const parserObserved = after.parserErrors > before.parserErrors
      const upgradeObserved = after.upgradeRequests > before.upgradeRequests
      const upgradeRejected = after.upgradeRejections > before.upgradeRejections
      const connectionObserved = after.connections > before.connections
      capture.record({
        attempt: attempt + 1, outcome, failureClass,
        responder: parserObserved ? 'http-parser' : upgradeRejected ? 'websocket-upgrade'
          : connectionObserved ? 'opened' : 'unobserved',
        parserObserved, upgradeObserved, upgradeRejected,
        connectionObserved,
        parserClass: parserObserved ? after.parserClass : 'none',
        methodValid: upgradeObserved && after.methodValid,
        upgradeValid: upgradeObserved && after.upgradeValid,
        keyValid: upgradeObserved && after.keyValid,
        versionValid: upgradeObserved && after.versionValid
      })
    }
    let daemon: FakeDaemon
    try {
      daemon = await startFakeDaemon(options)
    } catch (error) {
      // Only a pre-open reset is recoverable, once. No client or delivered events exist yet;
      // startFakeDaemon has already released the failed attempt's socket and Noise state.
      if (attempt === 0 && error instanceof Error && 'code' in error && error.code === 'ECONNRESET') {
        record('retry-reset', 'ECONNRESET')
        continue
      }
      const failureClass = classifySetupFailure(error)
      record('failed', failureClass)
      // A cause would put raw library errors (potentially URLs or paths) back in the report.
      throw new Error(`Fake daemon setup failed before Electron launch: ${failureClass}`)
    }
    record('opened', null)
    return daemon
  }
}
