/**
 * Validate market/index.json against the plugin-market-index format 1 rules
 * (mirrors @deepseek-ai/dsh-plugin-market-index parseMarketIndex).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// `semver` is only used for the engines range check; skip that check when unavailable (e.g. CI).
let semver = null
for (const parent of ['C:/Users/shenm/.dsh/profiles/desktop/package.json', path.join(root, 'package.json')]) {
  try {
    semver = createRequire(parent)('semver')
    break
  } catch {
    /* try the next candidate */
  }
}

const index = JSON.parse(fs.readFileSync(path.join(root, 'market', 'index.json'), 'utf8'))
const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/u
const COMMIT = /^[0-9a-f]{40}$/u
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const localized = (value, label, requiredEn = true) => {
  if (typeof value === 'string') return value.trim() !== ''
  const ok = typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([key, text]) => LANGUAGE_ID.test(key) && typeof text === 'string' && text.trim() !== '') &&
    (!requiredEn || Object.hasOwn(value, 'en'))
  check(`${label} localized text`, ok, JSON.stringify(value))
  return ok
}

check('format is 1', index.format === 1)
localized(index.title, '$.title', true)
if (index.description !== undefined) localized(index.description, '$.description', false)
const categories = index.metadata?.categories ?? {}
check('metadata.categories declared', typeof categories === 'object' && categories !== null)
check('plugins is a non-empty array', Array.isArray(index.plugins) && index.plugins.length > 0)

const names = new Set()
for (const [position, plugin] of index.plugins.entries()) {
  const at = `$.plugins[${position}]`
  check(`${at}.name valid npm name`, PACKAGE_NAME.test(plugin.name), plugin.name)
  check(`${at}.name unique`, !names.has(plugin.name))
  names.add(plugin.name)
  if (plugin.title !== undefined) localized(plugin.title, `${at}.title`)
  if (plugin.description !== undefined) localized(plugin.description, `${at}.description`, false)
  check(`${at}.author string`, typeof plugin.author === 'string' && plugin.author !== '')
  check(`${at}.homepage absolute http(s)`, typeof plugin.homepage === 'string' && /^https?:\/\//u.test(plugin.homepage))
  check(`${at}.repository.url absolute`, typeof plugin.repository?.url === 'string' && /^https?:\/\//u.test(plugin.repository.url))
  if (plugin.metadata?.category !== undefined) check(`${at}.category declared`, Object.hasOwn(categories, plugin.metadata.category))
  check(`${at}.versions non-empty`, Array.isArray(plugin.versions) && plugin.versions.length > 0)
  if (typeof plugin.icon === 'string') {
    if (plugin.icon.startsWith('data:')) {
      const payload = DATA_ICON.exec(plugin.icon)?.[1]
      check(`${at}.icon base64 data URL`, payload !== undefined && payload !== '' && BASE64.test(payload))
      const bytes = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
      check(`${at}.icon <= 32 KiB decoded`, bytes <= 32 * 1024, `${bytes} bytes`)
    }
  }
  for (const [versionPosition, version] of plugin.versions.entries()) {
    const vat = `${at}.versions[${versionPosition}]`
    check(`${vat}.version exact semver`, SEMVER.test(version.version), version.version)
    check(`${vat}.publishTimestamp integer seconds`, Number.isInteger(version.publishTimestamp) && version.publishTimestamp >= 0 && version.publishTimestamp < 1e11)
    const source = version.source
    check(`${vat}.source.type is git or npm`, source?.type === 'git' || source?.type === 'npm')
    if (source?.type === 'git') {
      check(`${vat}.source.url canonical https`, typeof source.url === 'string' && source.url.startsWith('https:') && !source.url.includes('?') && !source.url.includes('#'))
      check(`${vat}.source.url names a repository`, /^(?:\/[^/]+){2,}$/u.test(new URL(source.url).pathname) && !/\.(?:tgz|tar\.gz)$/iu.test(new URL(source.url).pathname))
      check(`${vat}.source.commit 40-hex`, COMMIT.test(source.commit), source.commit)
    }
    if (version.engines?.dsh !== undefined) {
      if (semver === null) console.log(`SKIP  ${vat}.engines.dsh SemVer range (semver package unavailable)`)
      else check(`${vat}.engines.dsh SemVer range`, semver.validRange(version.engines.dsh) !== null, version.engines.dsh)
    }
  }
}

console.log(failures.length === 0 ? 'MARKET INDEX OK' : `${failures.length} FAILURE(S)`)
process.exitCode = failures.length === 0 ? 0 : 1
