# YT Section Downloader

Electron, TypeScript, webpack 기반 YouTube 구간 다운로드 앱입니다.

Renderer UI는 React와 로컬 `../KawaiUi` 패키지를 사용합니다. KawaiUI를 아직
배포하지 않아도 `link:../KawaiUi` 의존성으로 직접 연결되며, typecheck와 bundle
명령은 KawaiUI를 먼저 빌드합니다.

## 기능

- YouTube IFrame API 미리보기
- YouTube 기본 컨트롤과 제목 영역을 숨긴 커스텀 재생 UI
- 영상 미리보기 영역 클릭으로 재생/정지
- 영상 제목을 iframe 밖의 앱 UI로 표시
- 커스텀 타임라인으로 이동/구간 표시
- 현재 재생 위치 앵커와 긴 영상 이동 중 표시
- 시작/끝 지점 마킹
- URL을 불러오면 기본 다운로드 범위를 처음부터 끝까지 자동 지정
- `t`, `start`, `end`가 들어간 YouTube 링크의 시간대를 초기 구간으로 반영
- 한 영상에서 여러 구간을 목록으로 추가해 순차 저장
- 구간 반복 미리보기
- 다운로드 화질과 yt-dlp 다운로드 속도 제한 선택
- `yt-dlp`로 임시 다운로드 후 `ffmpeg`로 구간 컷/인코딩
- YouTube 원본 유지, H.264 MP4, Premiere ProRes, DaVinci DNxHR 출력 프리셋 선택
- 설정 뷰와 다운로드 큐 뷰 분리
- KawaiUI 기반 Panel, Input, Select, Tabs, Switch, Badge, Progress UI
- 한국어, 영어, 일본어 UI와 앱 내 언어 전환
- 큐 패널 클릭으로 URL, 선택 구간, 화질, 속도, 인코딩 프리셋 복원
- 복원한 큐에 새 구간만 추가하고 완료 구간은 중복 다운로드에서 제외
- 앱 종료 시 큐와 구간별 완료 상태를 저장하고 yt-dlp 부분 파일부터 자동 재개

## 준비

```sh
pnpm install
```

앱은 기본으로 `thirdparty/bin/<platform>`에 들어있는 `yt-dlp`와 `ffmpeg`를 사용합니다.
다른 바이너리를 쓰고 싶다면 환경변수로 직접 지정할 수 있습니다.
YouTube의 JavaScript challenge 처리를 위해 yt-dlp `2025.11.12` 이상이 필요하며,
앱은 Electron에 내장된 Node.js 런타임을 yt-dlp에 자동으로 연결합니다.

```sh
YT_DLP_PATH=/path/to/yt-dlp FFMPEG_PATH=/path/to/ffmpeg pnpm dev
```

## 실행

```sh
pnpm dev
```

`pnpm dev`는 TypeScript 소스를 webpack 개발 모드로 번들링한 뒤 Electron을 실행합니다.
소스 변경을 계속 번들링하려면 별도 터미널에서 다음 명령을 사용할 수 있습니다.

```sh
pnpm watch
```

타입 검사만 실행하려면 다음 명령을 사용합니다.

```sh
pnpm typecheck
```

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
- `src/Renderer/app.ts`: YouTube 플레이어와 화면 상태를 연결하고 Main에 요청을 보내는 Renderer 어댑터
- `src/Main`: Worker를 시작하거나 외부 Worker에 연결하고 Renderer IPC를 전달하는 호스트 어댑터
- `src/Worker`: UI와 독립된 다운로드 엔진, 큐, 캐시, 상태 저장과 로컬 소켓 서버
- `src/Shared/workerProtocol.ts`: Downloader와 Kawaikara 같은 외부 호스트가 공유할 Worker wire protocol

Renderer의 TSX에서는 raw `div`, `span`, `button`, `input` 등을 직접 작성하지 않고
KawaiUI의 `Box`, `Text`, `Button`, `Input`, `Slider` 같은 공개 컴포넌트만 조합합니다.
다운로드 실행과 큐 저장은 Renderer나 Electron Main이 직접 처리하지 않습니다.
Renderer 요청은 Main의 Worker client를 거쳐 독립 Worker로 전달되고, 상태는
`queue.changed` 이벤트로 돌아옵니다. 기본 실행에서는 Downloader가 Worker를 소유하지만,
`YT_DOWNLOADER_WORKER_ENDPOINT`와 `YT_DOWNLOADER_WORKER_TOKEN`을 지정하면 외부 앱이
소유한 Worker에 연결하며 Downloader 종료 시 그 Worker를 종료하지 않습니다.

## 빌드

```sh
pnpm build
```

webpack 결과물은 `build`에 생성되고 Windows 설치 파일과 portable 실행 파일은 `dist`에 생성됩니다.
GitHub Actions의 `Build` 워크플로도 타입 검사와 webpack 번들링 후 `dist` 산출물을 artifact로 업로드합니다.

## 단축키

- `Space`: 재생/정지
- `A`: 시작 지점 찍기
- `S`: 끝 지점 찍기
- `←` / `→`: 1초 이동
- `Shift + ←` / `Shift + →`: 5초 이동

다운로드는 권리가 있거나 허용된 콘텐츠에만 사용하세요.
