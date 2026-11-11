/** Locate and write the shared status file (<userData>/desktop/dsh-cookie-autoclean.json). */
import fs from 'node:fs'
import path from 'node:path'

export function statusFile() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, '@deepseek-ai', 'dsh-desktop', 'desktop', 'dsh-cookie-autoclean.json')
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME ?? '', 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop', 'desktop', 'dsh-cookie-autoclean.json')
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME ?? '', '.config')
  return path.join(configHome, '@deepseek-ai', 'dsh-desktop', 'desktop', 'dsh-cookie-autoclean.json')
}

function readPrevious(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Overwrite the status file with the latest run outcome (best-effort, never grows).
 *
 * `lastClean` keeps a durable summary of the most recent *non-empty* cleanup
 * across restarts: each boot rewrites the live `phase` back to `armed`, and a
 * second helper that finds nothing left to delete must not erase the first
 * helper's real record.
 */
export function writeStatus(outcome) {
  try {
    const file = statusFile()
    const previous = readPrevious(file)
    const now = new Date().toISOString()
    const merged = { ranAt: now, ...outcome }
    if (previous.lastClean !== undefined) merged.lastClean = previous.lastClean
    if (outcome.phase === 'cleaned' && Number(outcome.removed) > 0) {
      merged.lastClean = {
        cleanedAt: now,
        removed: outcome.removed,
        total: outcome.total,
        db: outcome.db,
        backup: outcome.backup,
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n')
  } catch {
    /* status is best-effort only */
  }
}
