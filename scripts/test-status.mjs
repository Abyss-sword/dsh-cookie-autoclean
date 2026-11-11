/** Verify lastClean survives a boot rewrite; restores the original status file afterwards. */
import fs from 'node:fs'

import { statusFile, writeStatus } from '../lib/status.js'

const file = statusFile()
const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed += 1
}
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))

writeStatus({ phase: 'cleaned', removed: 2, total: 2, kept: 0, db: 'C:/x/Cookies', backup: 'C:/x/Cookies.bak' })
let s = read()
check('cleaned writes lastClean', s.phase === 'cleaned' && s.lastClean?.removed === 2 && s.lastClean?.total === 2, JSON.stringify(s.lastClean))

writeStatus({ phase: 'armed', pid: 123, armedAt: new Date().toISOString() })
s = read()
check('armed keeps lastClean', s.phase === 'armed' && s.lastClean?.removed === 2, JSON.stringify(s))
check('armed drops stale live fields', s.removed === undefined && s.backup === undefined)

writeStatus({ phase: 'error', message: 'boom' })
s = read()
check('error keeps lastClean', s.phase === 'error' && s.lastClean?.removed === 2)

if (original !== undefined) fs.writeFileSync(file, original)
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`)
process.exitCode = failed === 0 ? 0 : 1
