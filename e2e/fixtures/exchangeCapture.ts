import { decodeEnvelope } from '../../src/main/transport/codec'
import type { RecordedEntry } from './recordedExchange'

/** Memory-only recorder, imported exclusively by the separate capture build. */
export function createExchangeCapture(limits = { maxBytes: 2_000_000 }) {
  let active = false
  let size = 0
  let started = 0
  let entries: RecordedEntry[] = []
  let failure: string | undefined
  let connection = 0
  let barriers: { before: number; name: string }[] = []
  let capabilities: string[][] = []
  return {
    begin(): void { active = true; size = 0; entries = []; failure = undefined; started = Date.now(); connection = 0; barriers = []; capabilities = [] },
    openConnection(): number { return active ? ++connection : 0 },
    setCapabilities(id: number, names: string[]): void {
      if (active) capabilities[id - 1] = [...names]
    },
    checkpoint(name: string): void {
      if (!active || failure) throw new Error('Exchange capture not active')
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid capture checkpoint')
      barriers.push({ before: entries.length, name })
    },
    observe(direction: RecordedEntry['direction'], bytes: Uint8Array, id?: number): void {
      if (!active || failure) return
      size += bytes.byteLength
      if (size > limits.maxBytes || entries.length >= 5000) { entries = []; failure = 'Exchange capture exceeded its limit'; return }
      try {
        const message = decodeEnvelope(bytes)
        if (['hello', 'hello_ack', 'rekey_request', 'multipart', 'fragment'].includes(message.type)) throw new Error()
        entries.push({ direction, atMs: Date.now() - started, message, ...(id ? { connection: id } : {}) })
      } catch { entries = []; failure = 'Exchange capture rejected a frame' }
    },
    take(): RecordedEntry[] {
      if (!active) throw new Error('Exchange capture not active')
      if (failure) throw new Error(failure)
      if (connection > 1 || barriers.length) throw new Error('Capture requires connection-aware export')
      return structuredClone(entries.map(({ connection: _connection, ...entry }) => entry))
    },
    takeConnections(): { wire: RecordedEntry[]; barriers: { before: number; name: string }[]; capabilities: string[][]; connections: number } {
      if (!active) throw new Error('Exchange capture not active')
      if (failure) throw new Error(failure)
      return structuredClone({ wire: entries, barriers, capabilities, connections: connection })
    },
    stop(): void { active = false; entries = []; size = 0; failure = undefined }
  }
}
export type ExchangeCapture = ReturnType<typeof createExchangeCapture>
