import type { ElectronApplication } from '@playwright/test'

type Database = { prepare(sql: string): { get(): unknown }; close(): void }
type LoadDatabase = (packagePath: string) => new (path: string) => Database

export function probeReplayNativeStorage(
  { app }: { app: { getAppPath(): string } },
  load: LoadDatabase = packagePath => process.getBuiltinModule('module').createRequire(packagePath)('better-sqlite3')
): boolean {
  // Serialized into Electron by app.evaluate: keep every runtime dependency inside this function.
  try {
    const Database = load(`${app.getAppPath()}/package.json`)
    const database = new Database(':memory:')
    try {
      database.prepare('SELECT 1').get()
      return true
    } finally { database.close() }
  } catch { return false }
}

export async function assertReplayNativeStorage(app: ElectronApplication): Promise<void> {
  if (!await app.evaluate(probeReplayNativeStorage, undefined))
    throw new Error('Replay requires working Electron SQLite; run npm run rebuild:electron before replay.')
}
