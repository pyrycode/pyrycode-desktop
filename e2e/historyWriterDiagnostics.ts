// Serialized into the app's inspector. Keep every runtime dependency inside this function.
export async function startWriterDiagnostics({ safeStorage }: typeof import('electron')) {
  const { Session } = require('node:inspector')
  const { readFileSync } = require('node:fs')
  const { loadavg } = require('node:os')
  const session = new Session()
  session.connect()
  const post = (method: string) => new Promise<any>((resolve, reject) =>
    session.post(method, (error: unknown, result: unknown) => error ? reject(error) : resolve(result)))
  const throttling = () => {
    try { return readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8') } catch { return null }
  }
  const started = performance.now(), cpu = process.cpuUsage(), load = loadavg(), throttle = throttling()
  const calls: Record<string, { count: number; ms: number; max: number }> = {}
  const restore: (() => void)[] = []
  function measure(target: any, key: string, name: string) {
    const original = target[key], stats = calls[name] = { count: 0, ms: 0, max: 0 }
    target[key] = function (this: unknown, ...args: unknown[]) {
      const start = performance.now()
      try { return original.apply(this, args) }
      finally { const ms = performance.now() - start; stats.count++; stats.ms += ms; stats.max = Math.max(stats.max, ms) }
    }
    restore.push(() => { target[key] = original })
  }
  measure(safeStorage, 'encryptString', 'encrypt')
  measure(safeStorage, 'decryptString', 'decrypt')
  const Database = require(require.resolve('better-sqlite3', { paths: [process.cwd()] }))
  const db = new Database(':memory:')
  const statement = Object.getPrototypeOf(db.prepare('SELECT 1'))
  db.close()
  measure(Database.prototype, 'prepare', 'prepare')
  for (const key of ['run', 'get', 'all']) measure(statement, key, key)
  await post('Profiler.enable')
  await post('Profiler.start')
  let result: unknown
  ;(globalThis as any).finishWriterDiagnostics = async () => {
    if (result) return result
    const ended = performance.now(), used = process.cpuUsage(cpu)
    for (const undo of restore) undo()
    try {
      const { profile } = await post('Profiler.stop')
      const counts = new Map<number, number>()
      for (const sample of profile.samples ?? []) counts.set(sample, (counts.get(sample) ?? 0) + 1)
      const functions = new Map<string, number>()
      for (const node of profile.nodes) {
        const name = node.callFrame.functionName || '(anonymous)'
        functions.set(name, (functions.get(name) ?? 0) + (counts.get(node.id) ?? 0))
      }
      result = { elapsed: ended - started, cpu: used, loadBefore: load, loadAfter: loadavg(),
        throttleBefore: throttle, throttleAfter: throttling(), calls,
        samples: profile.samples?.length, hot: [...functions].sort((a, b) => b[1] - a[1]).slice(0, 20) }
      return result
    } finally { session.disconnect() }
  }
}
