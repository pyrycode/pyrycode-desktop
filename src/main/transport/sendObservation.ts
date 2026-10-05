/** Main-only observation of one send, retained beside plaintext during rekey. */
export type SendDropReason =
  | 'send-refused' | 'send-failed' | 'write-failed'
  | 'rekey-buffer-full' | 'rekey-abandoned' | 'rekey-teardown'
export type SendOutcome =
  | { type: 'sent'; connectionId: string }
  | { type: 'dropped'; reason: SendDropReason }

export function notifySend(observe: ((outcome: SendOutcome) => void) | undefined, outcome: SendOutcome): void {
  try {
    observe?.(outcome)
  } catch {
    // Diagnostics must never affect delivery.
  }
}
