import { Badge, Box, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { useEffect, useState } from "react";
import type { CookieStatus } from "../../Shared/types";
import { useRendererViewSnapshot } from "../viewStore";

function CookieIndicator() {
  const { t } = useI18n();
  const [cookies, setCookies] = useState<CookieStatus | null>(null);
  const { previewMessage } = useRendererViewSnapshot();
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.ytClipper.onCookiesChanged?.(status => {
      changed = true;
      if (active) setCookies(status);
    });
    void window.ytClipper.getCookieStatus().then(status => { if (active && !changed) setCookies(status); }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, []);
  const expired = cookies?.configured && previewMessage === "preview.expired";
  return <Badge id="cookieStatus" className={`dependency cookie-status ${cookies?.configured && !expired ? "ready" : ""}`}
    tone={expired ? "danger" : cookies?.configured ? "success" : "neutral"} dot>
    <Text as="span" size="sm" weight="semibold" className="dependency-label">
      {t(expired ? "cookies.expiredBadge" : cookies?.configured ? "cookies.activeBadge" : "cookies.none")}
    </Text>
  </Badge>;
}

export function DependencyStatus() {
  const { t } = useI18n();

  return (
    <Box as="section" className="status-panel" aria-label={t("dependency.label")}>
      <Badge
        id="ytDlpStatus"
        className="dependency missing"
        tone="danger"
        dot
      >
        <Text as="span" size="sm" weight="semibold" className="dependency-label">
          {t("dependency.checking", { name: "yt-dlp" })}
        </Text>
      </Badge>
      <Badge
        id="ffmpegStatus"
        className="dependency missing"
        tone="danger"
        dot
      >
        <Text as="span" size="sm" weight="semibold" className="dependency-label">
          {t("dependency.checking", { name: "ffmpeg" })}
        </Text>
      </Badge>
      <CookieIndicator />
    </Box>
  );
}
