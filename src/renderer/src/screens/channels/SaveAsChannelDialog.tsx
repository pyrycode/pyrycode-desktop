import { useEffect, useRef, useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'
import { sessionStore, selectStatusFor } from '../../store/sessionStore'
import { submitSystemPrompt } from '../../store/systemPromptWriteBridge'
import { systemPromptWriteStore } from '../../store/systemPromptWriteStore'
import { titleFor } from './channelListViewModel'

import { Modal } from '../../components/Modal'
import { ChannelForm } from './ChannelForm'
// The byte gate #1428 exported, reused rather than re-implemented: a second counter could only ever
// disagree with the first, and main holds the real authority anyway (`Buffer.byteLength`, before any
// frame is built). This is the one import edge from this dialog to its sibling container, and it is
// deliberate — moving the helper to `ChannelForm`, the module both dialogs already import, is the
// tidier shape but is an adjacent-code refactor with no behaviour change. See the #1429 spec § Design.
import { systemPromptOverLimit } from './CreateChannelDialog'

export function SaveAsChannelDialogView({
  name,
  systemPrompt,
  promptOverLimit,
  onNameChange,
  onSystemPromptChange,
  onCancel,
  onSave
}: {
  name: string
  systemPrompt: string
  promptOverLimit: boolean
  onNameChange: (next: string) => void
  onSystemPromptChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  return (
    <div className="create-channel-overlay">
      <div className="create-channel-overlay__scrim" aria-hidden="true" />
      <Modal title="Save as channel" width={640} onClose={onCancel}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        // The prompt is OPTIONAL, so an empty box never blocks OK; only a value past the bound does.
        confirmAction={{ label: 'OK', onClick: onSave, disabled: name.trim() === '' || promptOverLimit }}>
        <ChannelForm name={name} busy={false} error={null} onNameChange={onNameChange}
          prompt={{ value: systemPrompt, overLimit: promptOverLimit, onChange: onSystemPromptChange }} />
      </Modal>
    </div>
  )
}

/**
 * Fire the `promoteConversation` command (#273 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained, exactly
 * as `requestNewConversation` inlines its command. All three payload fields are REQUIRED strings (the
 * deliberate opposite of create's nullable fields): `conversation_id ← conversationId`, `name ← name.trim()`
 * (a promoted channel should not carry accidental edge whitespace), and `cwd` passed VERBATIM by the caller.
 * Since #1436 there is one caller and one source for that `cwd`: the promoted row's own, exactly as the
 * daemon reported it — never a client-templated string, which promote's server-side EvalSymlinks would
 * reject. It is opaque display/routing text the renderer never resolves. The view disables Save on a blank
 * name, so this is never reached with one. Fire-and-forget: `sendCommand` is `void`.
 */
export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string,
  name: string,
  cwd: string
): void {
  sendCommand({
    type: 'promoteConversation',
    payload: { conversation_id: conversationId, name: name.trim(), cwd }
  })
}

/**
 * The second command of a Save (#1429): one `set_system_prompt` for the chat that was just promoted,
 * through the shipped `submitSystemPrompt` (#1249 built the transport). No new wire type, envelope or
 * IPC arm — the daemon's verb takes an EXISTING `conversation_id`, and here one already exists.
 *
 * THERE IS NO ATTRIBUTION GATE, and that is the substantive difference from the sibling dialog's
 * `writePrompt`. That one had to match an uncorrelated `conversationCreated` with `confirmsPending`,
 * because the id it wrote to came off a daemon reply and a same-host confirmation for someone else's
 * create would otherwise have carried the operator's text onto a conversation they did not create.
 * The id here is `row.id` — a prop this container already holds, never a value a reply supplied — so
 * that hazard does not exist on this path and a gate over it would be theatre. A hostile daemon can
 * refuse this write; it cannot redirect it.
 *
 * A BLANK BOX SENDS NOTHING (AC2), so a prompt the chat already holds is kept rather than cleared —
 * which is what makes opening empty safe. A non-blank draft crosses VERBATIM AND UNTRIMMED: it
 * round-trips to the daemon as a stored value, and normalising it here would silently change what the
 * operator saved. A falsy `row.id` needs no guard of its own; `submitSystemPrompt` already refuses
 * one, sending nothing and recording nothing, so no marker is left for a write that cannot exist.
 *
 * `sendCommand` can throw locally. An escaping exception would abort the caller's `onPromoted()`,
 * stranding this dialog over an ALREADY-PROMOTED chat, and would carry the failed command — prompt
 * included — onto an error path this file does not control. So it is caught. The `catch` is EMPTY BY
 * DESIGN: every field that would make a log useful here (the prompt, the conversation id) is
 * forbidden, and the in-flight marker `submitSystemPrompt` records before sending is swept by the
 * write store's own `reconnected` arm. The outcome lands in `systemPromptWriteStore`, where the
 * channel info sheet's `SystemPromptSection` reports it; this dialog closes on dispatch and never
 * waits for the acknowledgement, so it has no second failure surface.
 */
function writePrompt(conversationId: string, draft: string): void {
  if (draft.trim() === '') return
  try {
    submitSystemPrompt(
      {
        sendCommand: window.pyry.sendCommand,
        dispatch: (event) => systemPromptWriteStore.getState().dispatch(event)
      },
      conversationId,
      draft
    )
  } catch {
    // Deliberately silent — see the docblock.
  }
}

/**
 * The Save-as-channel dialog's interaction container. Owns the controlled `name` state and the
 * abandonment flag, and dispatches the promotion on Save. Exported so ChannelList imports it.
 * `window.pyry` is dereferenced only inside interaction callbacks / the effect, never during render.
 */
export function SaveAsChannelDialog({
  row,
  onDismiss,
  onPromoted
}: {
  row: ConversationSummary & { readonly serverId?: string | null }
  // Cancel: close the dialog only.
  onDismiss: () => void
  // Save: close the dialog.
  onPromoted: () => void
}): JSX.Element {
  // The controlled field, seeded from the row's displayed title on mount — the container mounts fresh each
  // open (ChannelList gates the mount on a non-null row), so a lazy initializer suffices with no re-seed
  // effect (the renameName precedent, moved in-container). Transient UI state → useState, not the store.
  const [name, setName] = useState(() => titleFor(row.name))
  // The prompt draft opens EMPTY on every mount and is deliberately never seeded from
  // `systemPromptStore`: that store is a single slot holding a value only for a chat the operator has
  // actually opened, while a chat can be saved from any row. An empty box sends no write, so a prompt
  // the chat already holds is kept rather than cleared. Transient UI state that dies with the unmount,
  // so Cancel and the header close discard it and a reopen starts empty (AC4) — and since an operator
  // can paste a credential in here, nothing on this path touches localStorage, sessionStorage,
  // IndexedDB or persist.
  const [systemPrompt, setSystemPrompt] = useState('')
  const abandoned = useRef(false)
  const serverId = row.serverId

  // A synchronous session subscription abandons the draft when its host stops being connected. Necessary
  // even with ChannelList's render-time gating: a disconnect and a reconnect batched before React paints
  // would otherwise hide the host loss from a Save already focused by the keyboard.
  useEffect(() => {
    abandoned.current = false
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && (typeof serverId !== 'string' || selectStatusFor(serverId)(state)?.type !== 'connected')) {
        abandoned.current = true
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
      }
    })
    return () => {
      abandoned.current = true
      offStatus()
    }
  }, [serverId])

  const promptOverLimit = systemPromptOverLimit(systemPrompt)

  return (
    <SaveAsChannelDialogView
      name={name}
      systemPrompt={systemPrompt}
      promptOverLimit={promptOverLimit}
      onNameChange={setName}
      onSystemPromptChange={setSystemPrompt}
      onCancel={() => {
        abandoned.current = true
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
        onDismiss()
      }}
      // Promote the existing chat in its own workspace and close on dispatch — there is no round trip
      // to wait on and no correlated rejection. #1436 withdrew the dedicated-folder arm that once
      // stood beside this one. window.pyry is dereferenced only here (interaction time, never render).
      //
      // Since #1429 a second command can follow: promotion goes FIRST, because it is what the operator
      // asked for and the prompt rides along with it, then at most one write against the same `id`.
      // Both leave SYNCHRONOUSLY, with no await between the connectivity guard and either send, so the
      // guard cannot go stale in a gap and there is nothing to cancel. The over-limit arm of the guard
      // is belt-and-suspenders over an already-disabled OK, exactly as the blank-name arm beside it is:
      // a keyboard activation can land before React paints.
      onSave={() => {
        if (abandoned.current || !isHostConnected(serverId) || name.trim() === '' || promptOverLimit) return
        requestPromoteConversation(window.pyry.sendCommand, row.id, name, row.cwd)
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'sent' })
        writePrompt(row.id, systemPrompt)
        onPromoted()
      }}
    />
  )
}

function isHostConnected(serverId: string | null | undefined): boolean {
  return typeof serverId === 'string' &&
    selectStatusFor(serverId)(sessionStore.getState())?.type === 'connected'
}
