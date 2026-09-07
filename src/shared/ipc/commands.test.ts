import { describe, it, expect } from 'vitest'
import {
  COMMAND_CHANNEL,
  isRendererCommand,
  sendMessageCommand,
  answerModalCommand,
  cancelModalCommand,
  answerQuestionsCommand,
  refuseQuestionsCommand,
  dequeueMessageCommand,
  interruptCommand,
  newSessionCommand,
  type RendererCommand,
  type NewSessionCommandPayload,
  type AnswerModalCommandPayload,
  type AnswerQuestionsCommandPayload,
  type RefuseQuestionsCommandPayload,
  type NotifyPayload
} from './commands'
import type {
  SendMessagePayload,
  ModalCancelPayload,
  CreateConversationPayload,
  PromoteConversationPayload,
  ArchiveConversationPayload,
  UnarchiveConversationPayload,
  DeleteConversationPayload,
  RenameConversationPayload,
  ChangeWorkspacePayload,
  CreateWorkspaceFolderPayload,
  SetSessionSettingsPayload,
  DequeueMessagePayload
} from '../wire/types'

describe('command channel', () => {
  it('pins the IPC channel string both process sides depend on', () => {
    // The preload sender ships on this channel and the main receiver listens on it; a drift
    // between the two would silently drop every command. Pin it like the event constant.
    expect(COMMAND_CHANNEL).toBe('pyry:command')
  })
})

describe('sendMessageCommand', () => {
  it('wraps a SendMessagePayload into a sendMessage command, fields unchanged', () => {
    const fields: SendMessagePayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      text: 'hello'
    }

    const command = sendMessageCommand(fields)

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'sendMessage', payload: fields })
    // Narrow off the discriminant now the union also holds the bare requestDebugBundle member.
    if (command.type === 'sendMessage') {
      expect(command.payload).toBe(fields) // verbatim pass-through, no field remap
    }
  })
})

describe('answerModalCommand / cancelModalCommand (#236)', () => {
  it('wraps answer fields into an answerModal command, fields unchanged (no token minted here)', () => {
    const fields: AnswerModalCommandPayload = { modal_id: 'md-1', option_id: 'opt-1' }

    const command = answerModalCommand(fields)

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'answerModal', payload: fields })
    if (command.type === 'answerModal') {
      // Verbatim pass-through: no field remap, and no answer_token — that is minted main-side (#236's
      // daemonConnection.answerModal), never in this pure renderer-side constructor.
      expect(command.payload).toBe(fields)
    }
  })

  it('wraps a modal_id into a cancelModal command, fields unchanged', () => {
    const fields: ModalCancelPayload = { modal_id: 'md-1' }

    const command = cancelModalCommand(fields)

    expect(command).toEqual({ type: 'cancelModal', payload: fields })
    if (command.type === 'cancelModal') {
      expect(command.payload).toBe(fields)
    }
  })

  it('cannot carry an answer_token on the answer command type (AC1: no member carries a token)', () => {
    // Compile-time proof the answer command's fields are Omit-excluded of answer_token — the mint is
    // main-side. The excess-property check fires on the object literal; typecheck (the build gate)
    // enforces it, so this line must stay a compile error.
    // @ts-expect-error answer_token is not assignable to AnswerModalCommandPayload (Omit-excluded).
    answerModalCommand({ modal_id: 'md-1', option_id: 'opt-1', answer_token: 'nope' })
  })
})

describe('answerQuestionsCommand / refuseQuestionsCommand (#920)', () => {
  it('wraps batch id + ordered entries into an answerQuestions command, fields unchanged (no token minted here)', () => {
    const fields: AnswerQuestionsCommandPayload = {
      question_batch_id: 'qb-1',
      answers: [
        { question_index: 0, values: ['yes'] },
        { question_index: 1, values: ['a', 'b'] }
      ]
    }

    const command = answerQuestionsCommand(fields)

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'answerQuestions', payload: fields })
    if (command.type === 'answerQuestions') {
      // Verbatim pass-through: no field remap, and no answer_token — that is minted main-side
      // (daemonConnection.answerQuestions), never in this pure renderer-side constructor.
      expect(command.payload).toBe(fields)
    }
  })

  it('wraps a batch id alone into a refuseQuestions command, fields unchanged (no token minted here)', () => {
    const fields: RefuseQuestionsCommandPayload = { question_batch_id: 'qb-1' }

    const command = refuseQuestionsCommand(fields)

    expect(command).toEqual({ type: 'refuseQuestions', payload: fields })
    if (command.type === 'refuseQuestions') {
      // The refusal frame carries answer_token too (unlike modal_cancel, which carries modal_id
      // alone) — so this payload type Omit-excludes it exactly as the answer's does.
      expect(command.payload).toBe(fields)
    }
  })

  it('cannot carry an answer_token on either question command type (AC1: neither payload can express one)', () => {
    // Compile-time proof both payload types are Omit-excluded of answer_token — BOTH frames carry a
    // token on the wire, so both mints are main-side. The excess-property check fires on the object
    // literal; typecheck (the build gate) enforces it, so these lines must stay compile errors.
    // @ts-expect-error answer_token is not assignable to AnswerQuestionsCommandPayload (Omit-excluded).
    answerQuestionsCommand({ question_batch_id: 'qb-1', answers: [], answer_token: 'nope' })
    // @ts-expect-error answer_token is not assignable to RefuseQuestionsCommandPayload (Omit-excluded).
    refuseQuestionsCommand({ question_batch_id: 'qb-1', answer_token: 'nope' })
  })
})

describe('dequeueMessageCommand (#300)', () => {
  it('wraps a DequeueMessagePayload into a dequeueMessage command, fields unchanged (ungated, no token)', () => {
    const fields: DequeueMessagePayload = { conversation_id: 'c1', queued_msg_id: 7 }

    const command = dequeueMessageCommand(fields)

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'dequeueMessage', payload: fields })
    if (command.type === 'dequeueMessage') {
      // Verbatim pass-through: no field remap, and no token — dropping a queued message is ungated
      // (#720), so the payload reuses the wire type directly (unlike answerModal's Omit-derivative).
      expect(command.payload).toBe(fields)
    }
  })
})

describe('interruptCommand (#306, named by #1092)', () => {
  it('constructs an interrupt command naming exactly the conversation whose turn to stop', () => {
    const command = interruptCommand({ conversation_id: 'c-1' })

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'interrupt', payload: { conversation_id: 'c-1' } })
    if (command.type === 'interrupt') {
      // ONE field and nothing else — no token, key or raw-frame field, and no `serverId`: the
      // conversation id already selects the connection, so a second address could disagree with it.
      expect(Object.keys(command.payload)).toEqual(['conversation_id'])
      expect(command).not.toHaveProperty('serverId')
    }
  })

  it('cannot be constructed naming nothing — the bare form is a compile error, not a runtime case', () => {
    // `InterruptCommandPayload` is `Required<InterruptPayload>`, so `interruptCommand()` and
    // `interruptCommand({})` do not type-check. That is what makes AC4's "unreachable by construction
    // rather than by discipline" true; there is no runtime assertion that could prove it, so this test
    // exists to hold the @ts-expect-error, which reddens the moment the payload goes optional again.
    // @ts-expect-error — the empty payload is exactly the form this ticket makes unreachable.
    expect(() => interruptCommand({})).not.toThrow()
  })
})

