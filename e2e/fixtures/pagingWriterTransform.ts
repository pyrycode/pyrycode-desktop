/** Test-profile-only source checkpoints; ordinary builds never import this module. */
export function pagingWriterTransform(source: string): string {
  const checkpoints = [
    ['      captureChange(host, id, slice)',
      "      globalThis.__observePagingWriter?.('published', { serverId: host, conversationId: id, change: slice.owned })\n      captureChange(host, id, slice)"],
    ['    } else pending.set(key, { serverId: host, head: node, tail: node })',
      "    } else pending.set(key, { serverId: host, head: node, tail: node })\n    globalThis.__observePagingWriter?.('queued', request, { running: running !== undefined, scheduled: cancel !== undefined })"],
    ['        // Yield a task even when elapsed renderer time is paused during a close flush.',
      "        globalThis.__observePagingWriter?.('yielded', request)\n        // Yield a task even when elapsed renderer time is paused during a close flush."],
    ['          const result = await deps.write(request)\n          ok =',
      "          globalThis.__observePagingWriter?.('submitting', request)\n          const result = await deps.write(request)\n          globalThis.__observePagingWriter?.('settled', request, { status: result.status, code: result.code })\n          ok ="],
    ['port1.close(); port2.close(); resolve()',
      "port1.close(); port2.close(); globalThis.__observePagingWriter?.('resumed', request); resolve()"]
  ]
  for (const [anchor, replacement] of checkpoints) {
    if (source.split(anchor).length !== 2) throw Error('Paging checkpoint anchor changed')
    source = source.replace(anchor, replacement)
  }
  return source
}

export function pagingAdmissionTransform(source: string): string {
  const checkpoints = [
    ['      try {\n        const result = await deps.store.execute(request)',
      "      try {\n        globalThis.__observePagingAdmission?.('admitted', request)\n        const result = await deps.store.execute(request)\n        globalThis.__observePagingAdmission?.('storage-completed', request, result)"],
  ]
  for (const [anchor, replacement] of checkpoints) {
    if (source.split(anchor).length !== 2) throw Error('Paging checkpoint anchor changed')
    source = source.replace(anchor, replacement)
  }
  return source
}

export function pagingTransactionTransform(source: string): string {
  const anchor = 'await onTurn(units); units = 0'
  if (source.split(anchor).length !== 2) throw Error('Paging checkpoint anchor changed')
  return source.replace(anchor,
    "globalThis.__observePagingTransactionTurn?.('yielded'); await onTurn(units); globalThis.__observePagingTransactionTurn?.('resumed'); units = 0")
}

export function pagingProtectedReadTransform(source: string): string {
  const flush = '    function* flushSteps(): Generator<void> {'
  if (source.split(flush).length !== 3) throw Error('Paging checkpoint anchor changed')
  source = source.replaceAll(flush, flush + `
      const prepareIndexWrite = (sql: string) => {
        const start = performance.now(), statement = db.prepare(sql)
        globalThis.__observePagingSql?.('compiled', performance.now() - start)
        return { run: (...args: unknown[]) => {
          const start = performance.now()
          try { return statement.run(...args) }
          finally { globalThis.__observePagingSql?.('executed', performance.now() - start) }
        } }
      }`)
  for (const sql of ['DELETE FROM thread_auth WHERE scope = ? AND tree = ? AND path = ?',
    'INSERT OR REPLACE INTO thread_auth VALUES (?, ?, ?, ?)']) {
    const anchor = `db.prepare('${sql}')`
    if (source.split(anchor).length !== 3) throw Error('Paging checkpoint anchor changed')
    source = source.replaceAll(anchor, `prepareIndexWrite('${sql}')`)
  }
  const anchor = '    if (h.persistence) throw INVALID_CHAT_HISTORY'
  if (source.split(anchor).length !== 2) throw Error('Paging checkpoint anchor changed')
  return source.replace(anchor,
    '    if (limit === 1 && !token && !opening) globalThis.__observeProtectedPaging?.(server, conversation, h)\n' + anchor)
}
