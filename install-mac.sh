#!/bin/bash
# macOS system Bash 3.2; no Homebrew, Node.js, Python, or jq required.
set -euo pipefail

REPOSITORY='fabyday/yt-downloader'
APP_NAME='kawai-downloader.app'

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() {
  printf '%s\n' \
    'Usage: bash install-mac.sh [VERSION | --version VERSION] [--dir DIRECTORY] [--keep-quarantine]' \
    '' \
    'No version: latest published stable release. Examples: 0.1.0, v0.1.0, 0.2.0-beta.1.' \
    'Default destination: ~/Applications (no sudo). Use --dir /Applications if writable.' \
    'The matching ARM64/Intel ZIP is downloaded and verified against release-manifest.json.' \
    'By default, only this app has com.apple.quarantine removed. This is NOT Apple notarization.' \
    'Use --keep-quarantine to retain normal macOS first-launch checks. The app is not auto-opened.' \
    'Existing installations are backed up, not deleted. Quit the app before replacing it.'
}

normalize_version() {
  local value="${1#v}" identifier
  [[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || return 1
  local prerelease="${value%%+*}"
  if [[ "$prerelease" == *-* ]]; then
    prerelease="${prerelease#*-}"
    local old_ifs="$IFS"
    IFS='.'
    for identifier in $prerelease; do
      if [[ "$identifier" =~ ^0[0-9]+$ ]]; then IFS="$old_ifs"; return 1; fi
    done
    IFS="$old_ifs"
  fi
  printf '%s' "$value"
}

json_value() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null; }

mac_arch() {
  if [[ "$1" == 1 || "$2" == arm64 ]]; then printf arm64;
  elif [[ "$2" == x86_64 ]]; then printf x64;
  else return 1; fi
}

download() {
  # Redirects are required by GitHub's release CDN, but may never downgrade TLS.
  curl --fail --location --show-error --silent --retry 3 --connect-timeout 20 --max-time 1800 \
    --proto '=https' --proto-redir '=https' --output "$2" "$1"
}

main() {
  local requested='' destination="${HOME:?}/Applications" keep_quarantine=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help) usage; return 0 ;;
      --version)
        [[ $# -ge 2 && -n "$2" && -z "$requested" ]] || fail 'Supply exactly one version.'
        requested="$2"; shift 2 ;;
      --dir)
        [[ $# -ge 2 && -n "$2" ]] || fail '--dir requires a directory.'
        destination="$2"; shift 2 ;;
      --keep-quarantine) keep_quarantine=1; shift ;;
      -*) fail "Unknown option: $1" ;;
      *) [[ -z "$requested" ]] || fail 'Supply exactly one version.'; requested="$1"; shift ;;
    esac
  done
  if [[ -n "$requested" ]]; then requested="$(normalize_version "$requested")" || fail 'Invalid SemVer version.'; fi
  [[ "$(uname -s)" == Darwin ]] || fail 'This installer is for macOS only.'
  [[ "$EUID" -ne 0 ]] || fail 'Do not run the installer with sudo. Run as your normal user.'
  [[ "$destination" == /* && "$destination" != / ]] || fail '--dir must be an absolute application directory, not /.'
  command -v curl >/dev/null || fail 'curl is required.'
  if /usr/bin/pgrep -f '/kawai-downloader[.]app/Contents/MacOS/' >/dev/null; then
    fail 'Quit kawai-downloader completely, then run the installer again.'
  fi

  local arch cpu_arch
  # hw.optional.arm64 also detects Apple Silicon when this shell runs under Rosetta.
  arch="$(mac_arch "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" "$(uname -m)")" || fail 'Unsupported Mac CPU.'
  if [[ "$arch" == arm64 ]]; then cpu_arch=arm64; else cpu_arch=x86_64; fi

  mkdir -p "$destination"
  destination="$(cd "$destination" && pwd -P)"
  [[ -w "$destination" ]] || fail "Directory is not writable: $destination. Use the default ~/Applications destination."
  local target="$destination/$APP_NAME"
  [[ ! -L "$target" ]] || fail 'Refusing to replace an application symlink.'
  [[ ! -e "$target" || -d "$target" ]] || fail 'The destination app path is not a directory.'

  # Only these mktemp-owned directories are recursively removed by cleanup.
  task_tmp="$(mktemp -d "${TMPDIR:-/tmp}/kawai-download.XXXXXX")"
  install_stage=''
  trap 'cleanup' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  local base="https://github.com/$REPOSITORY/releases" manifest_url
  if [[ -n "$requested" ]]; then
    manifest_url="$base/download/v${requested//+/%2B}/release-manifest.json"
  else manifest_url="$base/latest/download/release-manifest.json"; fi
  printf 'Fetching %s release metadata for %s…\n' "${requested:-latest stable}" "$arch"
  download "$manifest_url" "$task_tmp/manifest.json" || fail 'Release/manifest unavailable. The version must be published, not a draft.'
  local version
  version="$(json_value "$task_tmp/manifest.json" version)" || fail 'Invalid release manifest.'
  [[ "$(normalize_version "$version")" == "$version" ]] || fail 'Invalid version in release manifest.'
  [[ -z "$requested" || "$requested" == "$version" ]] || fail 'Requested and manifest versions differ.'
  local asset="kawai-downloader-$version-mac-$arch.zip"
  local url="$base/download/v${version//+/%2B}/${asset//+/%2B}"
  local checksum='' count=0 i=0 platform entry_arch kind entry_url entry_hash
  while platform="$(json_value "$task_tmp/manifest.json" "artifacts.$i.platform")"; do
    entry_arch="$(json_value "$task_tmp/manifest.json" "artifacts.$i.arch")" || fail 'Malformed artifact architecture.'
    kind="$(json_value "$task_tmp/manifest.json" "artifacts.$i.kind")" || fail 'Malformed artifact kind.'
    if [[ "$platform" == darwin && "$entry_arch" == "$arch" && "$kind" == zip ]]; then
      entry_url="$(json_value "$task_tmp/manifest.json" "artifacts.$i.url")" || fail 'Missing artifact URL.'
      entry_hash="$(json_value "$task_tmp/manifest.json" "artifacts.$i.sha256")" || fail 'Missing SHA-256.'
      [[ "$entry_url" == "$url" && "$entry_hash" =~ ^[a-f0-9]{64}$ ]] || fail 'Unexpected artifact URL or checksum.'
      checksum="$entry_hash"; count=$((count + 1))
    fi
    i=$((i + 1))
    [[ "$i" -le 100 ]] || fail 'Too many manifest entries.'
  done
  [[ "$count" == 1 ]] || fail "Expected exactly one $arch ZIP in the release manifest."
  printf 'Downloading %s…\n' "$asset"
  download "$url" "$task_tmp/app.zip" || fail 'Installer download failed.'
  local actual_hash
  actual_hash="$(/usr/bin/shasum -a 256 "$task_tmp/app.zip")"
  [[ "${actual_hash%% *}" == "$checksum" ]] || fail 'SHA-256 mismatch. Nothing was installed.'

  # Check archive names before extraction; preserve Electron framework symlinks with ditto.
  /usr/bin/unzip -Z1 "$task_tmp/app.zip" > "$task_tmp/entries.txt" || fail 'Invalid ZIP.'
  local entry
  while IFS= read -r entry; do
    case "$entry" in
      /*|../*|*/../*|*/..|*\\*) fail 'Unsafe archive entry.' ;;
      "$APP_NAME"|"$APP_NAME/"*|__MACOSX/*) ;;
      *) fail 'Unexpected archive contents.' ;;
    esac
  done < "$task_tmp/entries.txt"
  install_stage="$(mktemp -d "$destination/.kawai-install.XXXXXX")"
  /usr/bin/ditto -x -k --extattr --qtn "$task_tmp/app.zip" "$install_stage"
  local staged_app="$install_stage/$APP_NAME" plist="$install_stage/$APP_NAME/Contents/Info.plist"
  [[ -d "$staged_app" && ! -L "$staged_app" && -f "$plist" && ! -L "$plist" ]] || fail 'Missing application bundle.'
  local identifier executable app_version
  identifier="$(json_value "$plist" CFBundleIdentifier)" || fail 'Missing bundle identifier.'
  [[ "$identifier" == day.faby.kawai-downloader ]] || fail 'Unexpected bundle identifier.'
  app_version="$(json_value "$plist" CFBundleShortVersionString)" || fail 'Missing app version.'
  [[ "$app_version" == "$version" ]] || fail 'Application and release versions differ.'
  executable="$(json_value "$plist" CFBundleExecutable)" || fail 'Missing app executable.'
  [[ -n "$executable" && "$executable" != */* && "$executable" != . && "$executable" != .. ]] || fail 'Invalid executable name.'
  [[ -x "$staged_app/Contents/MacOS/$executable" ]] || fail 'Application executable is missing.'
  local binary_info
  binary_info="$(/usr/bin/file -b "$staged_app/Contents/MacOS/$executable")"
  [[ "$binary_info" == *Mach-O* && "$binary_info" == *"$cpu_arch"* ]] || fail 'Wrong CPU architecture or invalid executable.'
  if [[ "$keep_quarantine" == 0 ]]; then
    printf '%s\n' 'Removing quarantine from this app only. This bypasses quarantine-triggered first-launch checks; it does not notarize the app.'
    /usr/bin/xattr -drs com.apple.quarantine "$staged_app" || fail 'Could not remove quarantine. Existing installation is unchanged.'
  fi

  local backup=''
  if [[ -e "$target" ]]; then
    backup="$(mktemp -d "$destination/.kawai-downloader-backup.XXXXXX")"
    /bin/mv "$target" "$backup/$APP_NAME"
    printf 'Previous app retained at: %s\n' "$backup/$APP_NAME"
  fi
  if ! /bin/mv "$staged_app" "$target"; then
    if [[ -n "$backup" ]]; then /bin/mv "$backup/$APP_NAME" "$target" || fail "Restore the previous app manually from $backup"; fi
    fail 'Installation failed; the previous app was restored if present.'
  fi
  printf 'Installed v%s (%s): %s\nOpen it from Finder when ready.\n' "$version" "$arch" "$target"
}

cleanup() {
  if [[ -n "${install_stage:-}" && -d "$install_stage" ]]; then /bin/rm -rf -- "$install_stage"; fi
  if [[ -n "${task_tmp:-}" && -d "$task_tmp" ]]; then /bin/rm -rf -- "$task_tmp"; fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
