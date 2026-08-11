# YT Section Downloader

Electron 기반 YouTube 구간 다운로드 앱입니다.

## 기능

- YouTube IFrame API 미리보기
- YouTube 기본 컨트롤과 제목 영역을 숨긴 커스텀 재생 UI
- 영상 제목을 iframe 밖의 앱 UI로 표시
- 커스텀 타임라인으로 이동/구간 표시
- 시작/끝 지점 마킹
- 구간 반복 미리보기
- `yt-dlp`로 임시 다운로드 후 `ffmpeg`로 구간 컷
- 정확 컷(`libx264/aac`)과 빠른 컷(`-c copy`) 선택

## 준비

```sh
pnpm install
brew install yt-dlp ffmpeg
```

`yt-dlp`나 `ffmpeg`가 PATH에 없다면 환경변수로 직접 지정할 수 있습니다.

```sh
YT_DLP_PATH=/path/to/yt-dlp FFMPEG_PATH=/path/to/ffmpeg pnpm dev
```

## 실행

```sh
pnpm dev
```

## 단축키

- `Space`: 재생/정지
- `A`: 시작 지점 찍기
- `S`: 끝 지점 찍기
- `←` / `→`: 1초 이동
- `Shift + ←` / `Shift + →`: 5초 이동

다운로드는 권리가 있거나 허용된 콘텐츠에만 사용하세요.
