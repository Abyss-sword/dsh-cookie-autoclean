/**
 * Shared cookie-store engine used by the host plugin (opportunistic in-session
 * attempt) and the detached exit-window helper (the reliable path).
 *
 * The Chromium cookie database is held without shared access while the
 * desktop client runs, so any write attempt is gated by acquiring the
 * exclusive SQLite write lock (`BEGIN IMMEDIATE`): failure means the client
 * still holds it and the caller should wait for the exit window.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const PREFIX = 'dsh-auth-'
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']
const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal']
const BUSY_PATTERN = /locked|busy|unable to open|permission denied/i

export function isBusyError(error) {
  return BUSY_PATTERN.test(String(error?.message ?? error))
}

function sizeOf(file) {
  try {
    const stat = fs.statSync(file)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

/** Candidate Chromium cookie database locations (desktop client userData layout, plus the legacy layout). */
export function candidateDbs(env = process.env) {
  const out = []
  const explicit = String(env.DSH_COOKIE_DB || '').trim()
  if (explicit !== '') {
    out.push(path.resolve(explicit))
    return out
  }
  const roots = []
  const envRoot = String(env.DSH_USER_DATA || '').trim()
  if (envRoot !== '') roots.push(envRoot)
  if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    for (const name of ['@deepseek-ai/dsh-desktop', 'DSH Desktop', 'deepseek-harness']) {
      roots.push(path.join(appData, name))
    }
  } else if (process.platform === 'darwin') {
    for (const name of ['@deepseek-ai/dsh-desktop', 'DSH Desktop', 'deepseek-harness']) {
      roots.push(path.join(os.homedir(), 'Library', 'Application Support', name))
    }
  } else {
    const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    for (const name of ['@deepseek-ai/dsh-desktop', 'DSH Desktop', 'deepseek-harness']) {
      roots.push(path.join(configHome, name))
    }
  }
  for (const root of roots) {
    out.push(path.join(root, 'Network', 'Cookies'))
    out.push(path.join(root, 'Cookies'))
  }
  return out
}

export function resolveDb(env = process.env) {
  for (const file of candidateDbs(env)) {
    if (sizeOf(file) > 0) return file
  }
  return undefined
}

function assertSchema(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cookies'").get()
  if (table === undefined) throw new Error('target database has no cookies table (not a Chromium cookie store)')
  const columns = new Set(db.prepare('PRAGMA table_info(cookies)').all().map((row) => String(row.name)))
  for (const need of ['host_key', 'name', 'expires_utc']) {
    if (!columns.has(need)) throw new Error(`cookies table is missing the ${need} column, refusing to write`)
  }
  return columns
}

/** Copy the database plus its sidecar files to a timestamped backup next to the original. */
function backupDb(file) {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const backup = `${file}.bak-${stamp}`
  fs.copyFileSync(file, backup)
  for (const suffix of SIDECAR_SUFFIXES) {
    const side = `${file}${suffix}`
    if (sizeOf(side) === 0) continue
    try {
      fs.copyFileSync(side, `${backup}${suffix}`)
    } catch {
      /* sidecar backup is best-effort; the main copy is what matters */
    }
  }
  return backup
}

/**
 * Keep only the most recent `keep` backup copies of `file` (sidecar files of a
 * kept backup are covered by the same name prefix). Returns how many files
 * were removed; failures are silent because pruning is housekeeping.
 */
function pruneBackups(file, keep = 10) {
  try {
    const dir = path.dirname(file)
    const prefix = `${path.basename(file)}.bak-`
    const backups = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort()
    const excess = backups.length > keep ? backups.slice(0, backups.length - keep) : []
    for (const name of excess) fs.rmSync(path.join(dir, name), { force: true })
    return excess.length
  } catch {
    return 0
  }
}

/**
 * Delete loopback `dsh-auth-*` cookies from `file`, keeping the `keepNewest`
 * most recently created ones. Throws while the client still holds the
 * database (callers use `isBusyError` to wait for the exit window).
 *
 * @returns {Promise<object>} a `status: 'cleaned'` result with counts.
 */
export function cleanupDb({ file, keepNewest = 0, backup = true, vacuum = true } = {}) {
  const beforeBytes = sizeOf(file)
  const db = new DatabaseSync(file, { timeout: 200 })
  try {
    db.exec('BEGIN IMMEDIATE') // exclusive write lock; throws while the client owns the database
  } catch (error) {
    try {
      db.close()
    } catch {
      /* already closed */
    }
    throw error
  }
  let backupPath
  try {
    assertSchema(db)
    const hosts = LOOPBACK_HOSTS.map((host) => `'${host}'`).join(', ')
    // Never read creation_utc into JS: Chromium stores it as microseconds since
    // 1601-01-01 (~1.3e16), beyond Number.MAX_SAFE_INTEGER, and node:sqlite
    // throws while materializing such an INTEGER. Ordering stays inside SQLite.
    const rows = db
      .prepare(`SELECT host_key, name FROM cookies WHERE host_key IN (${hosts}) AND name LIKE ?`)
      .all(`${PREFIX}%`)

    const key = (row) => `${row.host_key}\u0000${row.name}`
    let keep = new Set()
    if (keepNewest > 0 && rows.length > 0) {
      const newest = db
        .prepare(`SELECT host_key, name FROM cookies WHERE host_key IN (${hosts}) AND name LIKE ? ORDER BY creation_utc DESC LIMIT ?`)
        .all(`${PREFIX}%`, keepNewest)
      keep = new Set(newest.map(key))
    }

    if (rows.length > 0 && backup) backupPath = backupDb(file)

    const del = db.prepare('DELETE FROM cookies WHERE host_key = ? AND name = ?')
    let removed = 0
    for (const row of rows) {
      if (keep.has(key(row))) continue
      removed += Number(del.run(row.host_key, row.name).changes)
    }
    db.exec('COMMIT')

    let afterBytes = sizeOf(file)
    if (vacuum) {
      try {
        db.exec('VACUUM')
        afterBytes = sizeOf(file)
      } catch {
        /* VACUUM failure does not undo the committed deletion */
      }
    }
    const pruned = backupPath !== undefined ? pruneBackups(file) : 0
    return {
      status: 'cleaned',
      removed,
      kept: rows.length - removed,
      total: rows.length,
      db: file,
      beforeBytes,
      afterBytes,
      backup: backupPath,
      prunedBackups: pruned,
    }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* transaction may already be finished */
    }
    throw error
  } finally {
    try {
      db.close()
    } catch {
      /* already closed */
    }
  }
}
