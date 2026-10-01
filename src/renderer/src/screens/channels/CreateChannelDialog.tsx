import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_SYSTEM_PROMPT_BYTES, type ConversationCreatedPayload } from '@shared/wire/types'
import { ChannelForm } from './ChannelForm'
import { Modal } from '../../components/Modal'
import { requestNewChannel } from '../../store/conversationCreatedBridge'
import { selectStatusFor, sessionStore } from '../../store/sessionStore'
import { submitSystemPrompt } from '../../store/systemPromptWriteBridge'
import { systemPromptWriteStore } from '../../store/systemPromptWriteStore'

export function CreateChannelDialogView({
  name, busy, error, systemPrompt, promptOverLimit,
  onNameChange, onSystemPromptChange, onCancel, onCreate
}: {
  name: string
  busy: boolean
  error: string | null
  systemPrompt: string
  promptOverLimit: boolean
  onNameChange: (next: string) => void
  onSystemPromptChange: (next: string) => void
  onCancel: () => void
  onCreate: () => void
}): JSX.Element {
  return (
    <div className="create-channel-overlay">
      <div className="create-channel-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Create channel"
        width={640}
        onClose={onCancel}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{
          label: 'OK',
          onClick: onCreate,
          // The prompt is OPTIONAL, so an empty box never blocks OK; only a value past the bound does.
          disabled: busy || name.trim() === '' || promptOverLimit
        }}
      >
        <ChannelForm
          name={name} busy={busy} error={error} onNameChange={onNameChange}
          prompt={{ value: systemPrompt, overLimit: promptOverLimit, onChange: onSystemPromptChange }}
        />
      </Modal>
    </div>
  )
}

// Hoisted, because otherwise a fresh encoder is allocated on every keystroke — `SystemPromptSection`
// hoists its own for the same reason.
const UTF8 = new TextEncoder()

/**
 * The typing-time bound (AC3), counted in UTF-8 BYTES the way the channel info sheet counts it — a
 * `.length` count would report "under" on a value main refuses, since one astral or CJK character is
 * several bytes. The bound is not re-implemented here: `MAX_SYSTEM_PROMPT_BYTES` is the shared
 * constant main enforces independently with `Buffer.byteLength(prompt, 'utf8')`, and a second
 * authority could only disagree with the first. Inclusive `>`, matching main.
 */
export function systemPromptOverLimit(text: string): boolean {
  return UTF8.encode(text).length > MAX_SYSTEM_PROMPT_BYTES
}

// The daemon chooses the default folder, so the pending arm records the trimmed name and prompt only.
// A ref keeps the event listener's snapshot current without resubscribing on each keystroke.
type Pending =
  | { type: 'idle' }
  | { type: 'channel'; name: string; systemPrompt: string | null }

/**
 * Whether this confirmation is for the create THIS dialog asked for (AC2).
 *
 * `conversationCreated` is uncorrelated — main emits it on decode without matching it to a request —
 * so the payload's echoed promotion and name are the only handles beyond the host stamp the listener
 * checks. The daemon resolves a null requested `cwd` to its default; the reply's path cannot be
 * compared with a requested path. The real-daemon spec proves the created name, promotion, and default
 * workspace independently of the fake's request echo.
 *
 * THIS IS AN ATTRIBUTION FILTER, NOT AN AUTHORIZATION CHECK. A hostile or impersonating daemon picks
 * the `id` in its own confirmation and could already direct the write anywhere; no client-side compare
 * of fields that same party supplies can prevent that. What it closes is the real hazard: a same-host
 * confirmation for a create some OTHER client asked for, which would otherwise write the operator's
 * text onto a conversation they did not create. The name is an opaque display string, never a secret.
 *
 * RESIDUAL, stated rather than engineered around (the posture `daemon-connection-correlation.md`
 * already takes): two identical concurrent promoted creates on one host with the same trimmed name stay
 * indistinguishable, and the first confirmation to arrive takes the write.
 */
export function confirmsPending(conversation: ConversationCreatedPayload, pending: Pending): boolean {
  return pending.type === 'channel' &&
    conversation.is_promoted === true &&
    conversation.name === pending.name
}

/**
 * The second step of the create: on the confirmation for the channel this dialog asked for, send
 * exactly one `set_system_prompt` for that conversation's own `id`, through the shipped
 * `submitSystemPrompt` (#1249 built the transport, #1078 was its first caller). No new wire type, no
 * new envelope, no new IPC arm — the daemon's verb takes an EXISTING `conversation_id`, which is why
 * this is a second step and not a field on the create.
 *
 * The text crosses VERBATIM AND UNTRIMMED. The blank decision was taken once, at send time: a draft
 * that trims to empty was recorded as `null` and nothing is sent for it (AC2), while a non-blank draft
 * keeps its own leading and trailing whitespace, because the value round-trips to the daemon as a
 * write and normalising it here would silently change what the operator stored.
 *
 * `sendCommand` can throw locally — the create path below wraps `requestNewChannel` for exactly that —
 * and an exception escaping this call would abort the caller's dismissal, stranding the dialog over an
 * already-created channel, and would carry the failed command, prompt included, onto an error path
 * this file does not control. So it is caught. The `catch` is EMPTY BY DESIGN: the in-flight marker
 * `submitSystemPrompt` records before sending is swept by the write store's `reconnected` arm, and
 * there is nothing loggable here that is not forbidden.
 *
 * The outcome lands in the app-level `systemPromptWriteStore`, where the channel info sheet's
 * `SystemPromptSection` already reports it. This dialog does not wait for the acknowledgement: the
 * confirmed-channel navigation is the existing close signal. One write per create, so the
 * same-conversation ambiguity in `system-prompt-write.md` § Known limitation is never reached.
 */
