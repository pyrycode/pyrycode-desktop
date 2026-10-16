import { decodeEnvelope } from '../../src/main/transport/codec'
import type { RecordedEntry } from './recordedExchange'

/** Memory-only recorder, imported exclusively by the separate capture build. */
export function createExchangeCapture(limits = { maxBytes: 2_000_000 }) {
  let active = false
  let size = 0
  let started = 0
  let entries: RecordedEntry[] = []
  let failure: string | undefined
  return {
    begin(): void { active = true; size = 0; entries = []; failure = undefined; started = Date.now() },
    observe(direction: RecordedEntry['direction'], bytes: Uint8Array): void {
      if (!active || failure) return
      size += bytes.byteLength
      if (size > limits.maxBytes || entries.length >= 5000) { entries = []; failure = 'Exchange capture exceeded its limit'; return }
      try {
        const message = decodeEnvelope(bytes)
        if (['hello', 'hello_ack', 'rekey_request', 'multipart', 'fragment'].includes(message.type)) throw new Error()
        entries.push({ direction, atMs: Date.now() - started, message })
      } catch { entries = []; failure = 'Exchange capture rejected a frame' }
    },
    take(): RecordedEntry[] {
      if (!active) throw new Error('Exchange capture not active')
      if (failure) throw new Error(failure)
      return structuredClone(entries)
    },
    stop(): void { active = false; entries = []; size = 0; failure = undefined }
  }
}
export type ExchangeCapture = ReturnType<typeof createExchangeCapture>
