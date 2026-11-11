/** Append-only diagnostic log (<userData>/desktop/dsh-cookie-autoclean.log), best-effort. */
import fs from 'node:fs'
import path from 'node:path'

import { statusFile } from './status.js'

const MAX_BYTES = 128 * 1024

export function appendLog(line) {
  try {
    const file = path.join(path.dirname(statusFile()), 'dsh-cookie-autoclean.log')
    const entry = `${new Date().toISOString()} ${line}\n`
    try {
      const stat = fs.statSync(file)
      if (stat.size > MAX_BYTES) fs.writeFileSync(file, entry)
      else fs.appendFileSync(file, entry)
    } catch {
      fs.writeFileSync(file, entry)
    }
  } catch {
    /* log is best-effort only */
  }
}
