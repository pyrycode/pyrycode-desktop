import type { DaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem } from '../../src/shared/wire/thread'
import type { AnswerQuestionsCommandPayload } from '../../src/shared/ipc/commands'

/** Scenario-local observer; self-contained so the identical tested function runs in the page. */
export function createQuestionAnswerEvidence(subscribe = false) {
  type Submission = { serverId?: string; conversationId: string; batchId: string; answers: AnswerQuestionsCommandPayload['answers'] }
  type Held = Pick<ThreadItem, 'id' | 'kind' | 'rev' | 'parent' | 'turn'> & { content: unknown }
  let host = '', conversation = '', batch = '', epoch = '', turn = ''
  let outstanding = false, armed = false, submitted = false, dismissed = false, witnessed = false, completed = false, invalid = false
  let confirmation = '', expected = ''
  const items = new Map<number, Held>()
  const baseline = new Map<number, string>()
  const ended = new Set<number>()
  let companion: { id: number; rev: number; version: number } | undefined
  const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  function submit(value: Submission): void {
    if (!armed) return
    if (submitted || value.serverId !== host || value.conversationId !== conversation || value.batchId !== batch ||
        JSON.stringify(value.answers) !== expected) { invalid = true; return }
    submitted = true
  }
  function observe(event: DaemonEvent): void {
    if (!('serverId' in event) || typeof event.serverId !== 'string') return
    if (event.type === 'conversationCreated' && !conversation) {
      host = event.serverId ?? ''; conversation = event.conversation.id
    }
    if (event.type === 'questionShown') {
      if (!batch && (!host || event.serverId === host && event.conversationId === conversation)) {
        host = event.serverId ?? ''; conversation = event.conversationId; batch = event.questionBatchId; outstanding = true
      }
      else if (event.serverId === host && event.conversationId === conversation && event.questionBatchId !== batch) invalid = true
    }
    if (event.type === 'questionDismissed' && event.serverId === host && event.questionBatchId === batch) {
      outstanding = false
      if (armed && submitted && event.outcome === 'answered') dismissed = true
    }
    if (event.type !== 'threadUpdate' || event.serverId !== host || event.conversationId !== conversation ||
        event.update.payload.conversation_id !== conversation) return
    const { update } = event
    const p = update.payload
    if (epoch && epoch !== p.epoch) { invalid = true; return }
    epoch = p.epoch
    const previousCompanion = companion
    companion = undefined
    let item: Held | undefined
    if (update.type === 'thread_item_added') {
      const old = items.get(update.payload.item.id)
      if (old && old.rev >= update.payload.item.rev) return
      item = update.payload.item
    } else {
      const p = update.payload
      const old = items.get(update.payload.item_id)
      const paired = update.type === 'thread_text_append' && p.rev === p.base_rev &&
        previousCompanion?.id === update.payload.item_id && previousCompanion.rev === p.rev && previousCompanion.version === p.version
      if (old && old.rev >= p.rev && !paired) return
      if (!old || old.rev !== p.base_rev) { invalid = true; return }
      if (update.type === 'thread_item_changed') {
        item = { ...old, ...update.payload.changes, rev: p.rev }
        companion = { id: old.id, rev: p.rev, version: p.version }
      } else if (record(old.content) && typeof old.content.text === 'string') {
        item = { ...old, rev: p.rev, content: { ...old.content, text: old.content.text + update.payload.text } }
      }
    }
    if (!item) return
    const content = record(item.content) ? item.content : {}
    // Retain only fields needed by this proof, never complete tool input/output or daemon envelopes.
    items.set(item.id, { id: item.id, kind: item.kind, rev: item.rev, parent: item.parent, turn: item.turn,
      content: item.kind === 'assistant_message' ? { text: content.text }
        : item.kind === 'tool_call' ? { name: content.name } : {
          stop_reason: content.stop_reason, is_error: content.is_error, outcome: content.outcome,
          terminal_reason: content.terminal_reason, error_category: content.error_category
        } })
    if (item.parent !== undefined || typeof item.turn !== 'string') return
    const firstEnd = item.kind === 'turn_end' && !ended.has(item.id)
    if (item.kind === 'turn_end') ended.add(item.id)
    if (!armed && item.kind === 'tool_call' && content.name === 'AskUserQuestion') turn = item.turn
    if (!armed || !submitted || item.turn !== turn) return
    if (item.kind === 'assistant_message' && typeof content.text === 'string') {
      const before = baseline.get(item.id) ?? ''
      if (!content.text.startsWith(before)) { invalid = true; return }
      if (content.text.slice(before.length).includes(confirmation)) witnessed = true
    }
    if (firstEnd && witnessed && content.stop_reason === 'end_turn' && content.is_error !== true &&
        (!content.outcome || content.outcome === 'success') && (!content.terminal_reason || content.terminal_reason === 'completed') &&
        !content.error_category) completed = true
  }
  function arm(value: { confirmation: string; answers: Submission['answers'] }): boolean {
    if (armed || !outstanding || !host || !turn || !epoch || !value.confirmation) return false
    confirmation = value.confirmation; expected = JSON.stringify(value.answers); armed = true
    for (const item of items.values()) if (item.kind === 'assistant_message' && record(item.content) && typeof item.content.text === 'string')
      baseline.set(item.id, item.content.text)
    return true
  }
  const complete = () => armed && submitted && dismissed && witnessed && completed && !invalid
  const identity = () => ({ host, conversation, batch, turn, outstanding })
  const proof = { observe, submit, arm, complete, identity, stop: () => {} }
  if (subscribe) {
    proof.stop = window.pyry.onDaemonEvent(observe)
    ;(window as typeof window & { questionAnswerEvidence: typeof proof }).questionAnswerEvidence = proof
  }
  return proof
}
