# 개발 구조와 검증

[README](../README.md) · [빌드 및 바이너리](BUILD.md) · [상세 사용법](USAGEKR.md)

Renderer UI는 React와 GitHub 커밋에 고정된 KawaiUI 패키지의 빌드 산출물을 사용합니다.
별도 `../KawaiUi` 체크아웃이나 개발 PC의 절대 경로는 필요하지 않습니다.
아직 upstream에 포함되지 않은 NumberInput은 앱 내부 컴포넌트로 유지합니다.

## 다국어 카탈로그

화면과 다운로드 진행 메시지는 `src/Shared/locales`의 JSON 파일에서 관리합니다.

- `ko.json`: 한국어
- `en.json`: 영어
- `ja.json`: 일본어

세 파일은 동일한 번역 키를 가져야 합니다. 빌드할 때 JSON 카탈로그는
`build/renderer/locales`로 복사되며 Renderer와 Main 프로세스가 같은 파일을
사용합니다. 마지막으로 선택한 언어는 저장되어 다음 실행에도 유지됩니다.

## UI와 프로세스 구조

- `src/Renderer/Components`: KawaiUI Primitive와 Component를 조합한 최소 UI 단위
- `src/Renderer/Views`: Component를 조합해 사용자가 보는 화면을 구성하는 단위
- `src/Renderer/app.ts`: 공통 미디어 플레이어와 화면 상태를 연결하고 Main에 요청을 보내는 Renderer 어댑터
- `src/Main`: Worker를 시작하거나 외부 Worker에 연결하고 Renderer IPC를 전달하는 호스트 어댑터
- `src/Worker`: UI와 독립된 다운로드 엔진, 큐, 캐시, 상태 저장과 로컬 소켓 서버
- `src/Shared/workerProtocol.ts`: Downloader와 Kawaikara 같은 외부 호스트가 공유할 Worker wire protocol

Renderer UI는 KawaiUI의 `Box`, `Text`, `Button`, `Input`, `Slider` 같은 공개 컴포넌트를
중심으로 구성하며 앱 전용 레이아웃과 상호작용 코드를 함께 사용합니다.
다운로드 실행과 큐 저장은 Renderer나 Electron Main이 직접 처리하지 않습니다.
Renderer 요청은 Main의 Worker client를 거쳐 독립 Worker로 전달되고, 상태는
`queue.changed` 이벤트로 돌아옵니다. 기본 실행에서는 Downloader가 Worker를 소유하지만,
`YT_DOWNLOADER_WORKER_ENDPOINT`와 `YT_DOWNLOADER_WORKER_TOKEN`을 지정하면 외부 앱이
소유한 Worker에 연결하며 Downloader 종료 시 그 Worker를 종료하지 않습니다.

### 창 타이틀바

앱이 상단 브랜드·드래그 영역을 그리고, 창 버튼은 Electron 네이티브 오버레이를 사용합니다.
Windows의 최소화·최대화·닫기와 macOS의 신호등 버튼을 OS 배치 그대로 유지합니다.
macOS에서 메뉴 없이도 `⌘A/C/V/X/Z`, `⇧⌘Z`, `⌘W/Q` 단축키를 사용할 수 있습니다.
타이틀바·탭 높이를 변경할 때는 `src/Main/WindowChrome.ts`와 `src/Renderer/styles.css`를
함께 수정하세요. `pnpm test:windows`로 설정·단축키·편집 영역 배치를 검사할 수 있습니다.
번들 생성 후 `pnpm exec electron tests/window-chrome-smoke.cjs`는 모의 데이터로 실제 창을
열어 배치·최대화·최소화·큐 닫기를 검사합니다. 쿠키나 다운로드 Worker는 사용하지 않습니다.

## 테스트

먼저 `pnpm bundle:prod`로 실행용 번들을 생성합니다. 바이너리가 필요한 테스트와 진단은
`tests/binaries.cjs`를 통해 개발 실행·패키징과 같은 준비 스크립트와 캐시를 사용합니다.
최초 실행에는 다운로드가 필요하며 이후 검증된 캐시를 재사용합니다.
`YT_DLP_PATH`·`FFMPEG_PATH`로 직접 지정할 수도 있습니다. [빌드 문서](BUILD.md)를 참고하세요.

```sh
pnpm test:build
pnpm test:worker
pnpm test:cookies
pnpm test:updater
pnpm test:sites
pnpm test:windows
node --require ts-node/register/transpile-only --test tests/*.test.cjs
python3 tests/chzzk-plugin.test.py
pnpm exec electron tests/segment-sidebar-ui.cjs
pnpm exec electron tests/chzzk-hls-cookies-ui.cjs
pnpm exec electron tests/yt-dlp-update-ui.cjs
```

Python은 호환 플러그인의 오프라인 단위 테스트용이며 배포 앱의 별도 런타임 의존성이 아닙니다.

### 선택적 공개망 테스트

```sh
pnpm exec electron tests/chzzk-network-ui.cjs --network --download
pnpm exec electron tests/chzzk-network-ui.cjs --network --download --video-id=15639975
```

공개 영상 1980 또는 지정한 다시보기의 미리보기와 3초 구간 다운로드를 검사합니다.
`--download` 검증에는 PATH의 `ffprobe`가 필요합니다. 실제 브라우저 쿠키를 읽지 않으며
생성한 임시 미디어는 테스트 종료 시 정리합니다. 영상 공개 상태와 외부 서비스에 따라 실패할 수 있습니다.

Worker 실행·연동 프로토콜은 [Worker README](../src/Worker/README.md)를 참고하세요.
## 공통 플레이어·긴 영상 회귀 검사

YouTube를 포함한 모든 소스는 `PreviewResolver` → `NativePreview` 경로를 사용합니다.
`TimelineScale`은 표시 구간과 화면 폭으로 눈금 간격을 결정합니다. 렌더러는 드래그 중인 목표 위치를 유지하며,
미디어의 `seeking`이 끝나고 목표 시간에 도달했을 때만 플레이헤드를 재생 시간에 동기화합니다.
길이 메타데이터 갱신은 재생 위치를 초기화하지 않습니다.

```sh
node --require ts-node/register/transpile-only --test tests/native-preview.test.cjs tests/timeline-scale.test.cjs tests/preview-resolver.test.cjs
pnpm bundle:renderer:dev
pnpm exec electron tests/long-timeline-smoke.cjs --screenshot
pnpm exec electron tests/timeline-keyboard-smoke.cjs
pnpm exec electron tests/timeline-markers-smoke.cjs
pnpm exec electron tests/timeline-controls-smoke.cjs --screenshot
node --require ts-node/register/transpile-only --test tests/timeline-interaction.test.cjs
```

긴 영상 검사는 실제 렌더러와 Electron 레이아웃에서 100시간·640/900/1440px 조건, 지연 탐색,
연속 탐색, 길이 갱신, 확대 후 좌표 매핑을 확인합니다. 미디어 타이밍은 테스트에서 모의합니다.
실제 네트워크 재생 확인은 `pnpm exec electron tests/native-preview-ui-diagnostic.cjs --video=VIDEO_ID`로 별도 실행합니다.
이 진단은 쿠키를 읽지 않으며 재생·80% 위치 탐색·캐시 재사용을 검사하고 영상 파일을 저장하지 않습니다.
