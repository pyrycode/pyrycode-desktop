import type { ElectronApplication } from '@playwright/test'

/** Read-only checkpoints. Exact coordinates stay inside the isolated main process. */
export async function installPagingDurabilityEvidence(
  app: Pick<ElectronApplication, 'evaluate'>, host: string, chat: string
): Promise<void> {
  await app.evaluate(({ ipcMain, webContents }, owner) => {
    const state = globalThis as any
    const handlers = (ipcMain as any)._invokeHandlers
    const previous = state.__pagingDurability
    if (previous) {
      if (previous.host !== owner.host || previous.chat !== owner.chat ||
        handlers.get('pyry:chat-history') !== previous.handler) throw Error('Paging observer registration changed')
      return
    }
    const observations: unknown[] = []
    const saves = new Map<string, number>(), pending = new Set<number>(), completedSaves = new Set<number>()
    let epoch: string | undefined
    const record = (stage: string, fields: object = {}) => observations.push({ stage, ms: Date.now(), ...fields })
    const original = handlers.get('pyry:chat-history')
    if (!original) throw Error('Missing chat history handler')
    const handler = async (event: unknown, request: any) => {
      const matches = request?.serverId === owner.host && request?.conversationId === owner.chat
      const mutation = matches && request.operation === 'mutateThread' && request.change?.metadata && Array.isArray(request.change.items)
      const p = mutation ? request.change.persistence : undefined
      let save: number | undefined
      if (p && typeof p.id === 'string') {
        if (!saves.has(p.id)) saves.set(p.id, saves.size + 1)
        save = saves.get(p.id)
      }
      const fields = { save, part: Number.isSafeInteger(p?.part) ? p.part : undefined,
        parts: Number.isSafeInteger(p?.parts) ? p.parts : undefined }
      if (mutation) record('submitted', { ...fields, sameEpoch: epoch === request.change.metadata.epoch,
        sameOwner: request.change.metadata.hostId === owner.host && request.change.metadata.conversationId === owner.chat,
        items: request.change.items.length })
      const result = await original(event, request)
      if (mutation) {
        const completed = result.status === 'ok' && (!p || p.part + 1 === p.parts)
        if (save !== undefined && result.status === 'ok') {
          if (completed) { pending.delete(save); completedSaves.add(save) }
          else if (!completedSaves.has(save)) pending.add(save)
        }
        record('acknowledged', { ...fields, status: result.status, code: result.code, completed, pendingSaves: pending.size })
      }
      if (matches && request.operation === 'newestThreadPage') record('coverage', { status: result.status,
        code: result.code, sameEpoch: epoch === result.page?.metadata.epoch,
        sameOwner: result.page?.metadata.hostId === owner.host && result.page?.metadata.conversationId === owner.chat,
        start: result.page?.ranges.at(-1)?.start })
      return result
    }
    state.__pagingDurability = { ...owner, observations, handler }
    ipcMain.removeHandler('pyry:chat-history')
    ipcMain.handle('pyry:chat-history', handler)
    ipcMain.on('pyry:command', (_event, command) => {
      if (command?.type === 'queryThread' && command.serverId === owner.host && command.query.payload.conversation_id === owner.chat)
        record('request', { sameEpoch: epoch === command.query.payload.epoch,
          type: command.query.type === 'thread_page' ? 'thread_page' : command.query.type === 'thread_catch_up' ? 'thread_catch_up' : 'other' })
    })
    ipcMain.on('pyry:diagnostic', (_event, value) => {
      // Batch publication diagnostics are unscoped; only submission/acknowledgement
      // and received frames above/below establish the exact protected owner.
      const allowed = ['ok', 'missing', 'stored', 'page', 'invalid-request', 'unknown-host', 'membership-unavailable',
        'unreadable', 'write-failed', 'encryption-unavailable', 'unsupported-version', 'ipc-failed', 'invalid-snapshot',
        'begun', 'committed', 'abandoned']
      const code = allowed.includes(value?.code) ? value.code : 'other'
      if (value?.event === 'history-writer-result') record('writer', { code })
      if (value?.event === 'thread-items-batch') record('batch-publication-unscoped', { code })
    })
    for (const contents of webContents.getAllWebContents()) {
      const send = contents.send.bind(contents)
      contents.send = (channel, ...args) => {
        const event = args[0]
        if (event?.type === 'threadReply' && event.serverId === owner.host && event.conversationId === owner.chat) {
          epoch = event.reply.payload.epoch
          record('received', { type: event.reply.type, final: event.reply.payload.final,
            sameOwner: event.reply.payload.conversation_id === owner.chat })
        }
        return send(channel, ...args)
      }
    }
  }, { host, chat })
}
