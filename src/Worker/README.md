# Download Worker

`build/worker/worker.js`는 Electron UI와 독립적으로 실행되는 다운로드 프로그램입니다.
큐 실행, yt-dlp/ffmpeg 프로세스, 진행률, 재시작 복원, 캐시와 큐 상태 파일을
모두 Worker가 소유합니다.

## Transport

- Windows: Named Pipe (`\\.\pipe\...`)
- macOS/Linux: Unix Domain Socket (`*.sock`)
- framing: UTF-8 JSON Lines, 메시지 하나당 한 줄
- protocol version: `1`
- 연결 직후 `worker.hello` 요청으로 protocol version과 token을 검증해야 합니다.

공개 메서드는 다음과 같습니다.

- `worker.hello`
- `worker.shutdown`
- `dependency.get`
- `dependency.update-status`
- `dependency.update-check`
- `queue.get`
- `queue.enqueue`
- `queue.update`
- `queue.remove`
- `download.cancel`

큐 상태가 바뀌면 연결된 모든 인증 클라이언트에 `queue.changed` 이벤트가 전송됩니다.
정확한 wire type은 `src/Shared/workerProtocol.ts`에서 관리합니다.

## Binary updates

개발 실행·테스트는 공통 준비 스크립트가 검증한 OS/CPU별 캐시를 사용하며, 배포 앱은
`resources/binaries/<platform>-<arch>`에 기본 바이너리를 포함합니다.
`app-owned` Worker는 yt-dlp 업데이트를 사용자 데이터의 `binaries/yt-dlp`에 설치합니다.
`dependency.update-check`는 재확인을 시작하고 즉시 현재 상태를 반환합니다.
진행 중인 요청은 하나로 합쳐지며 `dependency.update-status`로 결과를 확인합니다.
실행 중인 다운로드는 기존 바이너리를 유지하고 이후 작업부터 새 버전을 사용합니다.
오프라인에서도 정상 캐시가 있으면 유지하며, 사용할 버전이 없으면 `unavailable`입니다.
외부 소유 Worker 또는 명시적 `YT_DLP_PATH`는 `managed` 상태로 자동·수동 갱신을 하지 않습니다.
FFmpeg는 시작 시 자동 갱신하지 않습니다. [빌드 문서](../../Docs/BUILD.md)를 참고하세요.

## Cookie providers

인증된 클라이언트는 `cookies.import-data`로 공급자와 독립적인 쿠키 데이터를 전달할 수 있습니다.
`site: "youtube" | "chzzk"`를 함께 전달하면 해당 사이트의 쿠키 저장소만 교체합니다.
생략 시 기존 클라이언트와 호환되도록 YouTube를 사용합니다. `cookies.import` 및
`cookies.clear`도 같은 선택적 `site`를 받고, 브라우저 추출은 옵션에 `site`를 포함합니다.
`cookies.status`의 `sites.youtube`/`sites.chzzk`에 개별 상태가 있으며 최상위 count는 합계입니다.
치지직의 `loginCookiesPresent`는 NID_AUT/NID_SES 존재 여부일 뿐 서버 인증 성공은 아닙니다.
`cookies.preview`는 계속 YouTube 쿠키만 반환합니다. 치지직 쿠키는 Worker 내부에서
해당 사이트 미리보기 추출·다운로드용 스냅샷에만 사용합니다.
`preview.resolve`의 videoId는 기존 YouTube ID, `chzzk:숫자ID`, 또는 `web:공개HTTP(S)URL`을 받습니다.
일반 사이트는 yt-dlp가 판별합니다. `site: "generic"` 쿠키 저장소는 명시적인 파일/records 가져오기만 지원하고
브라우저 전체 추출을 차단합니다. `cookies.status.sites.generic`으로 상태를 확인할 수 있습니다.
미리보기 실패에도 title/duration이 있으면 전체 영상 다운로드 범위를 구성할 수 있습니다.
URL 검사는 로컬 주소·IP 리터럴을 거부하지만 DNS 재바인딩/리다이렉트까지 차단하는 네트워크 샌드박스는 아닙니다.
`{ format: "netscape", contents: "..." }` 또는
`{ format: "records", cookies: [{ domain, path, name, value, secure, httpOnly, expirationDate }] }`
형식을 받습니다. `expirationDate`는 Unix 초이며 생략 또는 -1은 세션 쿠키입니다.
이는 Kawaikara의 쿠키 공급자를 연결하기 위한 입력 계약이며, 실제 Kawaikara 연동은 별도입니다.
현재 다운로드 서비스 범위에 맞춰 YouTube/Google 도메인만 저장하고, 매 작업은 별도 스냅샷을 사용합니다.
입력 검증 실패 시 기존 쿠키는 유지됩니다. 쿠키 값은 로그나 URL에 넣지 마세요.

