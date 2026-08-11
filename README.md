# YT Section Downloader

Electron 기반 YouTube 구간 다운로드 앱입니다.

## 기능

- YouTube IFrame API 미리보기
- YouTube 기본 컨트롤과 제목 영역을 숨긴 커스텀 재생 UI
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

## 준비

```sh
pnpm install
```

앱은 기본으로 `thirdparty/bin/<platform>`에 들어있는 `yt-dlp`와 `ffmpeg`를 사용합니다.
다른 바이너리를 쓰고 싶다면 환경변수로 직접 지정할 수 있습니다.

```sh
YT_DLP_PATH=/path/to/yt-dlp FFMPEG_PATH=/path/to/ffmpeg pnpm dev
```

## 실행

```sh
pnpm dev
```

## 빌드

```sh
pnpm build
```

GitHub Actions의 `Build` 워크플로가 Windows 패키지를 만들고 `dist` 산출물을 artifact로 업로드합니다.

## 단축키

- `Space`: 재생/정지
- `A`: 시작 지점 찍기
- `S`: 끝 지점 찍기
- `←` / `→`: 1초 이동
- `Shift + ←` / `Shift + →`: 5초 이동

다운로드는 권리가 있거나 허용된 콘텐츠에만 사용하세요.
