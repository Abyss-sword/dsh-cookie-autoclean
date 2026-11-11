/** Verify backup pruning: 12 existing backups -> keep the newest 10 after one cleanup. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { cleanupDb } from '../lib/cleaner.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cookie-autoclean-prune-'))
const file = path.join(dir, 'Cookies')
const db = new DatabaseSync(file)
db.exec(`
  CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER, creation_utc INTEGER);
  INSERT INTO cookies VALUES ('127.0.0.1', 'dsh-auth-x', 'v', '/', 0, 13438827717898847);
`)
db.close()
// Simulate 12 old backups (the cleanup under test creates the 13th, so keep=10 leaves 11).
for (let i = 1; i <= 12; i += 1) {
  fs.writeFileSync(`${file}.bak-20260101000${String(i).padStart(2, '0')}`, 'old')
}
const result = cleanupDb({ file, keepNewest: 0, backup: true, vacuum: false })
const remaining = fs.readdirSync(dir).filter((name) => name.startsWith('Cookies.bak-'))
// 12 old backups + this run's backup = 13; keep the newest 10 -> 3 pruned.
const ok = remaining.length === 10 && result.prunedBackups === 3
console.log(JSON.stringify({ removed: result.removed, prunedBackups: result.prunedBackups, remaining: remaining.length }))
console.log(ok ? 'PRUNE OK' : 'PRUNE FAILED')
fs.rmSync(dir, { recursive: true, force: true })
process.exitCode = ok ? 0 : 1