describe('isRendererCommand', () => {
  it('accepts a well-formed send-message command, including one from the constructor', () => {
    const command: RendererCommand = sendMessageCommand({
      conversation_id: 'c1',
      message_id: 'm1',
      text: 'hi'
    })

    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts a command carrying an extra harmless field (structural minimum)', () => {
    const command = {
      type: 'sendMessage',
      payload: { conversation_id: 'c1', message_id: 'm1', text: 'hi' },
      extra: 'ignored'
    }

    expect(isRendererCommand(command)).toBe(true)
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isRendererCommand(null)).toBe(false)
    expect(isRendererCommand(undefined)).toBe(false)
    expect(isRendererCommand('sendMessage')).toBe(false)
    expect(isRendererCommand(42)).toBe(false)
  })

  it('rejects a missing, empty, or unknown type', () => {
    const payload = { conversation_id: 'c1', message_id: 'm1', text: 'hi' }
    expect(isRendererCommand({ payload })).toBe(false)
    expect(isRendererCommand({ type: '', payload })).toBe(false)
    expect(isRendererCommand({ type: 'connect', payload })).toBe(false)
    // The screen-snapshot verb retired in #620 is now just another unknown type: the shape below was
    // structurally VALID before that removal and now falls through the switch to default-deny, so a
    // stale renderer bundle or a replayed message is dropped at the boundary rather than dispatched.
    expect(isRendererCommand({ type: 'requestSnapshot', payload: { conversation_id: 'c1' } })).toBe(
      false
    )
  })

  it('rejects a send-message command with no payload', () => {
    expect(isRendererCommand({ type: 'sendMessage' })).toBe(false)
    expect(isRendererCommand({ type: 'sendMessage', payload: null })).toBe(false)
  })

  it('rejects a payload whose fields are missing or non-string', () => {
    const t = 'sendMessage'
    expect(isRendererCommand({ type: t, payload: { message_id: 'm1', text: 'hi' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', text: 'hi' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', message_id: 'm1' } })).toBe(
      false
    )
    expect(
      isRendererCommand({ type: t, payload: { conversation_id: 1, message_id: 'm1', text: 'hi' } })
    ).toBe(false)
  })

  // #1055 — the attachment_ids arm. A message naming files is the ordinary case now, and the key's
  // three legal shapes on this side are: absent, present-and-undefined, and an array of non-empty
  // strings. The middle one is not a curiosity: `submitMessage` assigns the field unconditionally (the
  // `createdAt` idiom, so JSON.stringify drops it on the wire) and structured clone PRESERVES an own
  // property whose value is `undefined`, so every ordinary send arrives here with the key present.
  it('#1055: accepts the three legal attachment_ids shapes', () => {
    const t = 'sendMessage'
    const base = { conversation_id: 'c1', message_id: 'm1', text: 'hi' }
    expect(isRendererCommand({ type: t, payload: base })).toBe(true)
    expect(isRendererCommand({ type: t, payload: { ...base, attachment_ids: undefined } })).toBe(true)
    expect(isRendererCommand({ type: t, payload: { ...base, attachment_ids: [] } })).toBe(true)
    expect(
      isRendererCommand({ type: t, payload: { ...base, attachment_ids: ['a', 'b'] } })
    ).toBe(true)
  })

  // A type-lie inside a declared string[] would otherwise reach the builder's bare JSON.stringify and
  // put a `null`/number on the wire, which the daemon refuses as protocol.malformed — taking the whole
  // message with it. The empty string is refused for isAttachmentRetrievalRequest's recorded reason:
  // joined onto a directory it names that directory, so this side declines to originate it.
  it('#1055: rejects a non-array, a non-string element, and the empty string', () => {
    const t = 'sendMessage'
    const base = { conversation_id: 'c1', message_id: 'm1', text: 'hi' }
    expect(isRendererCommand({ type: t, payload: { ...base, attachment_ids: 'a' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { ...base, attachment_ids: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { ...base, attachment_ids: [1] } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { ...base, attachment_ids: ['a', ''] } })).toBe(false)
  })

  // ⭐ THE `for…of`-NOT-`every` PROOF, isAnswerQuestionsPayload's lesson on this file's second array
  // field: `every` SKIPS holes, so a sparse array would pass it while JSON.stringify emits `null` for
  // the hole. Sparse arrays survive structured clone, so this shape is reachable over IPC.
  it('#1055: rejects a SPARSE attachment_ids array', () => {
    const sparse = ['a', 'b']
    delete sparse[1]
    expect(
      isRendererCommand({
        type: 'sendMessage',
        payload: { conversation_id: 'c1', message_id: 'm1', text: 'hi', attachment_ids: sparse }
      })
    ).toBe(false)
  })

  it('accepts the bare requestDebugBundle command (no payload — bundle is daemon-global)', () => {
    // The debug-bundle request carries nothing to parameterise, so its guard case is a bare
    // `return true`. A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(isRendererCommand({ type: 'requestDebugBundle' })).toBe(true)
    expect(isRendererCommand({ type: 'requestDebugBundle', extra: 'ignored' })).toBe(true)
  })

  it('types the bare requestDebugBundle member as part of the union', () => {
    // Compile-time proof the bare member is in RendererCommand, hence reachable through the
    // existing generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = { type: 'requestDebugBundle' }
    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts the bare requestConversations command (no payload — the request carries nothing) (#139)', () => {
    // The list request carries nothing to parameterise, so its guard case is a bare `return true`.
    // A structurally-extra field is harmless (structural minimum), like requestDebugBundle.
    expect(isRendererCommand({ type: 'requestConversations' })).toBe(true)
    expect(isRendererCommand({ type: 'requestConversations', extra: 'ignored' })).toBe(true)
  })

  it('types the bare requestConversations member as part of the union (#139)', () => {
    // Compile-time proof the bare member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = { type: 'requestConversations' }
    expect(isRendererCommand(command)).toBe(true)
  })

  it('rejects requestSessionSettings with no payload, or an explicitly undefined one (#946)', () => {
    // #945 accepted both as the "names no conversation" shape the renderer still sent; #946 supplies
    // a real id, so an unnamed request is now a caller bug rather than the ordinary case. The
    // explicitly-undefined arm is rejected BY VALUE, not by `'payload' in value`: structured clone
    // PRESERVES an explicitly-undefined property across the IPC bridge, so the `in` check alone would
    // pass it straight through — isRequestSessionSettingsPayload is what refuses it.
    expect(isRendererCommand({ type: 'requestSessionSettings' })).toBe(false)
    expect(isRendererCommand({ type: 'requestSessionSettings', payload: undefined })).toBe(false)
    expect(isRendererCommand({ type: 'requestSessionSettings', extra: 'ignored' })).toBe(false)
  })

  it('accepts a requestSessionSettings naming a conversation, checking type not emptiness (#945)', () => {
    // '' passes: the daemon polices ids, and it answers an unresolvable one with a zero-valued
    // session_settings rather than an error frame. A structurally-extra field is harmless. This guard
    // stays type-only after #946 — the renderer-side decision NOT to send an unaddressable id lives
    // in requestRunConfigSnapshot, which is a behavioural gate, not a structural one.
    expect(
      isRendererCommand({ type: 'requestSessionSettings', payload: { conversation_id: 'conv-1' } })
    ).toBe(true)
    expect(
      isRendererCommand({ type: 'requestSessionSettings', payload: { conversation_id: '' } })
    ).toBe(true)
    expect(
      isRendererCommand({
        type: 'requestSessionSettings',
        payload: { conversation_id: 'conv-1', extra: 'ignored' }
      })
    ).toBe(true)
  })

  it('rejects a requestSessionSettings whose payload is present but not a conversation id (#945)', () => {
    // A present payload must be a well-formed one — a non-string id, a missing key, and a literal
    // null are all type lies that would otherwise reach encodeEnvelope's bare JSON.stringify.
    expect(
      isRendererCommand({ type: 'requestSessionSettings', payload: { conversation_id: 42 } })
    ).toBe(false)
    expect(isRendererCommand({ type: 'requestSessionSettings', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'requestSessionSettings', payload: null })).toBe(false)
  })

  it('types requestSessionSettings as payload-REQUIRED — a bare send no longer compiles (#946)', () => {
    // Compile-time half of AC3, and the half the runtime guard above cannot prove: `src/shared/**/*`
    // is inside tsconfig.node.json's include, so `npm run typecheck` reads this file, and an unused
    // expect-error directive is itself a TS2578 — relax the payload back to optional and this fails.
    // (Do not open a prose line with the directive's own name: a comment whose first token is
    // `@ts-expect-error` IS a directive, wherever it sits, and it will suppress the next line.)
    // @ts-expect-error payload is required since #946 — a request must name a conversation
    const bare: RendererCommand = { type: 'requestSessionSettings' }
    const named: RendererCommand = {
      type: 'requestSessionSettings',
      payload: { conversation_id: 'conv-1' }
    }
    expect(isRendererCommand(bare)).toBe(false)
    expect(isRendererCommand(named)).toBe(true)
  })

  it('accepts a requestModelList naming a conversation, checking type not emptiness (#1165)', () => {
    // The requestSessionSettings arm's shape with the verb changed. '' passes THIS layer for the
    // sibling's reason — the guard checks type, not emptiness — but the two diverge one layer down:
    // an unresolvable id here draws an `error` frame (`conversation.not_found`), not a zero-valued
    // reply, because there is no zero answer to "what models does nothing offer". A structurally
    // extra field is harmless; the builder's fresh literal is what bounds the wire.
    expect(
      isRendererCommand({ type: 'requestModelList', payload: { conversation_id: 'conv-1' } })
    ).toBe(true)
    expect(isRendererCommand({ type: 'requestModelList', payload: { conversation_id: '' } })).toBe(
      true
    )
    expect(
      isRendererCommand({
        type: 'requestModelList',
        payload: { conversation_id: 'conv-1', extra: 'ignored' }
      })
    ).toBe(true)
  })

  it('rejects requestModelList with no payload, or an explicitly undefined one (#1165)', () => {
    // The explicitly-undefined arm is rejected BY VALUE, not by `'payload' in value`: structured
    // clone PRESERVES an explicitly-undefined property across the IPC bridge, so the `in` check alone
    // would pass it straight through — isRequestModelListPayload is what refuses it.
    expect(isRendererCommand({ type: 'requestModelList' })).toBe(false)
    expect(isRendererCommand({ type: 'requestModelList', payload: undefined })).toBe(false)
    expect(isRendererCommand({ type: 'requestModelList', extra: 'ignored' })).toBe(false)
  })

  it('rejects a requestModelList whose payload is present but not a conversation id (#1165)', () => {
    // A present payload must be a well-formed one — a non-string id, a missing key, and a literal
    // null are all type lies that would otherwise reach encodeEnvelope's bare JSON.stringify.
    expect(isRendererCommand({ type: 'requestModelList', payload: { conversation_id: 42 } })).toBe(
      false
    )
    expect(isRendererCommand({ type: 'requestModelList', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'requestModelList', payload: null })).toBe(false)
  })

  it('types requestModelList as payload-REQUIRED — a bare send does not compile (#1165)', () => {
    // Compile-time half of AC2, and the half the runtime guard above cannot prove: `src/shared/**/*`
    // is inside tsconfig.node.json's include, so `npm run typecheck` reads this file, and an unused
    // expect-error directive is itself a TS2578 — relax the payload to optional and this fails.
    // (Do not open a prose line with the directive's own name: a comment whose first token is
    // `@ts-expect-error` IS a directive, wherever it sits, and it will suppress the next line.)
    // @ts-expect-error payload is required — a request with no conversation has nothing to ask about
    const bare: RendererCommand = { type: 'requestModelList' }
    const named: RendererCommand = {
      type: 'requestModelList',
      payload: { conversation_id: 'conv-1' }
    }
    expect(isRendererCommand(bare)).toBe(false)
    expect(isRendererCommand(named)).toBe(true)
  })

  it('accepts a newSession naming a conversation (#1217)', () => {
    // The requestModelList arm's shape with the verb changed — except for emptiness, below.
    expect(isRendererCommand({ type: 'newSession', payload: { conversation_id: 'conv-1' } })).toBe(
      true
    )
    // A structurally extra field is harmless; buildNewSession's fresh literal is what bounds the wire.
    expect(
      isRendererCommand({
        type: 'newSession',
        payload: { conversation_id: 'conv-1', extra: 'ignored' }
      })
    ).toBe(true)
  })

  it('rejects a newSession naming the empty conversation — the one guard that checks EMPTINESS (#1217)', () => {
    // THE SECURITY-RELEVANT LINE OF THE SLICE, and the one place this guard diverges from every
    // sibling above. They check type and not emptiness deliberately, because for them `''` is merely
    // an id the daemon cannot resolve — an `error` frame or a zero-valued reply, harmless either way.
    //
    // On `new_session` it is not an unresolvable id, it is THE BARE FORM: the protocol makes no
    // payload, `{}`, an absent id and an explicitly empty one one wire meaning — restart whatever the
    // daemon's process-wide follow-active cursor points at, which only a routed send_message stamps
    // and which every connection shares. So a renderer that read an id from a not-yet-loaded slice
    // and sent `''` would kill a DIFFERENT conversation's claude, mid-work. That is exactly the
    // cross-conversation misfire pyrycode#2099 exists to close.
    //
    // Deleting the `.length > 0` clause reddens this line and nothing else in the repo. Do not
    // "align" it with the siblings.
    expect(isRendererCommand({ type: 'newSession', payload: { conversation_id: '' } })).toBe(false)
  })

  it('rejects newSession with no payload, or an explicitly undefined one (#1217)', () => {
    // The explicitly-undefined arm is rejected BY VALUE, not by `'payload' in value`: structured
    // clone PRESERVES an explicitly-undefined property across the IPC bridge, so the `in` check alone
    // would pass it straight through — isNewSessionPayload is what refuses it.
    expect(isRendererCommand({ type: 'newSession' })).toBe(false)
    expect(isRendererCommand({ type: 'newSession', payload: undefined })).toBe(false)
    expect(isRendererCommand({ type: 'newSession', extra: 'ignored' })).toBe(false)
  })

  it('rejects a newSession whose payload is present but not a conversation id (#1217)', () => {
    // A present payload must be a well-formed one — a non-string id, a missing key, and a literal
    // null are all type lies that would otherwise reach encodeEnvelope's bare JSON.stringify. A
    // missing key is refused here for a STRONGER reason than in the siblings: absent is the bare form.
    expect(isRendererCommand({ type: 'newSession', payload: { conversation_id: 42 } })).toBe(false)
    expect(isRendererCommand({ type: 'newSession', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'newSession', payload: null })).toBe(false)
  })

  it('types newSession as payload-REQUIRED with a REQUIRED id — neither bare form compiles (#1217)', () => {
    // Compile-time half of AC3, and the half the runtime guard cannot prove. Two directives, because
    // there are two ways to reach the bare wire form and the command type must refuse both: no
    // payload at all, and a payload whose id is absent. The second is what makes
    // NewSessionCommandPayload a `Required` derivative rather than the wire type reused verbatim —
    // relax it back to `NewSessionPayload` and the second directive becomes an unused TS2578.
    // (Do not open a prose line with the directive's own name: a comment whose first token is
    // `@ts-expect-error` IS a directive, wherever it sits, and it will suppress the next line.)
    // @ts-expect-error payload is required — a restart with no conversation named is the bare form
    const bare: RendererCommand = { type: 'newSession' }
    // @ts-expect-error conversation_id is required on the COMMAND payload, optional only on the wire
    const unnamed: RendererCommand = { type: 'newSession', payload: {} }
    const named: RendererCommand = { type: 'newSession', payload: { conversation_id: 'conv-1' } }

    expect(isRendererCommand(bare)).toBe(false)
    expect(isRendererCommand(unnamed)).toBe(false)
    expect(isRendererCommand(named)).toBe(true)
  })

  it('newSessionCommand wraps a conversation id into a well-formed member (#1217)', () => {
    const fields: NewSessionCommandPayload = { conversation_id: 'conv-1' }

    expect(newSessionCommand(fields)).toEqual({ type: 'newSession', payload: fields })
    expect(isRendererCommand(newSessionCommand(fields))).toBe(true)
  })

  it('accepts the bare requestRecentWorkspaces command (no payload — the request carries nothing) (#380)', () => {
    // The recent-workspaces request carries nothing to parameterise, so its guard case is a bare
    // `return true`. A structurally-extra field is harmless (structural minimum), like requestConversations.
    expect(isRendererCommand({ type: 'requestRecentWorkspaces' })).toBe(true)
    expect(isRendererCommand({ type: 'requestRecentWorkspaces', extra: 'ignored' })).toBe(true)
  })

  it('types the bare requestRecentWorkspaces member as part of the union (#380)', () => {
    // Compile-time proof the bare member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = { type: 'requestRecentWorkspaces' }
    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts an interrupt command naming a conversation (#1092)', () => {
    expect(isRendererCommand({ type: 'interrupt', payload: { conversation_id: 'c-1' } })).toBe(true)
    // Structural minimum, like every sibling: an extra field is not rejected here, and cannot reach
    // the wire because `buildInterrupt` rebuilds a fresh literal bounded to the one id.
    expect(
      isRendererCommand({ type: 'interrupt', payload: { conversation_id: 'c-1' }, extra: 'ignored' })
    ).toBe(true)
  })

  it('refuses an interrupt command that names no conversation (#1092)', () => {
    // The BARE form the frame carried until pyrycode#2103 is now a boundary rejection, and the
    // refusal is the point rather than strictness for its own sake: on this verb an absent or empty
    // id is not an unresolvable id, it is the daemon's process-wide follow-active cursor — some other
    // conversation's turn stopped mid-work. A refused command is dropped in silence, so the failure
    // mode is Stop doing nothing rather than Stop hitting the wrong chat.
    expect(isRendererCommand({ type: 'interrupt' })).toBe(false)
    expect(isRendererCommand({ type: 'interrupt', payload: {} })).toBe(false)
    // Explicitly-undefined is refused BY isInterruptPayload rather than by the `in` check: structured
    // clone PRESERVES an own property holding `undefined` across the IPC bridge, so `'payload' in
    // value` alone would pass one straight through to the wire.
    expect(isRendererCommand({ type: 'interrupt', payload: undefined })).toBe(false)
    expect(isRendererCommand({ type: 'interrupt', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'interrupt', payload: { conversation_id: '' } })).toBe(false)
    for (const conversation_id of [42, null, {}, ['c-1'], true, undefined]) {
      expect(isRendererCommand({ type: 'interrupt', payload: { conversation_id } })).toBe(false)
    }
  })

  it('types the named interrupt member as part of the union (#1092)', () => {
    // Compile-time proof the member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = interruptCommand({ conversation_id: 'c-1' })
    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts a well-formed answerModal command carrying string modal_id + option_id (#236)', () => {
    const command: RendererCommand = answerModalCommand({ modal_id: 'md-1', option_id: 'opt-1' })
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(
      isRendererCommand({
        type: 'answerModal',
        payload: { modal_id: 'md-1', option_id: 'opt-1' },
        extra: 1
      })
    ).toBe(true)
  })

  it('accepts an answerModal payload carrying an extra answer_token (mint is main-side, not rejected here) (#236)', () => {
    // The command TYPE structurally excludes answer_token (Omit), but the runtime guard is a
    // structural minimum: a smuggled answer_token still guards true. It is the main-side sender's
    // fresh-literal construction — not this boundary guard — that ignores a renderer-supplied token
    // (proven in daemonConnection.test.ts). This pins that the guard does not reject the field.
    expect(
      isRendererCommand({
        type: 'answerModal',
        payload: { modal_id: 'md-1', option_id: 'opt-1', answer_token: 'smuggled' }
      })
    ).toBe(true)
  })

  it('rejects an answerModal with a missing payload or a missing/non-string modal_id or option_id (#236)', () => {
    expect(isRendererCommand({ type: 'answerModal' })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: { modal_id: 'md-1' } })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: { option_id: 'opt-1' } })).toBe(false)
    expect(
      isRendererCommand({ type: 'answerModal', payload: { modal_id: 42, option_id: 'opt-1' } })
    ).toBe(false)
    expect(
      isRendererCommand({ type: 'answerModal', payload: { modal_id: 'md-1', option_id: 42 } })
    ).toBe(false)
  })

  it('accepts a well-formed cancelModal command carrying a string modal_id (#236)', () => {
    const command: RendererCommand = cancelModalCommand({ modal_id: 'md-1' })
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(isRendererCommand({ type: 'cancelModal', payload: { modal_id: 'md-1' }, extra: 1 })).toBe(
      true
    )
  })

  it('rejects a cancelModal with a missing payload or a missing/non-string modal_id (#236)', () => {
    expect(isRendererCommand({ type: 'cancelModal' })).toBe(false)
    expect(isRendererCommand({ type: 'cancelModal', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'cancelModal', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'cancelModal', payload: { modal_id: 42 } })).toBe(false)
  })

  it('accepts a well-formed createConversation command with all-null fields (daemon defaults) (#241)', () => {
    // The guard checks the TYPE, so a literal null is an accepted value ("let the daemon choose"),
    // while a missing/undefined key is rejected. No constructor exists (the unarchiveConversation precedent):
    // #242 builds the literal inline, so this is proven through an inline literal typed as the union.
    const allNull: CreateConversationPayload = { is_promoted: null, name: null, cwd: null }
    const command: RendererCommand = { type: 'createConversation', payload: allNull }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(isRendererCommand({ type: 'createConversation', payload: allNull, extra: 1 })).toBe(true)
  })

  it('accepts a fully-populated createConversation command (#241)', () => {
    const populated: CreateConversationPayload = {
      is_promoted: true,
      name: 'design review',
      cwd: '/home/user/project'
    }
    expect(isRendererCommand({ type: 'createConversation', payload: populated })).toBe(true)
  })

  it('rejects a createConversation with a missing/null payload (#241)', () => {
    expect(isRendererCommand({ type: 'createConversation' })).toBe(false)
    expect(isRendererCommand({ type: 'createConversation', payload: null })).toBe(false)
  })

  it('rejects a createConversation whose fields are wrong-typed or a key is missing (#241)', () => {
    const t = 'createConversation'
    // Each field must be its type OR null — a wrong non-null type is rejected.
    expect(isRendererCommand({ type: t, payload: { is_promoted: 'yes', name: null, cwd: null } })).toBe(
      false
    )
    expect(isRendererCommand({ type: t, payload: { is_promoted: null, name: 3, cwd: null } })).toBe(
      false
    )
    expect(isRendererCommand({ type: t, payload: { is_promoted: null, name: null, cwd: 42 } })).toBe(
      false
    )
    // A missing key (undefined, not a literal null) is rejected — null is present, undefined is absent.
    expect(isRendererCommand({ type: t, payload: { is_promoted: null, name: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { name: null, cwd: null } })).toBe(false)
  })

  it('accepts a well-formed promoteConversation command with all three string fields (#273)', () => {
    // The deliberate OPPOSITE of createConversation: all three fields are REQUIRED strings (a promoted
    // conversation must carry a name + cwd, and the id must resolve). No constructor exists (the
    // createConversation precedent): #274 builds the literal inline, proven here through an inline literal.
    const payload: PromoteConversationPayload = { conversation_id: 'c1', name: 'weekly', cwd: '/w' }
    const command: RendererCommand = { type: 'promoteConversation', payload }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum); the main-side fresh literal drops it.
    expect(isRendererCommand({ type: 'promoteConversation', payload, extra: 1 })).toBe(true)
  })

  it('rejects a promoteConversation with a missing/null payload (#273)', () => {
    expect(isRendererCommand({ type: 'promoteConversation' })).toBe(false)
    expect(isRendererCommand({ type: 'promoteConversation', payload: null })).toBe(false)
  })

  it('rejects a promoteConversation whose fields are wrong-typed, a literal null, or missing (#273)', () => {
    const t = 'promoteConversation'
    // Unlike the create guard, a literal null is REJECTED — every field must be present-and-string.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', name: 3, cwd: '/w' } })).toBe(
      false
    )
    expect(
      isRendererCommand({ type: t, payload: { conversation_id: 'c1', name: 'weekly', cwd: null } })
    ).toBe(false)
    expect(
      isRendererCommand({ type: t, payload: { conversation_id: null, name: 'weekly', cwd: '/w' } })
    ).toBe(false)
    // A missing key is rejected.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', name: 'weekly' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { name: 'weekly', cwd: '/w' } })).toBe(false)
  })

  it('accepts a well-formed unarchiveConversation command with a conversation_id string (#346)', () => {
    // A single required-string field, no constructor (the renderer in #348 builds the literal inline).
    // A structurally-extra field is harmless (structural minimum); the main-side fresh literal drops it.
    const payload: UnarchiveConversationPayload = { conversation_id: 'c1' }
    const command: RendererCommand = { type: 'unarchiveConversation', payload }
    expect(isRendererCommand(command)).toBe(true)
    expect(isRendererCommand({ type: 'unarchiveConversation', payload, extra: 1 })).toBe(true)
  })

  it('rejects an unarchiveConversation with a missing/null payload (#346)', () => {
    expect(isRendererCommand({ type: 'unarchiveConversation' })).toBe(false)
    expect(isRendererCommand({ type: 'unarchiveConversation', payload: null })).toBe(false)
  })

  it('rejects an unarchiveConversation whose conversation_id is missing, null, or non-string (#346)', () => {
    const t = 'unarchiveConversation'
    expect(isRendererCommand({ type: t, payload: {} })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 3 } })).toBe(false)
  })

  it('accepts a well-formed archiveConversation command with a conversation_id string (#363)', () => {
    // The mirror-image twin of unarchiveConversation: a single required-string field, no constructor
    // (the renderer in #366 builds the literal inline). A structurally-extra field is harmless (structural
    // minimum); the main-side fresh literal drops it.
    const payload: ArchiveConversationPayload = { conversation_id: 'c1' }
    const command: RendererCommand = { type: 'archiveConversation', payload }
    expect(isRendererCommand(command)).toBe(true)
    expect(isRendererCommand({ type: 'archiveConversation', payload, extra: 1 })).toBe(true)
  })

  it('rejects an archiveConversation with a missing/null payload (#363)', () => {
    expect(isRendererCommand({ type: 'archiveConversation' })).toBe(false)
    expect(isRendererCommand({ type: 'archiveConversation', payload: null })).toBe(false)
  })

  it('rejects an archiveConversation whose conversation_id is missing, null, or non-string (#363)', () => {
    const t = 'archiveConversation'
    expect(isRendererCommand({ type: t, payload: {} })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 3 } })).toBe(false)
  })

  it('accepts a well-formed deleteConversation command with a conversation_id string (#364)', () => {
    // The permanent-delete sibling of unarchive/archive: a single required-string field, no constructor
    // (the renderer in #367 builds the literal inline). A structurally-extra field is harmless (structural
    // minimum); the main-side fresh literal drops it. Delete is the PERMANENT verb, but the transport guard
    // is identical to unarchive's — the destructive gate is #367's user-facing confirmation, not a second
    // factor here.
    const payload: DeleteConversationPayload = { conversation_id: 'c1' }
    const command: RendererCommand = { type: 'deleteConversation', payload }
    expect(isRendererCommand(command)).toBe(true)
    expect(isRendererCommand({ type: 'deleteConversation', payload, extra: 1 })).toBe(true)
  })

  it('accepts a deleteConversation with an empty-string conversation_id — the guard checks type, not emptiness (#364)', () => {
    // An empty conversation_id is a valid wire string (the daemon polices ids); pin that the guard checks
    // the TYPE of the field, not its emptiness, so it does not over-reject.
    const payload: DeleteConversationPayload = { conversation_id: '' }
    expect(isRendererCommand({ type: 'deleteConversation', payload })).toBe(true)
  })

  it('rejects a deleteConversation with a missing/null payload (#364)', () => {
    expect(isRendererCommand({ type: 'deleteConversation' })).toBe(false)
    expect(isRendererCommand({ type: 'deleteConversation', payload: null })).toBe(false)
  })

  it('rejects a deleteConversation whose conversation_id is missing, null, or non-string (#364)', () => {
    const t = 'deleteConversation'
    expect(isRendererCommand({ type: t, payload: {} })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 3 } })).toBe(false)
  })

  it('accepts a well-formed renameConversation command with both string fields (#359)', () => {
    // Clones the promote guard minus cwd: both fields are REQUIRED strings (a literal null, a missing
    // key, and a non-string are all rejected). No constructor exists; #360 builds the literal inline.
    const payload: RenameConversationPayload = { conversation_id: 'c1', name: 'weekly' }
    const command: RendererCommand = { type: 'renameConversation', payload }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum); the main-side fresh literal drops it.
    expect(isRendererCommand({ type: 'renameConversation', payload, extra: 1 })).toBe(true)
  })

  it('accepts a renameConversation with an empty-string name — the guard checks type, not emptiness (#359)', () => {
    // An empty/whitespace name is a valid wire string (the daemon's own trim-guard leaves the stored name
    // untouched; #360 disables Save on blank). Pin that the guard does not over-reject.
    const payload: RenameConversationPayload = { conversation_id: 'c1', name: '' }
    expect(isRendererCommand({ type: 'renameConversation', payload })).toBe(true)
  })

  it('rejects a renameConversation with a missing/null payload (#359)', () => {
    expect(isRendererCommand({ type: 'renameConversation' })).toBe(false)
    expect(isRendererCommand({ type: 'renameConversation', payload: null })).toBe(false)
  })

  it('rejects a renameConversation whose fields are wrong-typed, a literal null, or missing (#359)', () => {
    const t = 'renameConversation'
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', name: 3 } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', name: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: null, name: 'weekly' } })).toBe(false)
    // A missing key is rejected.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { name: 'weekly' } })).toBe(false)
  })

  it('accepts a well-formed changeWorkspace command with both string fields (#379)', () => {
    // Clones the rename guard with the second field renamed name → cwd: both fields are REQUIRED strings
    // (a literal null, a missing key, and a non-string are all rejected). No constructor exists; the
    // Workspace Picker (#157's UI slice) builds the literal inline.
    const payload: ChangeWorkspacePayload = { conversation_id: 'c1', cwd: '/home/user/project' }
    const command: RendererCommand = { type: 'changeWorkspace', payload }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum); the main-side fresh literal drops it.
    expect(isRendererCommand({ type: 'changeWorkspace', payload, extra: 1 })).toBe(true)
  })

  it('accepts a changeWorkspace with an empty-string cwd — the guard checks type, not emptiness (#379)', () => {
    // An empty cwd is a valid wire string; the daemon polices the path server-side (#823). Pin that the
    // guard does not over-reject.
    const payload: ChangeWorkspacePayload = { conversation_id: 'c1', cwd: '' }
    expect(isRendererCommand({ type: 'changeWorkspace', payload })).toBe(true)
  })

  it('rejects a changeWorkspace with a missing/null payload (#379)', () => {
    expect(isRendererCommand({ type: 'changeWorkspace' })).toBe(false)
    expect(isRendererCommand({ type: 'changeWorkspace', payload: null })).toBe(false)
  })

  it('rejects a changeWorkspace whose fields are wrong-typed, a literal null, or missing (#379)', () => {
    const t = 'changeWorkspace'
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', cwd: 3 } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', cwd: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: null, cwd: '/p' } })).toBe(false)
    // A missing key is rejected.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { cwd: '/p' } })).toBe(false)
  })

  it('accepts a well-formed createWorkspaceFolder command with both string fields (#381)', () => {
    // Clones the changeWorkspace guard with both fields rekeyed to parent / name: both are REQUIRED
    // strings (a literal null, a missing key, and a non-string are all rejected). No constructor exists;
    // the Create-folder dialog (#157's UI slice) builds the literal inline.
    const payload: CreateWorkspaceFolderPayload = { parent: '/home/user/projects', name: 'new-app' }
    const command: RendererCommand = { type: 'createWorkspaceFolder', payload }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum); the main-side fresh literal drops it.
    expect(isRendererCommand({ type: 'createWorkspaceFolder', payload, extra: 1 })).toBe(true)
  })

  it('accepts a createWorkspaceFolder with empty-string fields — the guard checks type, not emptiness (#381)', () => {
    // An empty parent / bad name is a valid wire string; the daemon polices both server-side ($HOME
    // confinement + a single-clean-element name guard, #887). Pin that the guard does not over-reject.
    const payload: CreateWorkspaceFolderPayload = { parent: '', name: '' }
    expect(isRendererCommand({ type: 'createWorkspaceFolder', payload })).toBe(true)
  })

  it('rejects a createWorkspaceFolder with a missing/null payload (#381)', () => {
    expect(isRendererCommand({ type: 'createWorkspaceFolder' })).toBe(false)
    expect(isRendererCommand({ type: 'createWorkspaceFolder', payload: null })).toBe(false)
  })

  it('rejects a createWorkspaceFolder whose fields are wrong-typed, a literal null, or missing (#381)', () => {
    const t = 'createWorkspaceFolder'
    expect(isRendererCommand({ type: t, payload: { parent: '/p', name: 3 } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { parent: '/p', name: null } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { parent: null, name: 'x' } })).toBe(false)
    // A missing key is rejected.
    expect(isRendererCommand({ type: t, payload: { parent: '/p' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { name: 'x' } })).toBe(false)
  })

  it('accepts a setSessionSettings command with only session_id (all optionals omitted) (#263)', () => {
    // The guard is a structural minimum on optional-ABSENT fields: session_id present-and-string, each
    // optional accepted when absent. A missing/undefined optional is fine ("leave unchanged"). The
    // renderer-minted `changeId` (#261) is a required top-level sibling of `payload`.
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a' }
    const command: RendererCommand = { type: 'setSessionSettings', payload, changeId: 'change-1' }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum); the builder's fresh literal drops it.
    expect(isRendererCommand({ type: 'setSessionSettings', payload, changeId: 'change-1', extra: 1 })).toBe(
      true
    )
  })

  it('accepts present zero-value optionals — model:"" and yolo:false (#263)', () => {
    // Present-at-zero is a valid "set" instruction the guard must NOT reject (that distinction is the
    // whole point of the presence contract). A truthiness-based guard would wrongly drop these.
    expect(
      isRendererCommand({
        type: 'setSessionSettings',
        payload: { session_id: 'sess-a', model: '' },
        changeId: 'change-1'
      })
    ).toBe(true)
    expect(
      isRendererCommand({
        type: 'setSessionSettings',
        payload: { session_id: 'sess-a', yolo: false },
        changeId: 'change-1'
      })
    ).toBe(true)
  })

  it('accepts a fully-populated setSessionSettings command (#263)', () => {
    const payload: SetSessionSettingsPayload = {
      session_id: 'sess-a',
      model: 'opus',
      effort: 'high',
      yolo: true,
      permission_mode: 'plan'
    }
    expect(isRendererCommand({ type: 'setSessionSettings', payload, changeId: 'change-1' })).toBe(true)
  })

  it('admits permission_mode only as a string when present (#1021)', () => {
    const t = 'setSessionSettings'
    const c = 'change-1'
    // TYPE, not membership: the guard admits any string, including one outside the daemon's closed five
    // and including ''. That is deliberate — `validPermissionMode` is the daemon's, a client-side
    // allowlist would drift from it, and it would defend nothing while the strictly stronger `yolo` arm
    // sits unguarded beside it. Emptiness is likewise the daemon's call (it refuses '' on this field).
    expect(
      isRendererCommand({ type: t, payload: { session_id: 'sess-a', permission_mode: 'plan' }, changeId: c })
    ).toBe(true)
    expect(
      isRendererCommand({ type: t, payload: { session_id: 'sess-a', permission_mode: '' }, changeId: c })
    ).toBe(true)
    expect(
      isRendererCommand({
        type: t,
        payload: { session_id: 'sess-a', permission_mode: 'bypassPermissions' },
        changeId: c
      })
    ).toBe(true)
    // A PRESENT optional must be its type; an ABSENT one is accepted ("leave unchanged").
    expect(
      isRendererCommand({ type: t, payload: { session_id: 'sess-a', permission_mode: 42 }, changeId: c })
    ).toBe(false)
    expect(
      isRendererCommand({ type: t, payload: { session_id: 'sess-a', permission_mode: null }, changeId: c })
    ).toBe(false)
    expect(isRendererCommand({ type: t, payload: { session_id: 'sess-a' }, changeId: c })).toBe(true)
  })

  it('rejects a setSessionSettings with a missing/null payload (#263)', () => {
    expect(isRendererCommand({ type: 'setSessionSettings', changeId: 'change-1' })).toBe(false)
    expect(isRendererCommand({ type: 'setSessionSettings', payload: null, changeId: 'change-1' })).toBe(
      false
    )
  })

  it('rejects a setSessionSettings missing session_id or with a wrong-typed field (#263)', () => {
    const t = 'setSessionSettings'
    const c = 'change-1'
    // session_id is required-and-string.
    expect(isRendererCommand({ type: t, payload: {}, changeId: c })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { session_id: 42 }, changeId: c })).toBe(false)
    // A PRESENT optional must be its type — a wrong-typed present optional is rejected (a truthy
    // non-string model, a non-boolean yolo). An absent optional is accepted (covered above).
    expect(isRendererCommand({ type: t, payload: { session_id: 'sess-a', model: 1 }, changeId: c })).toBe(
      false
    )
    expect(
      isRendererCommand({ type: t, payload: { session_id: 'sess-a', effort: true }, changeId: c })
    ).toBe(false)
    expect(
      isRendererCommand({ type: t, payload: { session_id: 'sess-a', yolo: 'nope' }, changeId: c })
    ).toBe(false)
  })

  it('rejects a setSessionSettings whose changeId is missing or non-string (#261 boundary guard)', () => {
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a' }
    // The renderer-minted correlation key is validated at the untrusted boundary exactly as message_id
    // is — a well-formed payload with no/wrong changeId is rejected before it reaches the connection.
    expect(isRendererCommand({ type: 'setSessionSettings', payload })).toBe(false)
    expect(isRendererCommand({ type: 'setSessionSettings', payload, changeId: 42 })).toBe(false)
    expect(isRendererCommand({ type: 'setSessionSettings', payload, changeId: null })).toBe(false)
  })

  it('accepts a well-formed dequeueMessage command — string conversation_id + number queued_msg_id (#300)', () => {
    const command: RendererCommand = dequeueMessageCommand({ conversation_id: 'c1', queued_msg_id: 7 })
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum); the main-side fresh literal drops it.
    expect(
      isRendererCommand({
        type: 'dequeueMessage',
        payload: { conversation_id: 'c1', queued_msg_id: 7 },
        extra: 1
      })
    ).toBe(true)
  })

  it('rejects a dequeueMessage with a missing, null, or empty payload (#300)', () => {
    expect(isRendererCommand({ type: 'dequeueMessage' })).toBe(false)
    expect(isRendererCommand({ type: 'dequeueMessage', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'dequeueMessage', payload: {} })).toBe(false)
  })

  it('rejects a dequeueMessage with a non-string conversation_id or non-number queued_msg_id (#300)', () => {
    const t = 'dequeueMessage'
    // conversation_id must be present-and-string.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 42, queued_msg_id: 7 } })).toBe(false)
    // queued_msg_id must be present-and-NUMBER — the typeof-number check is the point: a numeric string
    // is rejected (no coercion), matching the requireNumber-alone posture of the #292 decode guard.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', queued_msg_id: '7' } })).toBe(
      false
    )
    // A missing key (either field) is rejected.
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { queued_msg_id: 7 } })).toBe(false)
  })

  it('accepts a well-formed notify command for each closed kind (#391)', () => {
    // The ONLY member whose guard tests closed-set membership, not `typeof === "string"`. No
    // constructor exists (the unarchiveConversation precedent): #392 builds the literal inline, proven
    // here through inline literals typed as the union.
    const turnComplete: RendererCommand = { type: 'notify', payload: { kind: 'turn-complete' } }
    const prompt: RendererCommand = { type: 'notify', payload: { kind: 'prompt' } }
    expect(isRendererCommand(turnComplete)).toBe(true)
    expect(isRendererCommand(prompt)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like the other members.
    const payload: NotifyPayload = { kind: 'turn-complete' }
    expect(isRendererCommand({ type: 'notify', payload, extra: 1 })).toBe(true)
  })

  it('rejects a notify with a missing or null payload (#391)', () => {
    expect(isRendererCommand({ type: 'notify' })).toBe(false)
    expect(isRendererCommand({ type: 'notify', payload: null })).toBe(false)
  })

  it('rejects a notify whose payload has no kind (#391)', () => {
    expect(isRendererCommand({ type: 'notify', payload: {} })).toBe(false)
  })

  it('rejects a notify whose kind is outside the closed set — free text cannot ride in (#391)', () => {
    // The AC2 keystone: unlike every other is*Payload (which accepts ANY string), this guard tests
    // closed-set membership. An arbitrary, possibly daemon-derived string is rejected, so it can never
    // map to notification copy — the by-construction guarantee that no relayed text reaches an OS notice.
    const t = 'notify'
    expect(isRendererCommand({ type: t, payload: { kind: 'evil' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { kind: '' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { kind: 'Permission prompt: rm -rf /' } })).toBe(false)
  })

  it('rejects a notify whose kind is a non-string (#391)', () => {
    const t = 'notify'
    expect(isRendererCommand({ type: t, payload: { kind: 42 } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { kind: null } })).toBe(false)
  })

  it('accepts a well-formed answerQuestions command over a mixed batch (#920)', () => {
    // The file's FIRST structured payload: `answers` is an array of objects, so the guard recurses
    // rather than stopping at Array.isArray. Mixed batch — entry 0 single-value, entry 1 multi-value
    // (the multi_select case) — in batch order, though question_index is what actually selects.
    const payload: AnswerQuestionsCommandPayload = {
      question_batch_id: 'qb-1',
      answers: [
        { question_index: 0, values: ['yes'] },
        { question_index: 1, values: ['a', 'b'] }
      ]
    }
    const command: RendererCommand = answerQuestionsCommand(payload)
    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts an answerQuestions carrying a smuggled answer_token and extra keys — structural minimum (#920)', () => {
    // The #236 posture, unchanged: the guard deliberately does not reject a smuggled token or an extra
    // key, at either level. The main-side sender's fresh-literal construction is what makes them lose,
    // and it rebuilds each ENTRY too — proved in daemonConnection.test.ts, not here.
    expect(
      isRendererCommand({
        type: 'answerQuestions',
        payload: {
          question_batch_id: 'qb-1',
          answer_token: 'smuggled',
          answers: [{ question_index: 0, values: ['yes'], conversation_id: 'c-evil' }]
        },
        extra: 1
      })
    ).toBe(true)
  })

  it('accepts an answerQuestions with an empty answers array and empty strings — shape, not contract (#920)', () => {
    // An empty `answers` is OUT OF CONTRACT upstream (a refusal says it better, which is why
    // question_refused is its own type) — but this is a SHAPE guard and does not adjudicate that. Same
    // for an empty-string batch id or value: the guard checks type, never emptiness, so it does not
    // over-reject a legal wire string.
    expect(
      isRendererCommand({ type: 'answerQuestions', payload: { question_batch_id: '', answers: [] } })
    ).toBe(true)
    expect(
      isRendererCommand({
        type: 'answerQuestions',
        payload: { question_batch_id: 'qb-1', answers: [{ question_index: 0, values: [''] }] }
      })
    ).toBe(true)
  })

  it('accepts an answerQuestions whose question_index is negative or huge — that bound is the resolver’s (#920)', () => {
    // Deliberately NOT range-checked here: upstream's answerVerdict range-checks every index before it
    // subscripts and rejects a bad answer totally. A second copy client-side would be a second bound to
    // keep in agreement with the batch (the DequeueMessagePayload/queued_msg_id posture).
    const t = 'answerQuestions'
    const mk = (question_index: number): unknown => ({
      type: t,
      payload: { question_batch_id: 'qb-1', answers: [{ question_index, values: ['v'] }] }
    })
    expect(isRendererCommand(mk(-1))).toBe(true)
    expect(isRendererCommand(mk(2 ** 62))).toBe(true)
  })

  it('rejects an answerQuestions with a missing/null payload or a missing/non-string batch id (#920)', () => {
    const t = 'answerQuestions'
    expect(isRendererCommand({ type: t })).toBe(false)
    expect(isRendererCommand({ type: t, payload: null })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { answers: [] } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { question_batch_id: 42, answers: [] } })).toBe(
      false
    )
    expect(isRendererCommand({ type: t, payload: { question_batch_id: null, answers: [] } })).toBe(
      false
    )
  })

  it('rejects an answerQuestions whose answers is missing or not an array (#920)', () => {
    const t = 'answerQuestions'
    const mk = (answers: unknown): unknown => ({ type: t, payload: { question_batch_id: 'qb-1', answers } })
    expect(isRendererCommand({ type: t, payload: { question_batch_id: 'qb-1' } })).toBe(false)
    expect(isRendererCommand(mk(null))).toBe(false)
    expect(isRendererCommand(mk('[]'))).toBe(false)
    // An array-LIKE object is rejected: Array.isArray is exact, so a length+index duck cannot pass.
    expect(isRendererCommand(mk({ 0: { question_index: 0, values: ['v'] }, length: 1 }))).toBe(false)
  })

  it('rejects an answerQuestions whose entry is malformed — the recursion is the point (#920)', () => {
    // A shallow Array.isArray check would let every one of these through to JSON.stringify and put a
    // type-lie on the wire. Each is one field of one entry.
    const t = 'answerQuestions'
    const mk = (entry: unknown): unknown => ({
      type: t,
      payload: { question_batch_id: 'qb-1', answers: [entry] }
    })
    expect(isRendererCommand(mk(null))).toBe(false)
    expect(isRendererCommand(mk('nope'))).toBe(false)
    expect(isRendererCommand(mk([]))).toBe(false)
    expect(isRendererCommand(mk({ values: ['v'] }))).toBe(false) // no question_index
    expect(isRendererCommand(mk({ question_index: '0', values: ['v'] }))).toBe(false)
    expect(isRendererCommand(mk({ question_index: 0 }))).toBe(false) // no values
    expect(isRendererCommand(mk({ question_index: 0, values: 'v' }))).toBe(false)
    expect(isRendererCommand(mk({ question_index: 0, values: [42] }))).toBe(false)
    expect(isRendererCommand(mk({ question_index: 0, values: [null] }))).toBe(false)
  })

  it('rejects an answerQuestions whose answers or values array has a HOLE (#920)', () => {
    // The case that distinguishes `for…of` from Array.prototype.every: `every` SKIPS holes, so a sparse
    // array passes it while JSON.stringify emits `null` for the hole — a null inside a declared
    // string[]. `for…of` goes through the iterator, which yields undefined for a hole, and the typeof
    // check then rejects it. Sparse arrays survive structured clone, so this is reachable over IPC.
    const holedValues: unknown[] = new Array(2)
    holedValues[1] = 'a'
    expect(
      isRendererCommand({
        type: 'answerQuestions',
        payload: {
          question_batch_id: 'qb-1',
          answers: [{ question_index: 0, values: holedValues }]
        }
      })
    ).toBe(false)

    const holedAnswers: unknown[] = new Array(2)
    holedAnswers[1] = { question_index: 1, values: ['a'] }
    expect(
      isRendererCommand({
        type: 'answerQuestions',
        payload: { question_batch_id: 'qb-1', answers: holedAnswers }
      })
    ).toBe(false)
  })

  it('accepts a well-formed refuseQuestions command with a batch id string (#920)', () => {
    // The single-id sibling, an exact clone of the cancelModal guard with the key changed. A
    // structurally-extra field (a smuggled answer_token included) is harmless — the main-side fresh
    // literal drops it.
    const payload: RefuseQuestionsCommandPayload = { question_batch_id: 'qb-1' }
    const command: RendererCommand = refuseQuestionsCommand(payload)
    expect(isRendererCommand(command)).toBe(true)
    expect(
      isRendererCommand({
        type: 'refuseQuestions',
        payload: { question_batch_id: 'qb-1', answer_token: 'smuggled' },
        extra: 1
      })
    ).toBe(true)
    // Type, not emptiness — an empty batch id is a valid wire string the daemon polices.
    expect(isRendererCommand({ type: 'refuseQuestions', payload: { question_batch_id: '' } })).toBe(
      true
    )
  })

  it('rejects a refuseQuestions with a missing/null payload or a missing/non-string batch id (#920)', () => {
    const t = 'refuseQuestions'
    expect(isRendererCommand({ type: t })).toBe(false)
    expect(isRendererCommand({ type: t, payload: null })).toBe(false)
    expect(isRendererCommand({ type: t, payload: {} })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { question_batch_id: 42 } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { question_batch_id: null } })).toBe(false)
  })
})

