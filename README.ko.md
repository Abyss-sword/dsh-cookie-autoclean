# DSH cookie autoclean (플러그인, v2.2)

**[English](README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [简体中文](README.zh.md)**

DSH 데스크톱 플러그인입니다. 세션이 끝날 때마다 누적되는 `dsh-auth-*` 루프백 쿠키를 자동으로 정리하여,
시작 시 `desktop welcome: Web authentication failed`(HTTP 431) 오류가 발생하는 것을 막습니다.

## 설치

```powershell
git clone https://github.com/Abyss-sword/dsh-cookie-autoclean.git
# DSH Plugin Manager에서 이 디렉터리를 지정해 bundle을 설치하거나, 다음을 실행:
dsh --profile desktop plugin add dsh-cookie-autoclean
```

설치하면 시작할 때마다 종료 창구용 헬퍼가 자동으로 대기합니다. 설정은 필요 없습니다.
제거는 Plugin Manager에서 이 bundle을 삭제하면 됩니다.

## 자체 플러그인 마켓 인덱스

저장소에는 format 1 형식의 마켓 인덱스 [market/index.json](market/index.json)이 포함되어 있습니다
(아이콘은 data URL로 내장되어 있어 다른 것을 호스팅할 필요가 없습니다). DSH 플러그인 마켓의
인덱스 목록에 추가하면 Discover 페이지에서 둘러보고 설치할 수 있습니다:

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes:
      - https://cdn.jsdelivr.net/gh/Abyss-sword/dsh-cookie-autoclean@main/market/index.json
```

`raw.githubusercontent.com`도 동작합니다(미러는 jsDelivr). 인덱스는 git 커밋에 고정되어 있습니다.
새 버전을 배포한 뒤에는 `node scripts/gen-market-index.mjs`를 다시 실행해 커밋하세요
(`scripts/validate-market-index.mjs`가 공식 format 1 규칙으로 검증합니다).

## 프로세스 안에서 정리할 수 없는 이유

- 클라이언트가 실행 중일 때 Chromium이 쿠키 데이터베이스(`Network\Cookies`)를 공유 읽기가 불가능한 형태로
  점유하고 있어 다른 프로세스는 열 수 없습니다.
- 호스트 플러그인은 Electron 셸의 순수 Node 자식 프로세스 안에서 동작하므로 `session.cookies` 핸들이 없습니다.
- 쓰기가 가능한 시점은 클라이언트가 완전히 종료된 뒤뿐인데, 그때는 플러그인 프로세스 자체가 이미 존재하지 않습니다.

## 동작 방식 (완전 자동)

1. **종료 창구용 헬퍼(주 경로)**: 시작할 때마다 독립적인 `helper.js`를 생성합니다. 3초마다 SQLite 쓰기
   잠금을 얻을 수 있는지 확인하고, 클라이언트가 완전히 종료되어 잠금이 풀리면 데이터베이스를 백업한 뒤
   루프백(`127.0.0.1` / `localhost` / `[::1]`) `dsh-auth-*` 쿠키를 **전부** 삭제하고 종료합니다.
   다음 시작 시 새 쿠키가 다시 발급되므로 전부 삭제해도 로그인에 영향이 없습니다.
2. **앱 프로세스 트리 밖에서 실행(중요)**: 데스크톱 셸은 종료 시 프로세스 트리를 일괄 종료하므로 일반
   detached 자식 프로세스는 함께 죽습니다. 그래서 Windows에서는 헬퍼를
   **WMI(`Invoke-CimMethod Win32_Process.Create`)**로 실행합니다. 부모가 cmd.exe / WmiPrvSE가 되어
   앱 트리 밖에 있으므로 종료 시의 트리 킬로 죽지 않습니다. PowerShell/WMI를 쓸 수 없으면
   detached spawn으로 폴백합니다.
3. **시작 직후 시도(폴백)**: 활성화 45초 후 가장 최신 쿠키를 남기는 방식으로 프로세스 안 정리를 시도합니다.
   Windows에서는 항상 busy가 되어 헬퍼에 맡기지만, 잠금이 느슨한 환경에서는 즉시 실행됩니다.

안전 경계는 수동 스크립트와 같습니다. 손대는 것은 루프백 `dsh-auth-*` 쿠키뿐입니다. 쓰기는 데이터베이스의
`BEGIN IMMEDIATE`로 시작하고, 타임스탬프 백업(`-wal`/`-shm`/`-journal` 포함)을 먼저 만든 뒤
스키마를 확인하고 씁니다. 계정 자격 증명, 세션, 플러그인 설정은 절대 건드리지 않습니다.

## 확인 방법

결과는 `%APPDATA%\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json`에 기록되고,
자세한 타임라인은 같은 디렉터리의 `dsh-cookie-autoclean.log`에 남습니다
(시작·대기·정리·오류가 모두 기록됩니다).

상태 파일 예시:

```json
{
  "phase": "armed",              // armed = 종료를 기다리는 헬퍼 대기 중. cleaned = 종료 창구에서 정리됨. error = 오류
  "pid": 15340,
  "armedAt": "2026-11-11T08:58:48.805Z",
  "lastClean": {                 // 실제로 행을 삭제한 최근 정리의 요약(재시작을 넘어 유지)
    "cleanedAt": "2026-11-11T08:39:37.010Z",
    "removed": 1,
    "total": 1,
    "db": "...\\Network\\Cookies",
    "backup": "...\\Cookies.bak-20261111-083936"
  }
}
```

확인 방법:

1. 상태 파일 읽기:
   `Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json"`
2. 로그 읽기:
   `Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.log" -Tail 20`
3. 클라이언트를 완전히 종료한 뒤 읽기 전용 스크립트로 확인:
   `node dsh-cookie-cleanup\clean-dsh-cookies.mjs --dry-run` (`dsh-auth`가 0행이어야 함)
4. 백업 보기: 각 `Network\Cookies.bak-<timestamp>`는 한 번의 정리 스냅샷입니다.

## 제한 사항 및 문제 해결

- **클라이언트는 트레이 아이콘 → 종료로 닫으세요**. 창만 닫으면 트레이로 숨겨질 뿐이고
  데이터베이스는 계속 잠겨 있습니다.
- 이미 431로 시작할 수 없다면 플러그인이 로드되지 않습니다. 클라이언트를 완전히 종료한 뒤
  `dsh-cookie-cleanup\clean-dsh-cookies.mjs --yes`를 한 번 실행하세요. 이후 시작은 자동으로 정리됩니다.
- 종료 후 로그에 `helper start`는 있는데 `cleaned`가 없다면 헬퍼가 잠금을 얻지 못했거나 종료된 것입니다.
  로그 마지막 부분을 붙여 Issue를 열어주세요(`DeepSeek Harness.exe` 잔여 프로세스도 확인하세요).
- **백업은 최근 10개만 유지**되며 더 오래된 것은 자동 삭제됩니다.
- 쿠키 데이터베이스를 찾지 못하는 헬퍼(예: 비데스크톱 프로필에 설치한 경우)는 10분 후 자동 종료됩니다.
- 45초 후의 프로세스 내 시도는 폴백입니다. Windows에서는 데이터베이스가 배타적 잠금 상태라 busy가 되고,
  실제 정리는 종료 창구용 헬퍼가 수행합니다.

## 설정 레이어 (제거됨)

프로필의 `connection.cookieMaxAgeDays`를 줄이는 우회를 시도했지만 되돌렸습니다.
`dsh-client-connection`의 `authenticate()`는 쿠키에 서명된 `expiresAt`을 검증하고 자동 재인증 경로가 없어,
설정한 일수보다 오래 클라이언트를 켜 두면 401이 시작됩니다. 지금은 "종료할 때마다 정리"에만 의존합니다.
각 세션은 쿠키 0개로 끝나고 다음 시작에서 정확히 1개만 발급됩니다.

## 호환성 및 면책

- DSH 데스크톱 클라이언트의 비공개 구현 세부 사항에 의존합니다(Chromium 쿠키 저장소 레이아웃, `dsh-auth-*` 명명,
  종료 시 프로세스 트리 해체, WMI로 시작한 프로세스가 앱 트리 밖이라는 점). **DSH 업그레이드로 동작이 바뀔 수
  있으므로** 로그에서 `cleaned`가 계속 나오는지 확인하세요.
- 완전히 검증한 것은 Windows뿐입니다(WMI 경로). macOS/Linux는 detached spawn 폴백을 사용하며 미검증입니다.
- 플러그인은 루프백 `dsh-auth-*` 쿠키만 삭제하고 계정 자격 증명·세션·설정은 건드리지 않습니다.
  쓰기 전에 데이터베이스를 백업합니다.

## License

[MIT](LICENSE) © 2026 Abyss-sword
