/**
 * Detached exit-window cleaner, started by the host plugin at every start and
 * launched outside the desktop app's process tree (WMI on Windows), so the
 * client's shutdown cannot take it down with it.
 *
 * While the desktop client runs, Chromium holds the cookie database without
 * shared access, so no write is possible. This helper keeps polling until the
 * write lock can be acquired — i.e. the client has fully exited — then deletes
 * every loopback `dsh-auth-*` cookie (with a timestamped backup) and exits.
 * The next start re-mints a fresh cookie, so deleting all of them is safe.
 */
import { cleanupDb, isBusyError, resolveDb } from './lib/cleaner.js'
import { appendLog } from './lib/log.js'
import { writeStatus } from './lib/status.js'

const POLL_MS = 3_000
/** A helper that never finds a cookie database (e.g. installed on a non-desktop profile) must not live forever. */
const IDLE_LIMIT_MS = 10 * 60 * 1000

const startedAt = Date.now()

appendLog(`helper start pid=${process.pid}`)
writeStatus({ phase: 'armed', pid: process.pid, armedAt: new Date().toISOString() })

let reportedBusy = false

const timer = setInterval(() => {
  const file = resolveDb()
  if (file === undefined) {
    if (Date.now() - startedAt > IDLE_LIMIT_MS) {
      appendLog('no cookie database found for 10 minutes, exiting')
      writeStatus({ phase: 'error', message: 'cookie database not found' })
      process.exit(0)
    }
    return // keep waiting; the userData directory may not exist yet
  }

  let result
  try {
    result = cleanupDb({ file, keepNewest: 0, backup: true, vacuum: true })
  } catch (error) {
    if (isBusyError(error)) {
      if (!reportedBusy) {
        reportedBusy = true
        appendLog(`database busy (client running): ${String(error?.message ?? error)}`)
      }
      return // client still holds the database; wait for the exit window
    }
    appendLog(`cleanup error: ${String(error?.message ?? error)}`)
    writeStatus({ phase: 'error', message: String(error?.message ?? error), db: file })
    process.exit(1)
  }

  appendLog(`cleaned removed=${result.removed} total=${result.total} db=${result.db} backup=${result.backup ?? '(none)'}`)
  writeStatus({ phase: 'cleaned', ...result })
  process.exit(0)
}, POLL_MS)

// Keep the process alive on the interval alone; nothing else to unref.
void timer
