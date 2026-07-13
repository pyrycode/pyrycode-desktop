import { describe, it, expect } from 'vitest'
import {
  COMMAND_CHANNEL,
  isRendererCommand,
  sendMessageCommand,
  answerModalCommand,
  cancelModalCommand,
  dequeueMessageCommand,
  interruptCommand,
  type RendererCommand,
  type AnswerModalCommandPayload
} from './commands'
import type {
  SendMessagePayload,
  ModalCancelPayload,
  CreateConversationPayload,
  PromoteConversationPayload,
  UnarchiveConversationPayload,
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

describe('interruptCommand (#306)', () => {
  it('constructs a bare interrupt command with no payload (fire-and-forget stop-the-turn)', () => {
    const command = interruptCommand()

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'interrupt' })
    if (command.type === 'interrupt') {
      // Bare member: no payload — nothing to parameterise, no token/key/raw-frame field (AC5).
      expect(command).not.toHaveProperty('payload')
    }
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

  it('accepts a well-formed requestSnapshot command carrying a string conversation_id (#180)', () => {
    // Compile-time proof the member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists.
    const command: RendererCommand = { type: 'requestSnapshot', payload: { conversation_id: 'c1' } }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(
      isRendererCommand({ type: 'requestSnapshot', payload: { conversation_id: 'c1' }, extra: 1 })
    ).toBe(true)
  })

  it('rejects a requestSnapshot with a missing payload or a non-string conversation_id (#180)', () => {
    expect(isRendererCommand({ type: 'requestSnapshot' })).toBe(false)
    expect(isRendererCommand({ type: 'requestSnapshot', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'requestSnapshot', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'requestSnapshot', payload: { conversation_id: 42 } })).toBe(
      false
    )
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

  it('accepts the bare interrupt command (no payload — stops the running turn) (#306)', () => {
    // The interrupt frame carries nothing to parameterise, so its guard case is a bare `return true`.
    // A structurally-extra field is harmless (structural minimum), like requestConversations.
    expect(isRendererCommand({ type: 'interrupt' })).toBe(true)
    expect(isRendererCommand({ type: 'interrupt', extra: 'ignored' })).toBe(true)
  })

  it('types the bare interrupt member as part of the union (#306)', () => {
    // Compile-time proof the bare member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = interruptCommand()
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
    // A structurally-extra field is harmless (structural minimum), like requestSnapshot.
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
    // while a missing/undefined key is rejected. No constructor exists (requestSnapshot precedent):
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
    // Mirrors requestSnapshot: a single required-string field, no constructor (the renderer in #348 builds
    // the literal inline). A structurally-extra field is harmless (structural minimum); the main-side fresh
    // literal drops it.
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
      yolo: true
    }
    expect(isRendererCommand({ type: 'setSessionSettings', payload, changeId: 'change-1' })).toBe(true)
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
})
