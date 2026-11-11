/** Validate the profile cordis.patch.yml syntax (replace !!js markers for a structural parse). */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('C:/Users/shenm/.dsh/profiles/desktop/package.json')
const yaml = require('js-yaml')

const file = 'C:/Users/shenm/.dsh/profiles/desktop/cordis.patch.yml'
const raw = fs.readFileSync(file, 'utf8')
console.log('BOM:', raw.charCodeAt(0) === 0xfeff)
const normalized = raw
  .replace(/!!js /g, '')
  .replace(/ctx\.webStartup\.trustedHosts/g, '[]')
const doc = yaml.load(normalized)
console.log('entries:', doc.length)
const connection = doc.find((entry) => entry.id === 'connection')
console.log('connection row:', JSON.stringify(connection))
console.log('cookieMaxAgeDays:', connection?.config?.cookieMaxAgeDays)
console.log('trustedHosts present:', connection?.config?.trustedHosts !== undefined)
console.log('OK')
