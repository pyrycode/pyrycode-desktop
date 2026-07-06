// The wire→view-model adapter for the conversation thread. The session store holds wire
// `MessagePayload` verbatim (ADR 0004: zero drift from the mobile contract); the UI adapts
// `role`/`message_id` to the shell's presentation shape at this component boundary.
// Framework-free `.ts` module so the adapter unit-tests without React or a store.
import type { MessagePayload } from '@shared/wire/types'

/**
 * The shell's message view model. Discriminated on `type` — the value each bubble renders
 * into its CSS class + `data-message-role`, which selects the bubble's alignment/fill.
 * Relocated verbatim from the deleted `placeholderMessages` scaffolding.
 */
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }

/** Compile-time exhaustiveness guard: a new WireRole without a case is a type error. */
function assertNever(role: never): never {
  throw new Error(`Unhandled wire role: ${JSON.stringify(role)}`)
}

/**
 * Adapt one wire `MessagePayload` to the shell `Message`. Total over `WireRole`:
 * `role: 'user' → 'user'`, `role: 'assistant' → 'daemon'`; `message_id → id`; `text` carried
 * through unchanged; `conversation_id` dropped (not read into the returned object). A future
 * third `WireRole` becomes a compile error here rather than silently mapping to `'user'`.
 */
export function toMessageViewModel(m: MessagePayload): Message {
  switch (m.role) {
    case 'user':
      return { id: m.message_id, type: 'user', text: m.text }
    case 'assistant':
      return { id: m.message_id, type: 'daemon', text: m.text }
    default:
      return assertNever(m.role)
  }
}
