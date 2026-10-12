interface WindowTitleBarProps {
  title?: string;
}

export function WindowTitleBar({ title }: WindowTitleBarProps) {
  const platform = new URLSearchParams(window.location.search).get("platform");

  return (
    <header className="window-title-bar" data-platform={platform}>
      <div className="window-title-bar-content">
        <svg className="window-title-bar-logo" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="1" y="1" width="18" height="18" rx="5" fill="currentColor" />
          <path d="m8 6 6 4-6 4Z" fill="#111317" />
        </svg>
        <span className="window-title-bar-brand">kawai-downloader</span>
        {title && <span className="window-title-bar-caption">{title}</span>}
      </div>
    </header>
  );
}
