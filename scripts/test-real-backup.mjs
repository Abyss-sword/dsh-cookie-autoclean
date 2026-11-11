/** Prove the fixed engine works on a REAL cookie-store snapshot (copy of an old backup). */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { cleanupDb } from '../lib/cleaner.js'

const source = process.argv[2]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cookie-autoclean-real-'))
const file = path.join(dir, 'Cookies')
fs.copyFileSync(source, file)

const result = cleanupDb({ file, keepNewest: 0, backup: true, vacuum: true })
console.log(JSON.stringify(result, null, 2))
const clean = result.removed > 0 && result.backup !== undefined
console.log(clean ? 'REAL-DATA CLEAN OK' : 'REAL-DATA CLEAN FAILED')
fs.rmSync(dir, { recursive: true, force: true })
process.exitCode = clean ? 0 : 1
