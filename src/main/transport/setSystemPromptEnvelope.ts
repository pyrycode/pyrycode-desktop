// The `set_system_prompt` builder (#1249): it serializes the outbound write that stores, replaces or
// clears a conversation's durable system prompt. A sibling to changeWorkspaceEnvelope.ts, following
// the same one-concern-per-file split the module uses, and taking an already-built payload rather
// than scalars because there are two fields to carry.
//
// IT EXISTS BECAUSE A CONVERSATION'S BEHAVIOUR WAS OTHERWISE PER-DIRECTORY. Before it, the only way
// to shape a session was the workspace's instructions file, so two channels on the same repository
// could not differ. The daemon shipped the storage (pyrycode#2149), the spawn-time read (#2150) and
// this verb (#2151); requestSystemPromptEnvelope.ts (#1230) is the read half's ask.
//
// KEYED BY CONVERSATION, NOT BY SESSION — see the `set_system_prompt` EnvelopeType member. The prompt
// must be settable when nothing is running, and it outlives every session the conversation has.
//
// A SAVED PROMPT DOES NOT AFFECT THE RUNNING SESSION. The daemon stores the value and installs it at
// that conversation's NEXT spawn, leaving the live child alone: no restart, no rotation, no
// interruption of an in-flight turn. Nothing on this path may paper over that with an optimistic
// local value — the write reports its outcome, and what a conversation now holds is the read path's
// answer to report.
//
// NO LENGTH BOUND HERE, and the reason is the one that decides where every bound on this path lives.
// The daemon caps the prompt at MAX_SYSTEM_PROMPT_BYTES and refuses an over-length value with a
// NON-RETRYABLE `protocol.malformed`, so this client bounds the operator's text before spending that
// refusal on it — but this builder cannot emit an outcome, and a bound that fails silently here is
// exactly the "thrown away" refusal the ticket forbids. The bound that REPORTS is in the connection
// method (createDaemonConnection.setSystemPrompt), which emits a rejection and never calls this
// function. A second, weaker bound here would only be a rule to keep in agreement with that one.
//
// NO EMPTINESS CHECK on the conversation id either, the sibling builders' rule: keeping an unroutable
// id off the wire is the ROUTING LOOKUP at the IPC arm (`router.route(id)?.…`), and a fallback
// substituted here would address a conversation the caller never named.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, SetSystemPromptPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.setSystemPrompt) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildChangeWorkspace.
 */
export interface SetSystemPromptInput {
  /** The set_system_prompt Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The payload the consumer builds as a fresh literal (its two modeled fields), serialized verbatim.
   * `system_prompt` is the TRI-STATE and all three states pass through untouched: `null` clears, `''`
   * is an explicitly-empty stored state, any other string is stored. No `?? ''`, no `|| null`, no
   * truthiness read anywhere on the way — any of them collapses two of the three into one and makes
   * the clear path unreachable.
   */
  payload: SetSystemPromptPayload
}

/**
 * Build the `set_system_prompt` early-data bytes: a `set_system_prompt` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildChangeWorkspace, with the second field a
 * NULLABLE `system_prompt` rather than a required `cwd` — which is the one difference that matters
 * here, since `JSON.stringify` drops a key whose value is `undefined` but keeps one holding `null`.
 * That is why the field is typed `string | null` and required rather than optional: the clear arm has
 * to reach the wire as a present key, mirroring the daemon's `*string` without `omitempty`. The fresh
 * literal that bounds the field set lives in the connection method (setSystemPrompt).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.setSystemPrompt) catches it and drops the send. That is near-unreachable from both
 * directions — the prompt is bounded at MAX_SYSTEM_PROMPT_BYTES before this runs, and the conversation
 * id is bounded by the routing lookup, which resolves only against the daemon's own conversation index.
 */
export function buildSetSystemPrompt(input: SetSystemPromptInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'set_system_prompt',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
