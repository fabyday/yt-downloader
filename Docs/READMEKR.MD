# kawai-downloader

yt-dlp로 영상을 불러오고, 원하는 구간을 정밀하게 선택해 다운로드하는 macOS·Windows 데스크톱 앱입니다.

[English](../README.md)

## 주요 기능

- 영상 미리보기, 시작·끝 지정, 여러 구간 저장
- 화질·속도·출력 형식을 설정하는 다운로드 큐
- 원본 유지, 편집용 출력 프리셋, 수동 FFmpeg 옵션
- 단축키 변경, 사이트별 쿠키 가져오기, 한국어·영어·일본어 UI

## 설치

### macOS

**Mac은 아래 설치 스크립트를 사용하세요.** Apple Silicon/Intel을 자동 구분하여 내려받고 설치합니다.
Rosetta에서 실행해도 Apple Silicon 기종을 감지합니다.

```sh
curl --fail --location --proto '=https' --proto-redir '=https' \
  https://raw.githubusercontent.com/fabyday/yt-downloader/main/install-mac.sh -o install-mac.sh
# 실행 전에 스크립트를 확인하세요. 아래 설치 명령 중 하나를 선택합니다.
bash install-mac.sh                 # 최신 공개 정식 버전
bash install-mac.sh 0.1.0           # 특정 공개 버전 (예시)
# bash install-mac.sh --version v0.1.0
```

공개된 사전 출시 버전도 버전 인자로 지정할 수 있습니다. Draft는 설치할 수 없습니다.
릴리스 매니페스트의 SHA-256을 검증하고 `~/Applications/kawai-downloader.app`에 설치합니다.
기존 앱은 삭제하지 않고 출력된 백업 경로에 보존합니다. 업데이트 전 앱을 완전히 종료하고,
**sudo 없이** 실행하세요. 쓰기 권한이 있다면 `--dir /Applications`, 또는 원하는 절대 경로를 지정할 수 있습니다.

설치 시 기본적으로 **해당 앱의 `com.apple.quarantine` 속성만 제거**합니다.
이는 quarantine에 따른 최초 실행 검사를 우회하는 것이며, Apple 서명·공증이나 안전성을 보장하지 않습니다.
저장소와 배포자를 신뢰할 때만 사용하세요. 체크섬도 배포자 자체의 신뢰성을 보증하지는 않습니다.
보안 속성을 유지하려면 `--keep-quarantine`을 추가하세요. 설치 후 앱은 자동 실행하지 않습니다.
[Apple 보안 안내](https://support.apple.com/ko-kr/102445)

### Windows

[Releases](https://github.com/fabyday/yt-downloader/releases)에서 CPU에 맞는 x64/ARM64 Setup 또는 Portable EXE를 받으세요.

## 사용법

1. 앱을 열고 yt-dlp가 지원하는 개별 영상 주소를 입력합니다.
2. **불러오기**를 누르고 시작·끝을 지정합니다. 여러 구간은 **구간 추가**로 저장합니다.
3. **다운로드**에서 저장 폴더와 출력 설정을 고른 뒤 큐에 추가합니다.
4. **Space**로 재생·정지, **A/S**로 시작·끝 지정, **Q/W/E**로 구간 규칙을 변경합니다.
5. 로그인이 필요한 영상은 **환경설정 → 쿠키**에서 해당 사이트의 쿠키를 가져옵니다. 계정에 영상 시청 권한이 있어야 합니다.

영상 옆 구간 목록은 **구간 목록 보기**로 켜고 끕니다. 단축키는 환경설정에서 변경하거나 기본값으로 복원할 수 있습니다.

사이트 목록을 앱에 고정하지 않고 공개 HTTP(S) URL을 설치된 yt-dlp가 판별합니다.
[지원 사이트 목록](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)은 동작 보장이 아니며, 로그인·지역 제한·사이트 변경 등에 따라 실패할 수 있습니다.
생방송 녹화, 재생목록·모음, DRM 영상은 지원하지 않습니다. 미리보기는 호환되는 HTTPS MP4/HLS가 필요하며,
쿠키·요청 헤더·CORS 때문에 다운로드는 가능해도 미리보기가 실패할 수 있습니다.
영상 길이를 확인했다면 미리보기 없이도 전체 영상 다운로드 범위가 설정됩니다.
다른 사이트의 로그인은 **환경설정 → 쿠키 → 기타 사이트**에서 해당 사이트의 Netscape 쿠키 파일을 가져오세요.
기존 YouTube·치지직과 분리해 저장하며 미리보기 브라우저에는 주입하지 않습니다.
다운로드는 권리가 있거나 허용된 콘텐츠에만 사용하고, 쿠키는 공유하지 마세요.

## 문서

- [빌드·개발 실행·바이너리 의존성·GitHub Actions](BUILD.md)
- [상세 사용법](USAGEKR.md)
- [개발 구조와 검증](DEVELOPMENT.md)
