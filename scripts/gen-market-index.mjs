/**
 * Generate market/index.json (DSH plugin-market index format 1) for this plugin.
 *
 * The index pins the current git commit and the package.json version. Re-run
 * this script (and commit the result) after bumping the version or tagging a
 * release.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (file) => fs.readFileSync(path.join(root, file))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const version = JSON.parse(read('package.json').toString('utf8')).version
const icon = `data:image/svg+xml;base64,${read('icon.svg').toString('base64')}`
const publishTimestamp = Math.floor(Date.now() / 1000)

const index = {
  format: 1,
  title: { en: 'Abyss-sword DSH plugins', 'zh-cn': 'Abyss-sword DSH 插件' },
  description: {
    en: 'DSH desktop plugins maintained by Abyss-sword.',
    'zh-cn': 'Abyss-sword 维护的 DSH 桌面插件。',
  },
  metadata: {
    categories: {
      desktop: { title: { en: 'Desktop & Apps', 'zh-cn': '桌面与应用' } },
      utility: { title: { en: 'Utilities', 'zh-cn': '工具' } },
    },
  },
  plugins: [
    {
      name: 'dsh-cookie-autoclean',
      title: { en: 'dsh-cookie-autoclean', 'zh-cn': 'DSH cookie 自动清理' },
      description: {
        en: 'Automatically purges stale dsh-auth-* loopback cookies after every client session, preventing the HTTP 431 startup failure.',
        'zh-cn': '每次会话退出后自动清理堆积的 dsh-auth-* 回环 cookie，避免 HTTP 431 启动失败。',
      },
      icon,
      author: 'Abyss-sword',
      homepage: 'https://github.com/Abyss-sword/dsh-cookie-autoclean#readme',
      repository: { url: 'https://github.com/Abyss-sword/dsh-cookie-autoclean' },
      metadata: {
        category: 'desktop',
        keywords: ['dsh', 'dsh-plugin', 'deepseek-harness', 'cookie', 'autoclean', 'desktop'],
      },
      versions: [
        {
          version,
          publishTimestamp,
          source: {
            type: 'git',
            url: 'https://github.com/Abyss-sword/dsh-cookie-autoclean',
            commit,
          },
          engines: { dsh: '>=0.2.0-rc.2 || >=0.2.1-rc.2 || >=0.2.2-rc.1' },
        },
      ],
    },
  ],
}

fs.mkdirSync(path.join(root, 'market'), { recursive: true })
fs.writeFileSync(path.join(root, 'market', 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(JSON.stringify({ file: 'market/index.json', commit, iconSourceBytes: read('icon.svg').length }))