// The optional server id (#1120). FIVE members are SERVER-SCOPED: they are about a whole server and
// carry no id of any kind to route by, so the window names the server it means. The field is a
// top-level sibling of `payload`, never a field inside it — `setSessionSettings`' `changeId` shape —
// so the envelope builders, which consume `payload` alone, cannot put it on the wire.
//
// `interrupt` WAS THE SIXTH AND IS NOT ONE ANY MORE (#1092). It joined this set because it carried no
// id of any kind; now that the frame names the conversation whose turn to stop, that conversation id
// IS the address, and a `serverId` beside it would be a second one that could disagree. It routes
// through #1118's conversation index instead, like every other conversation-scoped command.
describe('the server-scoped commands name their server (#1120)', () => {
  // Every arm in the table, with a shape-valid payload where one is owed.
  const arms: Array<[string, Record<string, unknown>]> = [
    ['requestConversations', {}],
    ['requestRecentWorkspaces', {}],
    ['requestDebugBundle', {}],
    ['createConversation', { payload: { is_promoted: null, name: null, cwd: null } }],
    ['createWorkspaceFolder', { payload: { parent: '/home/op', name: 'notes' } }]
  ]

  it.each(arms)('accepts %s with an absent, an explicitly-undefined, and a string serverId', (type, rest) => {
    // ABSENT is the ordinary case today: no renderer sender has a per-server surface to name one
    // from yet (#1070/#1085/#1086), so every shipped sender emits the bare form.
    expect(isRendererCommand({ type, ...rest })).toBe(true)
    // EXPLICITLY-UNDEFINED must resolve as ABSENT, not as a non-string. Structured clone PRESERVES an
    // own property whose value is undefined, so a sender assigning the field unconditionally (this
    // file's `attachment_ids` idiom) puts exactly this shape on the bridge.
    expect(isRendererCommand({ type, ...rest, serverId: undefined })).toBe(true)
    expect(isRendererCommand({ type, ...rest, serverId: 'pyrybox' })).toBe(true)
    // Type, not emptiness: `''` is a name that matches no held record, so the ROUTER refuses it —
    // the guard has no entry set to check against and does not pretend to.
    expect(isRendererCommand({ type, ...rest, serverId: '' })).toBe(true)
  })

  it.each(arms)('rejects %s with a non-string serverId', (type, rest) => {
    for (const serverId of [42, null, {}, ['pyrybox'], true]) {
      expect(isRendererCommand({ type, ...rest, serverId })).toBe(false)
    }
  })

  it('leaves every command outside the table unaffected, `notify` included', () => {
    // `notify` is main-local: fireNotification owns the copy table, no command field supplies text,
    // and no frame results — so a server id on it would be a field nothing reads. A stray one is
    // ignored as any extra field is (structural minimum), NOT validated.
    const notify: unknown = { type: 'notify', payload: { kind: 'turn-complete' }, serverId: 42 }
    expect(isRendererCommand(notify)).toBe(true)
    expect(
      isRendererCommand({ type: 'archiveConversation', payload: { conversation_id: 'c-1' }, serverId: 42 })
    ).toBe(true)
  })

  it('types the optional field on each of the five members', () => {
    const commands: RendererCommand[] = [
      { type: 'requestConversations', serverId: 'pyrybox' },
      { type: 'requestRecentWorkspaces', serverId: 'pyrybox' },
      { type: 'requestDebugBundle', serverId: 'pyrybox' },
      { type: 'createConversation', payload: { is_promoted: null, name: null, cwd: null }, serverId: 'pyrybox' },
      { type: 'createWorkspaceFolder', payload: { parent: '/home/op', name: 'notes' }, serverId: 'pyrybox' }
    ]
    for (const command of commands) expect(isRendererCommand(command)).toBe(true)
    // And each still type-checks without it, which is what keeps the six renderer senders untouched.
    const bare: RendererCommand = { type: 'requestConversations' }
    expect(isRendererCommand(bare)).toBe(true)
  })

  it('leaves interrupt out of the set entirely, serverId and all (#1092)', () => {
    // Not merely "no longer validated": the field is GONE from the member, so a command carrying one
    // is an ordinary extra field the structural minimum ignores — it reaches no router and no wire.
    // The named payload is the whole address now.
    expect(interruptCommand({ conversation_id: 'c-1' })).toEqual({
      type: 'interrupt',
      payload: { conversation_id: 'c-1' }
    })
    expect(
      isRendererCommand({ type: 'interrupt', payload: { conversation_id: 'c-1' }, serverId: 42 })
    ).toBe(true)
  })
})
