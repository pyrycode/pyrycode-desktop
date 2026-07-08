// Reassembles the daemon's streamed debug-bundle frames (#116) into the complete archive, or fails
// the in-flight request cleanly. It is a pure, stateful accumulator: given the ordered
// `debug_bundle_chunk`* / `debug_bundle_done` sequence the recognition layer (inboundMessage.ts)
// narrows, it validates the stream's structural integrity (contiguous ascending `seq`, a `done`
// whose `total` equals the count received) and delivers the concatenated bytes — or one static
// failure reason — to an INJECTED consumer. The consumer receives EXACTLY ONE terminal
// (complete XOR fail); a `settled` flag makes any stray post-terminal frame inert.
//
// The archive is an opaque `.tar.gz` blob: this module concatenates decoded chunk bytes in `seq`
// order and never unpacks, inspects, or interprets them. The daemon's own reassembly reference
// (`internal/relay/v2bundlestream.go § ReassembleBundle`) is the contract we mirror: the next
// chunk's `seq` must equal the count already seen, and `done.total` must equal that count — a
// reorder / gap / duplicate / truncation fails cleanly, never a partial or corrupted archive.
//
// MAIN-PROCESS ONLY. It uses Node `Buffer` (concat) and holds decrypted bundle bytes, neither of
// which may reach the renderer — it lives in transport/ (IPC-free), delivering to `daemonConnection`
// via the consumer callback, which owns the IPC boundary.
//
// LOG-FREE by construction (mirrors the module's other transport files): it NEVER logs — it holds
// content-bearing bytes, so a diagnostic could echo them. Recognition emits the only (content-free)
// records for this feature; this layer is silent.

/**
 * The closed set of reasons a bundle reassembly can fail. Each is a static enum string — no wire
 * value, byte, or daemon message is ever interpolated into a reason.
 * - `seq-mismatch`: a reorder, gap, or duplicate chunk (the next `seq` ≠ chunks seen so far).
 * - `total-mismatch`: a `done` whose `total` ≠ the number of chunks actually received (truncation).
 * - `daemon-error`: a single daemon `error` reply arrived in lieu of the stream.
 * - `connection-lost`: the connection dropped mid-stream (the daemonConnection teardown net).
 * - `not-connected`: the request was made while disconnected (no live driver).
 */
export type BundleFailReason =
  | 'seq-mismatch'
  | 'total-mismatch'
  | 'daemon-error'
  | 'connection-lost'
  | 'not-connected'

/**
 * The injected sink for a single bundle request. The reassembler calls EXACTLY ONE of `complete` /
 * `fail`, once; `progress` (optional) fires once per accepted chunk with the ascending running
 * count. #118 constructs the per-download consumer (mapping complete → save, fail → error IPC,
 * progress → progress IPC); this slice fixes the contract.
 */
export interface BundleConsumer {
  /** The one success terminal: the fully reassembled archive, in `seq` order. */
  complete(bytes: Uint8Array): void
  /** The one failure terminal: a static reason, never a wire value. */
  fail(reason: BundleFailReason): void
  /** Optional per-accepted-chunk progress; `chunksReceived` is the ascending running count. */
  progress?(chunksReceived: number): void
}

/** The per-stream reassembler handle: the recognition layer feeds it, and it settles the consumer. */
export interface BundleReassembler {
  /** Accept one chunk. Appends iff `seq` equals the count seen so far, else fails `seq-mismatch`. */
  chunk(seq: number, data: Uint8Array): void
  /** Finalize: completes iff `total` equals the count received, else fails `total-mismatch`. */
  done(total: number): void
  /** Force a failure with a static reason (daemon-error / connection-lost / not-connected). */
  fail(reason: BundleFailReason): void
}

/**
 * Build a reassembler that streams its terminal to `consumer`. State is an ordered `Uint8Array[]`
 * of accepted chunks (its length IS the chunks-seen count) plus a `settled` flag. All three methods
 * are no-ops once settled, so the consumer is called exactly once and a stray late frame — a chunk
 * arriving after `done`, a `done` after a `fail` — is silently absorbed. Never a partial archive.
 */
export function createBundleReassembler(consumer: BundleConsumer): BundleReassembler {
  const chunks: Uint8Array[] = []
  let settled = false

  return {
    chunk(seq: number, data: Uint8Array): void {
      if (settled) return
      // The next chunk's seq must equal the count already accepted — this single check rejects a
      // reorder, a gap, and a duplicate alike (mirrors the daemon's ReassembleBundle contract).
      if (seq !== chunks.length) {
        settled = true
        consumer.fail('seq-mismatch')
        return
      }
      chunks.push(data)
      consumer.progress?.(chunks.length)
    },
    done(total: number): void {
      if (settled) return
      if (total !== chunks.length) {
        settled = true
        consumer.fail('total-mismatch')
        return
      }
      settled = true
      // Buffer.concat (main-only) is total on any input — zero chunks yields a zero-length archive,
      // the valid "empty bundle" outcome, never a rejection.
      consumer.complete(Buffer.concat(chunks))
    },
    fail(reason: BundleFailReason): void {
      if (settled) return
      settled = true
      consumer.fail(reason)
    }
  }
}
