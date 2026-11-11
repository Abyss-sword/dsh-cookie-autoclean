/** Verify the active profile patch parses and inspect the plugin-market index rows. */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('C:/Users/shenm/.dsh/profiles/desktop/package.json')
const yaml = require('js-yaml')

const file = 'C:/Users/shenm/.dsh/profiles/desktop/cordis.patch.yml'
const raw = fs.readFileSync(file, 'utf8')
const normalized = raw.replace(/!!js /g, '').replace(/ctx\.webStartup\.trustedHosts/g, '[]')
const doc = yaml.load(normalized)
console.log('entries:', doc.length)
const market = doc.find((entry) => entry.id === 'plugin-market')
console.log('plugin-market indexes:')
for (const url of market?.config?.indexes ?? []) console.log(`  - ${url}`)
console.log('timeout row:', doc.find((entry) => entry.id === 'timeout-policy') ? 'present' : 'absent')
console.log('connection row:', doc.find((entry) => entry.id === 'connection') ? 'present' : 'absent')
console.log('OK')
