import { startFakeDaemon, type FakeDaemon, type FakeDaemonOptions } from '../../src/main/transport/fakeDaemon'
import { NoiseLoadError } from '../../src/main/transport/noiseLib'

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
export async function startFakeDaemonForTest(options: FakeDaemonOptions): Promise<FakeDaemon> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await startFakeDaemon(options)
    } catch (error) {
      // Only a pre-open reset is recoverable, once. No client or delivered events exist yet;
      // startFakeDaemon has already released the failed attempt's socket and Noise state.
      if (attempt === 0 && error instanceof Error && 'code' in error && error.code === 'ECONNRESET') {
        continue
      }
      // A cause would put raw library errors (potentially URLs or paths) back in the report.
      throw new Error(`Fake daemon setup failed before Electron launch: ${classifySetupFailure(error)}`)
    }
  }
}
