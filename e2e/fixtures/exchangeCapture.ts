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
  let closures: { before: number; connection: number; code: number }[] = []
  return {
    begin(): void { active = true; size = 0; entries = []; failure = undefined; started = Date.now(); connection = 0; barriers = []; capabilities = []; closures = [] },
    openConnection(): number { return active ? ++connection : 0 },
    closeConnection(code: number): void {
      if (active && connection > 0) closures.push({ before: entries.length, connection, code })
    },
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
        // Validate the admitted envelope, then retain the actual decrypted JSON.
        // Decoder projections intentionally omit unknown forward-compatible keys.
        decodeEnvelope(bytes)
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        if (['hello', 'hello_ack', 'rekey_request', 'multipart', 'fragment'].includes(message.type)) throw new Error()
        entries.push({ direction, atMs: Date.now() - started, message, ...(id ? { connection: id } : {}) })
      } catch { entries = []; failure = 'Exchange capture rejected a frame' }
    },
    take(): RecordedEntry[] {
      if (!active) throw new Error('Exchange capture not active')
      if (failure) throw new Error(failure)
      if (connection > 1 || barriers.length || closures.length) throw new Error('Capture requires connection-aware export')
      return structuredClone(entries.map(({ connection: _connection, ...entry }) => entry))
    },
    takeConnections(): { wire: RecordedEntry[]; barriers: { before: number; name: string }[]; capabilities: string[][]; connections: number; closures: { before: number; connection: number; code: number }[] } {
      if (!active) throw new Error('Exchange capture not active')
      if (failure) throw new Error(failure)
      return structuredClone({ wire: entries, barriers, capabilities, connections: connection, closures })
    },
    stop(): void { active = false; entries = []; size = 0; failure = undefined }
  }
}
export type ExchangeCapture = ReturnType<typeof createExchangeCapture>
