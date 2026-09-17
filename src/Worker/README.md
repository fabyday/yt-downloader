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
- `queue.get`
- `queue.enqueue`
- `queue.update`
- `queue.remove`
- `download.cancel`

큐 상태가 바뀌면 연결된 모든 인증 클라이언트에 `queue.changed` 이벤트가 전송됩니다.
정확한 wire type은 `src/Shared/workerProtocol.ts`에서 관리합니다.

## Ownership

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
