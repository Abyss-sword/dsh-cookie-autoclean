/**
 * DSH cookie autoclean — host plugin.
 *
 * The desktop shell mints one `dsh-auth-<base64url(sha256(host:port))>` cookie
 * on the loopback domain at every start, but never deletes old ones. Cookies
 * are not isolated by port, so every historical cookie is sent with each
 * welcome-backend request and, past roughly 70 cookies, the Cookie header
 * exceeds Node's default 16 KiB header limit and startup fails with 431
 * (`desktop welcome: Web authentication failed`).
 *
 * The cookie database is held by Chromium without shared access while the
 * client runs, and the DSH host (where plugins live) is a pure-Node child
 * process of the Electron shell, so it has no `session.cookies` handle. The
 * only writable window is after the client has fully exited — exactly when
 * in-process plugins no longer exist. The desktop shell tears down its process
 * tree on quit, so a plain child process would die with it; this plugin
 * therefore launches the exit-window helper through WMI on Windows (parent is
 * cmd.exe under WmiPrvSE, outside the app tree), with a detached spawn as the
 * portable fallback. The helper waits for the write lock, then deletes every
 * loopback dsh-auth-* cookie (with a backup) the moment the client fully exits.
 *
 * A direct in-session attempt 45 seconds after activation is kept for
 * platforms where the database is not exclusively locked (it reports busy on
 * Windows and defers to the helper).
 *
 * Only loopback `dsh-auth-*` cookies are touched; account credentials, other
 * domains, session history, and plugin configuration are left alone. Each
 * start re-mints a fresh cookie from the launch token, so deletion never
 * affects login. If the client already fails to start with 431, run the
 * manual script (dsh-cookie-cleanup) once while the client is fully exited;
 * this plugin then keeps the count at zero on every subsequent start.
 */
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanupDb, isBusyError, resolveDb } from './lib/cleaner.js'
import { appendLog } from './lib/log.js'
import { statusFile } from './lib/status.js'
import { writeStatus } from './lib/status.js'

export const name = 'dsh-cookie-autoclean'

const DELAY_MS = 45_000

const helperPath = fileURLToPath(new URL('./helper.js', import.meta.url))

/** The `.cmd` launcher started through WMI; it sets run-as-node and starts the helper. */
function launcherPath() {
  return path.join(path.dirname(statusFile()), 'dsh-cookie-autoclean-launch.cmd')
}

function spawnDetached(ctx) {
  try {
    const child = spawn(process.execPath, [helperPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    child.unref()
    appendLog(`armed via detached spawn pid=${child.pid}`)
    ctx.logger.info(`dsh-cookie-autoclean: exit-window cleaner armed (pid ${child.pid}, detached)`)
  } catch (error) {
    appendLog(`detached spawn failed: ${String(error?.message ?? error)}`)
    ctx.logger.warn(`dsh-cookie-autoclean: could not arm the exit-window cleaner (${String(error?.message ?? error)})`)
  }
}

/**
 * Windows: start the helper through WMI so it lives outside the desktop app's
 * process tree (a tree kill on quit must not take it down). Falls back to a
 * plain detached spawn when PowerShell/WMI is unavailable.
 */
function armWindows(ctx) {
  try {
    const file = launcherPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `start "" /b "${process.execPath}" "${helperPath}"`, ''].join('\r\n'),
    )
    const command = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='cmd.exe /c "${file.replace(/'/g, "''")}"'} | Out-Null`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 20_000 }, (error) => {
      if (error) {
        appendLog(`WMI arm failed, falling back: ${String(error?.message ?? error)}`)
        spawnDetached(ctx)
        return
      }
      appendLog('armed via WMI (outside the app process tree)')
    })
    ctx.logger.info('dsh-cookie-autoclean: arming exit-window cleaner via WMI')
  } catch (error) {
    appendLog(`WMI arm exception, falling back: ${String(error?.message ?? error)}`)
    spawnDetached(ctx)
  }
}

function armHelper(ctx) {
  appendLog('plugin apply: arming exit-window cleaner')
  if (process.platform === 'win32') armWindows(ctx)
  else spawnDetached(ctx)
}

export function apply(ctx) {
  try {
    armHelper(ctx)
  } catch (error) {
    appendLog(`arm failed: ${String(error?.message ?? error)}`)
    ctx.logger.warn(`dsh-cookie-autoclean: could not arm the exit-window cleaner (${String(error?.message ?? error)})`)
  }

  // Opportunistic in-session attempt, keeping the newest cookie (the one
  // minted for the current session). On Windows this reports busy; the
  // helper above does the job in the exit window.
  const timer = setTimeout(() => {
    try {
      const file = resolveDb()
      if (file === undefined) {
        ctx.logger.info('dsh-cookie-autoclean: no cookie database found; skipping the in-session attempt')
        return
      }
      const result = cleanupDb({ file, keepNewest: 1, backup: true, vacuum: true })
      ctx.logger.info(`dsh-cookie-autoclean: in-session cleanup removed ${result.removed} stale dsh-auth-* cookie(s), kept ${result.kept}`)
      writeStatus({ phase: 'in-session', ...result })
    } catch (error) {
      if (isBusyError(error)) {
        ctx.logger.info('dsh-cookie-autoclean: cookie database busy; the exit-window cleaner will handle it')
      } else {
        const message = String(error?.message ?? error)
        ctx.logger.warn(`dsh-cookie-autoclean: in-session cleanup failed (${message})`)
        writeStatus({ phase: 'error', message })
      }
    }
  }, DELAY_MS)
  // Cordis 4 effect bodies run immediately and their return value is the disposer.
  ctx.effect(() => () => clearTimeout(timer))
}
