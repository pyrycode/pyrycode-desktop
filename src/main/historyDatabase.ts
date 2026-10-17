import Database from 'better-sqlite3'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { INVALID_CHAT_HISTORY, UNSUPPORTED_CHAT_HISTORY_VERSION, parseChatHistoryRequest } from '../shared/chatHistory'

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
      if (version !== 7 && version !== 6 && version !== 5) {
        if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4) throw UNSUPPORTED_CHAT_HISTORY_VERSION
      }
      // The protected schema-5 to 6 conversion runs in indexedThreadHistory's
      // transaction, where encryption and full saved-snapshot validation are available.
      if (version === 0) {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        if (tables.length) throw UNSUPPORTED_CHAT_HISTORY_VERSION
        db.transaction(() => db.exec(`
          CREATE TABLE legacy_scopes (
            identity TEXT PRIMARY KEY, server BLOB NOT NULL,
            conversation BLOB NOT NULL, UNIQUE(server, conversation));
          CREATE TABLE legacy_records (
            scope TEXT NOT NULL REFERENCES legacy_scopes(identity) ON DELETE CASCADE,
            kind TEXT NOT NULL, ordinal INTEGER NOT NULL, parent INTEGER NOT NULL,
            entry_id INTEGER, last_id INTEGER, row_key INTEGER, older_id INTEGER, newer_id INTEGER,
            payload BLOB NOT NULL, PRIMARY KEY(scope, kind, parent, ordinal));
          CREATE INDEX legacy_entry ON legacy_records(scope, kind, entry_id, last_id);
          CREATE INDEX legacy_row ON legacy_records(scope, kind, row_key);
          CREATE INDEX legacy_gap ON legacy_records(scope, kind, older_id, newer_id);
          PRAGMA user_version = 2;
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
      return db.transaction(() => {
        if (db.pragma('user_version', { simple: true }) === 1) {
          const scopes = db.prepare<[], { identity: unknown; server: unknown; conversation: unknown }>(
            'SELECT identity, server, conversation FROM legacy_scopes').all()
          const update = db.prepare('UPDATE legacy_scopes SET server = ?, conversation = ? WHERE identity = ?')
          for (const scope of scopes) {
            if (typeof scope.identity !== 'string' || typeof scope.server !== 'string' || typeof scope.conversation !== 'string')
              throw INVALID_CHAT_HISTORY
            parseChatHistoryRequest({ operation: 'readThread', serverId: scope.server, conversationId: scope.conversation })
            // BLOBs cannot collide with the remaining TEXT keys during this migration.
            update.run(Buffer.from(scope.server, 'utf16le'), Buffer.from(scope.conversation, 'utf16le'), scope.identity)
          }
          db.pragma('user_version = 2')
        }
        if (db.pragma('user_version', { simple: true }) === 2) {
          // Cursor anchors must skip non-start memberships even in a spanning receipt.
          db.exec(`CREATE INDEX IF NOT EXISTS legacy_receipt_start
            ON legacy_records(scope, entry_id, parent) WHERE kind = 'receipt-id' AND ordinal = 0`)
          db.pragma('user_version = 3')
        }
        if (db.pragma('user_version', { simple: true }) === 3) {
          // Also accept databases created by this branch before the two migrations merged.
          db.exec(`CREATE INDEX IF NOT EXISTS legacy_receipt_start
            ON legacy_records(scope, entry_id, parent) WHERE kind = 'receipt-id' AND ordinal = 0`)
          db.exec(`CREATE TABLE IF NOT EXISTS thread_scopes (
              identity TEXT PRIMARY KEY, server BLOB NOT NULL, conversation BLOB NOT NULL, UNIQUE(server, conversation));
            CREATE TABLE IF NOT EXISTS thread_records (
              scope TEXT NOT NULL REFERENCES thread_scopes(identity) ON DELETE CASCADE,
              kind TEXT NOT NULL CHECK(kind IN ('header', 'item', 'range')), ordinal INTEGER NOT NULL,
              arrival INTEGER, item_order INTEGER, range_ordinal INTEGER, range_start INTEGER, range_end INTEGER, payload BLOB NOT NULL,
              PRIMARY KEY(scope, kind, ordinal), UNIQUE(scope, kind, arrival));
            CREATE INDEX IF NOT EXISTS thread_ranges ON thread_records(scope, kind, range_start, range_end);
            PRAGMA user_version = 4;`)
        }
        if (db.pragma('user_version', { simple: true }) === 4) {
          db.exec(`CREATE TABLE IF NOT EXISTS history_import (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), retired INTEGER NOT NULL CHECK(retired IN (0, 1)));
            CREATE TABLE IF NOT EXISTS history_lists (server BLOB PRIMARY KEY, payload BLOB NOT NULL);
            PRAGMA user_version = 5;`)
        }
        return run(db)
      })()
    },
    /** The application queue owns this connection until completion, including every yield. */
    async transactionSteps(run: (db: Database.Database) => Generator<void>,
      onTurn: (units: number) => Promise<void> = () => new Promise(resolve => setImmediate(resolve))): Promise<void> {
      const db = open()
      if (db.inTransaction) throw new Error('history transaction already active')
      db.exec('BEGIN IMMEDIATE')
      try {
        const steps = run(db)
        let units = 0
        while (!steps.next().done) {
          if (++units === 16) { await onTurn(units); units = 0 }
        }
        db.exec('COMMIT')
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK')
        throw error
      }
    },
    close(): void { connection?.close(); connection = undefined }
  }
}
