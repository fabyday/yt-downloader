export const EXTRA_PRESETS = [
  { id: "h265-mp4", name: "H.265 / HEVC MP4", extension: "mp4", args: ["-c:v", "libx265", "-crf", "24", "-preset", "fast", "-tag:v", "hvc1", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"] },
  { id: "vp9-webm", name: "VP9 / Opus WebM", extension: "webm", args: ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus", "-b:a", "160k"] },
  { id: "ffv1-mkv", name: "FFV1 / FLAC · Lossless MKV", extension: "mkv", args: ["-c:v", "ffv1", "-level", "3", "-c:a", "flac"] },
  { id: "audio-mp3", name: "MP3 · 320 kbps", extension: "mp3", args: ["-vn", "-c:a", "libmp3lame", "-b:a", "320k"] },
  { id: "audio-wav", name: "WAV · PCM 24-bit", extension: "wav", args: ["-vn", "-c:a", "pcm_s24le"] },
  { id: "audio-flac", name: "FLAC · Lossless", extension: "flac", args: ["-vn", "-c:a", "flac"] },
];
export const CUSTOM_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "mp3", "wav", "flac", "m4a"];
export const DEFAULT_CUSTOM_ARGS = "-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart";
export const PRESET_OPTIONS: Record<string, string> = {
  "youtube-copy": "-c copy", "h264-mp4": "-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart",
  "premiere-prores": "-c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -c:a pcm_s16le",
  "davinci-dnxhr": "-c:v dnxhd -profile:v dnxhr_hqx -pix_fmt yuv422p10le -c:a pcm_s16le",
  ...Object.fromEntries(EXTRA_PRESETS.map(preset => [preset.id, preset.args.join(" ")])),
};
const valueOptions = new Set(["-c", "-c:v", "-c:a", "-vcodec", "-acodec", "-crf", "-preset", "-tune", "-b:v", "-b:a", "-maxrate", "-bufsize", "-pix_fmt", "-profile:v", "-profile:a", "-level", "-level:v", "-r", "-ar", "-ac", "-movflags", "-tag:v", "-q:v", "-q:a", "-compression_level", "-cpu-used", "-deadline", "-threads", "-vf"]);

// This is an output-options field, not a shell or an additional FFmpeg command.
// No extra inputs, output paths, scripts, arbitrary filters, or protocol options.
export function parseCustomArgs(text: unknown): string[] {
  if (typeof text !== "string" || text.length > 4096 || /[\r\n\0]/.test(text)) throw new Error("encoding.invalidOptions");
  const tokens: string[] = [];
  const pattern = /\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"']+))/y;
  let offset = 0;
  while (offset < text.trimEnd().length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) throw new Error("encoding.invalidOptions");
    tokens.push(match[1] ?? match[2] ?? match[3]); offset = pattern.lastIndex;
  }
  if (!tokens.length) throw new Error("encoding.invalidOptions");
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i];
    if (key === "-vn" || key === "-an") continue;
    if (!valueOptions.has(key)) throw new Error("encoding.invalidOptions");
    const value = tokens[++i];
    if (!value || !/^[\w.+:=,/*() -]+$/.test(value) || value.startsWith("-")) throw new Error("encoding.invalidOptions");
    if (key === "-vf" && !value.split(",").every(filter => /^(scale|fps|format|crop|pad|hflip|vflip|transpose|setsar)=?[\w.+:=/*() -]*$/.test(filter))) throw new Error("encoding.invalidOptions");
  }
  return tokens;
}

export function customEncodingPreset(options: unknown, extension: unknown) {
  if (typeof extension !== "string" || !CUSTOM_EXTENSIONS.includes(extension)) throw new Error("encoding.invalidExtension");
  return { id: "custom", fallbackLabel: "Custom FFmpeg", extension, args: parseCustomArgs(options) };
}
