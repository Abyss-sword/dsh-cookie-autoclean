/** Synthetic-database test for lib/cleaner.js (does not touch the real cookie store). */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { cleanupDb } from '../lib/cleaner.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cookie-autoclean-test-'))
const file = path.join(dir, 'Cookies')
const db = new DatabaseSync(file)
// creation_utc uses real Chromium magnitudes (microseconds since 1601-01-01,
// ~1.3e16), which exceed Number.MAX_SAFE_INTEGER — the regression this catches.
db.exec(`
  CREATE TABLE cookies (
    host_key TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    path TEXT,
    expires_utc INTEGER,
    creation_utc INTEGER,
    is_secure INTEGER,
    is_httponly INTEGER
  );
  INSERT INTO cookies VALUES ('127.0.0.1', 'dsh-auth-old', 'v1', '/', 13444000000000000, 13438827717898847, 0, 1);
  INSERT INTO cookies VALUES ('127.0.0.1', 'dsh-auth-older', 'v2', '/', 13444000000000000, 13438827800000000, 0, 1);
  INSERT INTO cookies VALUES ('127.0.0.1', 'dsh-auth-oldest', 'v3', '/', 13444000000000000, 13438827923306629, 0, 1);
  INSERT INTO cookies VALUES ('chat.deepseek.com', 'dsh-auth-should-survive', 'v4', '/', 13444000000000000, 13438828000000000, 0, 1);
  INSERT INTO cookies VALUES ('127.0.0.1', 'unrelated', 'v5', '/', 13444000000000000, 13438828100000000, 0, 1);
`)
db.close()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed += 1
}

// keepNewest = 1 (in-session mode): keep the newest loopback dsh-auth cookie.
{
  const result = cleanupDb({ file, keepNewest: 1, backup: true, vacuum: false })
  check('keepNewest=1 removed 2 of 3', result.removed === 2, JSON.stringify({ removed: result.removed, kept: result.kept, total: result.total }))
  check('keepNewest=1 kept 1', result.kept === 1)
  check('backup file created', typeof result.backup === 'string' && fs.existsSync(result.backup), String(result.backup))
  const db2 = new DatabaseSync(file, { readOnly: true })
  const rows = db2.prepare('SELECT name FROM cookies').all()
  db2.close()
  const names = rows.map((row) => row.name).sort()
  check(
    'survivors: newest dsh-auth + foreign domain + unrelated',
    rows.length === 3 && names.includes('dsh-auth-oldest') && names.includes('dsh-auth-should-survive') && names.includes('unrelated'),
    JSON.stringify(names),
  )
}

// keepNewest = 0 (exit-window mode): delete every loopback dsh-auth cookie.
{
  const result = cleanupDb({ file, keepNewest: 0, backup: true, vacuum: false })
  check('keepNewest=0 removed the last dsh-auth cookie', result.removed === 1, JSON.stringify(result))
  const db2 = new DatabaseSync(file, { readOnly: true })
  const names = db2.prepare('SELECT name FROM cookies ORDER BY name').all().map((row) => row.name)
  db2.close()
  check('keepNewest=0 survivors: only non-loopback and non-prefix cookies', names.length === 2 && !names.includes('dsh-auth-oldest'), JSON.stringify(names))
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`)
process.exitCode = failed === 0 ? 0 : 1
