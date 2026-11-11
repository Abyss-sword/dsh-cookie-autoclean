import { DatabaseSync } from 'node:sqlite'

const file = process.argv[2]
const db = new DatabaseSync(file, { readOnly: true })
const rows = db
  .prepare(
    "SELECT host_key, name, CAST(creation_utc AS TEXT) AS creation_utc FROM cookies WHERE host_key IN ('127.0.0.1', 'localhost', '[::1]') AND name LIKE 'dsh-auth-%'",
  )
  .all()
console.log(`dsh-auth cookies in ${file}: ${rows.length}`)
const epoch = 11644473600n
for (const row of rows) {
  const seconds = Number(BigInt(row.creation_utc ?? '0') / 10n ** 6n - epoch)
  console.log(' -', row.host_key, `${String(row.name).slice(0, 24)}...`, new Date(seconds * 1000).toISOString())
}
const total = db.prepare('SELECT COUNT(*) AS n FROM cookies').get()
console.log('total cookies:', total.n)
db.close()
