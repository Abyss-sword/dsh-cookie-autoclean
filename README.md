# DSH cookie autoclean (plugin, v2.2)

**[English](README.md) | [简体中文](README.zh.md)**

A DSH desktop plugin that automatically purges accumulated `dsh-auth-*` loopback cookies
after every session, preventing the startup failure
`desktop welcome: Web authentication failed` (HTTP 431).

## Install

```powershell
git clone https://github.com/Abyss-sword/dsh-cookie-autoclean.git
# Install the bundle through DSH Plugin Manager and point it at the directory, or:
dsh --profile desktop plugin add dsh-cookie-autoclean
```

The plugin arms its exit-window helper on every start; no configuration is needed.
Remove the bundle through Plugin Manager to uninstall.

## Self-hosted plugin-market index

The repository ships a format-1 market index at [market/index.json](market/index.json)
(the icon is embedded as a data URL, so nothing else needs hosting). Add it to your
DSH plugin market's index list to browse and install from the Discover page:

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes:
      - https://cdn.jsdelivr.net/gh/Abyss-sword/dsh-cookie-autoclean@main/market/index.json
```

`raw.githubusercontent.com` works too; jsDelivr is the mirror. The index pins a git
commit — after publishing a new version, re-run `node scripts/gen-market-index.mjs`
and commit the update (`scripts/validate-market-index.mjs` validates it against the
official format-1 rules).

## Why in-process cleanup is impossible

- While the client runs, Chromium holds the cookie database (`Network\Cookies`)
  without shared read access — nobody else can open it.
- Host plugins run inside a pure-Node child process of the Electron shell and have
  no `session.cookies` handle.
- The only writable window is after the client has fully exited — exactly when the
  in-process plugin no longer exists.

## How it works (fully automatic)

1. **Exit-window helper (main path)**: on every start the plugin spawns a standalone
   `helper.js`. It polls the SQLite write lock every 3 seconds; once the client fully
   exits and the lock is released, it backs up the database, deletes **all** loopback
   (`127.0.0.1` / `localhost` / `[::1]`) `dsh-auth-*` cookies, and exits. The next
   start re-mints a fresh cookie, so deleting all of them is safe.
2. **Outside the app process tree (critical)**: the desktop shell tears down its
   process tree on quit, which would kill an ordinary detached child. On Windows the
   helper is therefore started through **WMI (`Invoke-CimMethod Win32_Process.Create`)**:
   its parent is cmd.exe / WmiPrvSE, outside the app tree, so a tree kill on quit
   cannot take it down. When PowerShell/WMI is unavailable it falls back to a detached
   spawn.
3. **Opportunistic in-session attempt (fallback)**: 45 seconds after activation it
   tries an in-process cleanup keeping the newest cookie. On Windows this always
   reports busy and defers to the helper; on platforms with a permissive lock it works
   immediately.

Safety boundaries match the manual script: only loopback `dsh-auth-*` cookies are
touched; the write starts with `BEGIN IMMEDIATE` on the database, a timestamped backup
(including `-wal`/`-shm`/`-journal`) is taken first, and the schema is checked before
any write. Account credentials, sessions, and plugin configuration are never touched.

## Verifying

The result is written to `%APPDATA%\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json`;
the full timeline goes to `dsh-cookie-autoclean.log` in the same directory
(every start, wait, cleanup, and error is logged).

Status file example:

```json
{
  "phase": "armed",              // armed = helper waiting for exit; cleaned = exit window cleaned; error
  "pid": 15340,
  "armedAt": "2026-11-11T08:58:48.805Z",
  "lastClean": {                 // summary of the last cleanup that actually removed rows (kept across restarts)
    "cleanedAt": "2026-11-11T08:39:37.010Z",
    "removed": 1,
    "total": 1,
    "db": "...\\Network\\Cookies",
    "backup": "...\\Cookies.bak-20261111-083936"
  }
}
```

Ways to check:

1. Read the status file:
   `Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json"`
2. Read the log:
   `Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.log" -Tail 20`
3. After fully exiting the client, verify with a read-only script:
   `node dsh-cookie-cleanup\clean-dsh-cookies.mjs --dry-run` (should show 0 `dsh-auth` rows)
4. Look at the backups: each `Network\Cookies.bak-<timestamp>` is one cleanup snapshot.

## Limits and troubleshooting

- **Quit the client from the tray icon → Quit**; closing the window only hides it to
  the tray and keeps the database locked.
- If the client already fails to start with 431, plugins never load: fully exit the
  client and run `dsh-cookie-cleanup\clean-dsh-cookies.mjs --yes` once; every later
  start is cleaned automatically.
- If the log shows `helper start` but never `cleaned` after quitting, the helper did
  not get the lock or was killed — open an Issue with the log tail (and check for
  leftover `DeepSeek Harness.exe` processes).
- **Only the 10 most recent backups are kept**; older ones are pruned automatically.
- A helper that never finds the cookie database (e.g. installed on a non-desktop
  profile) exits after 10 minutes.
- The 45-second in-session attempt is only a fallback: on Windows the database is
  exclusively locked, so it reports busy and the exit-window helper does the work.

## Configuration layer (removed)

A profile override of `connection.cookieMaxAgeDays` was tried and reverted:
`dsh-client-connection`'s `authenticate()` validates the `expiresAt` signed into the
cookie, and with no automatic re-authentication path a client left running longer
than the configured lifetime starts receiving 401s. The plugin now relies entirely on
"purge at every exit" — each session ends with zero cookies and the next start mints
exactly one.

## Compatibility and disclaimer

- Depends on unpublished implementation details of the DSH desktop client (Chromium
  cookie-store layout, `dsh-auth-*` naming, process-tree teardown on quit, and the fact
  that WMI-started processes are outside the app tree). **DSH upgrades may change this
  behaviour**; check the log to confirm `cleaned` still appears.
- Fully validated on Windows only (WMI path); macOS/Linux use the detached-spawn
  fallback and are untested.
- The plugin only deletes loopback `dsh-auth-*` cookies and never touches account
  credentials, sessions, or configuration; it backs up the database before writing.

## License

[MIT](LICENSE) © 2026 Abyss-sword
