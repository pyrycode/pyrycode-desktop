import Database from 'better-sqlite3'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { UNSUPPORTED_CHAT_HISTORY_VERSION } from '../shared/chatHistory'

/** Main-process owner. The supplied directory comes from app.getPath('userData'), never IPC. */
export function createHistoryDatabase({ userDataPath }: { userDataPath: string }) {
  let connection: Database.Database | undefined
  function open(): Database.Database {
    if (connection) return connection
    const directory = join(userDataPath, 'history')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'history.sqlite')
    const db = new Database(path)
    try {
      const version = db.pragma('user_version', { simple: true })
      if (version !== 0 && version !== 1) throw UNSUPPORTED_CHAT_HISTORY_VERSION
      if (version === 0) {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        if (tables.length) throw UNSUPPORTED_CHAT_HISTORY_VERSION
        db.transaction(() => db.exec(`
          CREATE TABLE legacy_scopes (
            identity TEXT PRIMARY KEY, server TEXT NOT NULL COLLATE BINARY,
            conversation TEXT NOT NULL COLLATE BINARY, UNIQUE(server, conversation));
          CREATE TABLE legacy_records (
            scope TEXT NOT NULL REFERENCES legacy_scopes(identity) ON DELETE CASCADE,
            kind TEXT NOT NULL, ordinal INTEGER NOT NULL, parent INTEGER NOT NULL,
            entry_id INTEGER, last_id INTEGER, row_key INTEGER, older_id INTEGER, newer_id INTEGER,
            payload BLOB NOT NULL, PRIMARY KEY(scope, kind, parent, ordinal));
          CREATE INDEX legacy_entry ON legacy_records(scope, kind, entry_id, last_id);
          CREATE INDEX legacy_row ON legacy_records(scope, kind, row_key);
          CREATE INDEX legacy_gap ON legacy_records(scope, kind, older_id, newer_id);
          PRAGMA user_version = 1;
        `))()
      }
      db.pragma('foreign_keys = ON')
      db.pragma('temp_store = MEMORY')
      chmodSync(path, 0o600)
      connection = db
      return db
    } catch (error) { db.close(); throw error }
  }
  return {
    transaction<T>(run: (db: Database.Database) => T): T {
      const db = open()
      return db.transaction(() => run(db))()
    },
    close(): void { connection?.close(); connection = undefined }
  }
}