function writePrompt(conversation: ConversationCreatedPayload, pending: Pending): void {
  if (pending.type !== 'channel' || pending.systemPrompt === null) return
  if (!confirmsPending(conversation, pending)) return
  try {
    submitSystemPrompt(
      {
        sendCommand: window.pyry.sendCommand,
        dispatch: (event) => systemPromptWriteStore.getState().dispatch(event)
      },
      conversation.id,
      pending.systemPrompt
    )
  } catch {
    // Deliberately silent — see the docblock.
  }
}

// This mounted draft owns only its continuation. The daemon owns already-sent operations,
// and the existing navigation bridge owns opening confirmed channels.
export function CreateChannelDialog({ serverId, onDismiss }: {
  serverId: string
  onDismiss: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  // The prompt draft is transient UI state that dies with the unmount: Cancel and the header close
  // unmount this container, so a reopen starts empty (AC4). An operator can paste a credential into a
  // system prompt, so nothing on this path touches localStorage, sessionStorage, IndexedDB or persist.
  const [systemPrompt, setSystemPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<Pending>({ type: 'idle' })
  const abandoned = useRef(false)
  const unsubscribe = useRef<(() => void) | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const cleanup = useCallback(() => {
    abandoned.current = true
    pending.current = { type: 'idle' }
    unsubscribe.current?.()
    unsubscribe.current = null
  }, [])
  const dismiss = useCallback((code: 'cancelled' | 'confirmed' | 'disconnected') => {
    cleanup()
    window.pyry.sendDiagnostic({ event: 'channel-create-closed', code })
    onDismissRef.current()
  }, [cleanup])
  const fail = useCallback(() => {
    pending.current = { type: 'idle' }
    setBusy(false)
    setError('Could not create that channel')
    window.pyry.sendDiagnostic({ event: 'channel-create-state', code: 'channel-rejected' })
  }, [])

  useEffect(() => {
    abandoned.current = false
    const offEvents = window.pyry.onDaemonEvent((event) => {
      // Inspect the original main stamp before flattening: these replies have no renderer request ID.
      // Concurrent same-host operations in the same stage remain indistinguishable.
      if (abandoned.current || serverId === '' || event.serverId !== serverId) return
      if (selectStatusFor(serverId)(sessionStore.getState())?.type !== 'connected') {
        dismiss('disconnected')
        return
      }
      if (pending.current.type !== 'channel') return
      if (event.type === 'conversationCreated') {
        writePrompt(event.conversation, pending.current)
        // Unchanged and UNCONDITIONAL: AC2 keeps dismissal behaving exactly as it did before the
        // write existed, so a same-host confirmation this draft did not ask for still dismisses —
        // it just no longer carries the operator's prompt with it.
        dismiss('confirmed')
      } else if (event.type === 'conversationCreateRejected') fail()
    })
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && selectStatusFor(serverId)(state)?.type !== 'connected') {
        dismiss('disconnected')
      }
    })
    unsubscribe.current = () => { offEvents(); offStatus() }
    return cleanup
  }, [serverId, cleanup, dismiss, fail])

  const promptOverLimit = systemPromptOverLimit(systemPrompt)

  return <CreateChannelDialogView
    name={name} busy={busy} error={error}
    systemPrompt={systemPrompt} promptOverLimit={promptOverLimit}
    onNameChange={setName}
    onSystemPromptChange={setSystemPrompt}
    onCancel={() => dismiss('cancelled')}
    onCreate={() => {
      const displayName = name.trim()
      if (abandoned.current || pending.current.type !== 'idle' || displayName === '') return
      if (promptOverLimit) return
      if (selectStatusFor(serverId)(sessionStore.getState())?.type !== 'connected') {
        dismiss('disconnected')
        return
      }
      setBusy(true)
      setError(null)
      // The synchronous ref is set before dispatch, so a second activation cannot re-enter
      // before React paints the disabled OK. It records what goes out — the TRIMMED name
      // `requestNewChannel` sends the trimmed name; the daemon resolves `cwd: null`. Retain the prompt
      // to write, or `null` for a box that holds nothing but whitespace.
      pending.current = {
        type: 'channel',
        name: displayName,
        systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt
      }
      window.pyry.sendDiagnostic({ event: 'channel-create-state', code: 'channel-requested' })
      try {
        requestNewChannel(window.pyry.sendCommand, displayName, null, serverId)
      } catch {
        fail()
      }
    }}
  />
}
