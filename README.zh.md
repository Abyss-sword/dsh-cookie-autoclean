# DSH cookie autoclean（插件版，v2.2）

**[English](README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [简体中文](README.zh.md)**

DSH 桌面插件：**每次会话结束后自动清理**堆积的 `dsh-auth-*` 回环 cookie，避免启动时报
`desktop welcome: Web authentication failed`（HTTP 431）。

## 安装

```powershell
git clone https://github.com/Abyss-sword/dsh-cookie-autoclean.git
# 在 DSH 插件管理里安装 bundle 并指向该目录，或：
dsh --profile desktop plugin add dsh-cookie-autoclean
```

安装后会自动挂起退出窗口守护进程，无需任何配置。卸载用 Plugin Manager 移除该 bundle 即可。

## 自建插件市场索引

本仓库自带一个 format 1 的市场索引 [market/index.json](market/index.json)（图标以 data URL 内嵌，不依赖外链）。
把它加入 DSH 插件市场的索引列表，即可在 Discover 页浏览并一键安装：

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes:
      - https://cdn.jsdelivr.net/gh/Abyss-sword/dsh-cookie-autoclean@main/market/index.json
```

`raw.githubusercontent.com` 同路径也可，国内镜像推荐 jsDelivr。索引里的版本固定到 git commit；
发布新版本时重跑 `node scripts/gen-market-index.mjs` 并提交（`scripts/validate-market-index.mjs` 按官方
format 1 规则校验）。

## 原理（为什么不能在启动时直接删）

- 客户端运行时，Chromium 以「不给共享读」的方式独占 cookie 库（`Network\Cookies`），谁也别想打开；
- 宿主插件跑在 Electron 的纯 Node 模式子进程里，拿不到 `session.cookies` 句柄；
- 所以可写的时机只有「客户端完全退出后」——而那一刻插件进程自己已经不存在了。

## 本插件的做法（全自动）

1. **退出窗口守护进程（主路径）**：插件每次启动时启动一个独立守护进程 `helper.js`，
   它每 3 秒尝试拿一次 SQLite 独占写锁；客户端一旦完全退出、锁释放，它立即先备份、
   再删除回环域（127.0.0.1 / localhost / [::1]）下**全部** `dsh-auth-*` cookie，然后退出。
   下次启动会重新签发新 cookie，全删不影响登录。
2. **脱离应用进程树（关键）**：桌面客户端退出时会**按进程树清理**，普通 detached 子进程会被一起杀掉。
   所以守护进程在 Windows 上通过 **WMI（`Invoke-CimMethod Win32_Process.Create`）** 启动，
   父进程是 cmd.exe / WmiPrvSE，**不在应用的进程树里**，客户端退出杀不掉它。
   PowerShell/WMI 不可用时自动降级为 detached spawn。
3. **启动后顺手试一次（兜底）**：激活 45 秒后尝试在线清理（保留最新一条=当前会话的 cookie）；
   Windows 上这一步只会得到 busy 并让位给守护进程，在锁不严的平台上则当场生效。

安全边界与手动脚本一致：只动回环域 `dsh-auth-*` 前缀的 cookie，写库前先 `BEGIN IMMEDIATE` 拿锁、
先备份（含 -wal/-shm/-journal）、表结构自检通过才写。账号凭据、会话、插件配置一律不碰。

## 验证方法

清理结果写到 `%APPDATA%\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json`；
完整时间线写到同目录 `dsh-cookie-autoclean.log`（每次启动/等待/清理/出错都有记录）。

状态文件示例：

```json
{
  "phase": "armed",              // armed=守护进程已挂起等待客户端退出；cleaned=本次退出已清库；error=出错
  "pid": 15340,
  "armedAt": "2026-11-11T08:58:48.805Z",
  "lastClean": {                 // 最近一次「真的删了东西」的清理摘要（跨重启保留）
    "cleanedAt": "2026-11-11T08:39:37.010Z",
    "removed": 1,
    "total": 1,
    "db": "...\\Network\\Cookies",
    "backup": "...\\Cookies.bak-20261111-083936"
  }
}
```

查看方式：

1. 直接看状态文件：`Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json"`
2. 看日志：`Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.log" -Tail 20`
3. 完全退出客户端后，用脚本只读复查：`node dsh-cookie-cleanup\clean-dsh-cookies.mjs --dry-run`（应显示 0 条）
4. 看备份：`Network\Cookies.bak-<时间戳>` 每个文件 = 一次清库现场

## 边界与排查

- **退出客户端请用托盘图标 → 退出**，别只关窗口（关窗口只是收进托盘，进程还在跑，库一直锁着）；
- 客户端**已经**启动报 431（进不去）：插件还没机会加载，先完全退出客户端，
  用 `dsh-cookie-cleanup\clean-dsh-cookies.mjs --yes` 清一次，之后每次都会自动清；
- 日志里出现 `helper start` 但客户端退出后没有 `cleaned`：说明守护进程没抢到锁或被杀，
  把日志内容发到 Issues 排查（同时看进程树里还有没有 `DeepSeek Harness.exe` 残留）；
- **备份自动保留最近 10 个**，更早的自动删除，不会无限增长；
- 守护进程找不到 cookie 库（例如误装到非桌面 profile）时，10 分钟后自动退出，不会永久挂起；
- 「启动 45 秒后在线清一次」是**兜底**：Windows 上库被 Chromium 独占，必然得到 busy（日志可见），
  真正干活的是退出窗口的守护进程。

## 配置层（已取消）

曾把 profile 的 `connection.cookieMaxAgeDays` 调小作为兜底，**已回滚**：`dsh-client-connection`
的 `authenticate()` 会校验 cookie 内签名的 `expiresAt`，客户端连续开着超过该天数会开始 401 且无自动重认证，
副作用大于收益。现在完全依赖「每次退出清空」——每 session 结束时 cookie 被清光，下次启动只签发 1 条。

## 兼容性与免责

- 依赖 DSH 桌面客户端的未公开实现细节（Chromium cookie 库布局、`dsh-auth-*` 命名、
  进程树退出行为、WMI 启动不受进程树影响）。**DSH 升级后这里的行为可能变化**，
  请先看日志确认是否仍然 `cleaned`。
- 只在 Windows 上完整验证（WMI 路径）；macOS/Linux 走 detached spawn 兜底路径，未实测。
- 插件只读删回环域 `dsh-auth-*` cookie，不碰账号凭据、会话与配置；写库前先备份。

## License

[MIT](LICENSE) © 2026 Abyss-sword