`cookies.browser-status`는 선택한 브라우저의 프로세스 존재 여부를 반환합니다.
`cookies.import-browser`는 실행 중인 브라우저를 종료시키지 않고 오류로 안내합니다.
사용자가 브라우저를 완전히 종료한 뒤 명시적으로 추출을 요청해야 합니다.
`cookies.status`는 손상/접근 실패 시 예외 대신 `error: "cookies.readFailed"`를 반환하여
UI에서 `cookies.clear` 또는 다시 가져오기로 복구할 수 있게 합니다.

## Ownership and lifecycle

Downloader가 직접 실행한 Worker는 `app-owned`입니다. Downloader PID를 감시하고
소유 앱이 종료되면 Worker도 종료합니다.
macOS/Windows의 `app-owned` Worker는 시작할 때 공식 yt-dlp 안정판을 비동기로
확인하고 `state-dir/binaries/yt-dlp`에 검증한 버전을 설치합니다. 소켓 서버와 UI는
즉시 시작됩니다. 정상 캐시/번들이 있으면 바로 사용하고, 업데이트가 끝나면 이후 작업부터
새 버전을 씁니다. 정상 바이너리가 없을 때만 `dependency.get`과 다운로드가 업데이트를 기다립니다.
업데이트 실패 시 정상 캐시/번들 버전으로 복구하고, 종료 시 진행 중인 업데이트를 취소합니다.
`YT_DLP_PATH`가 설정돼 있거나 Worker가 `external-owned`이면 호스트가 지정한 바이너리를
그대로 사용합니다. 최초 설치 시 `dependency.get`의 클라이언트 타임아웃은 615초 이상을 권장합니다.

Kawaikara 같은 외부 호스트는 Worker를 `external-owned`로 실행할 수 있습니다.
이때 Downloader는 아래 환경변수로 기존 Worker에 연결하며, 종료할 때 Worker를
종료하지 않습니다.

```sh
YT_DOWNLOADER_WORKER_ENDPOINT=/path/to/worker.sock \
YT_DOWNLOADER_WORKER_TOKEN=shared-secret \
electron .
```

외부 호스트가 Worker를 실행하는 예시는 다음과 같습니다. Windows에서는
`--endpoint`에 Named Pipe 경로를 전달합니다.

```sh
YT_DOWNLOADER_WORKER_TOKEN=shared-secret node build/worker/worker.js \
  --ownership external-owned \
  --endpoint /tmp/kawaikara-downloader.sock \
  --session-id kawaikara-session \
  --state-dir /path/to/kawaikara/downloader-state \
  --cache-dir /path/to/kawaikara/downloader-cache \
  --yt-dlp-path /path/to/yt-dlp \
  --ffmpeg-path /path/to/ffmpeg \
  --node-runtime /path/to/node
```

`--owner-pid`를 함께 넘기면 외부 소유 앱의 PID도 감시할 수 있습니다. 호환을 위해
`--token`도 지원하지만 process 목록에 노출되지 않는 환경변수 사용을 권장합니다. 인증 token은
명령을 실행한 소유 앱과 연결할 클라이언트만 공유해야 합니다.
