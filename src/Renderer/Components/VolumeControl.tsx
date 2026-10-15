import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRendererViewActions, useRendererViewSnapshot } from "../viewStore";
import { useI18n } from "../I18nProvider";

function SpeakerIcon({ level, silent }: { level: number; silent: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5 4 9H1v6h3l5 4Z" />
    {silent ? <path d="m14 9 7 6m0-6-7 6" /> : <>
      {level > 0 && <path data-volume-wave="1" d="M12 9a5 5 0 0 1 0 6" />}
      {level > 1 / 3 && <path data-volume-wave="2" d="M16 6a9 9 0 0 1 0 12" />}
      {level > 2 / 3 && <path data-volume-wave="3" d="M20 3a13 13 0 0 1 0 18" />}
    </>}
  </svg>;
}

export function VolumeControl() {
  const { t } = useI18n();
  const { volume, muted, volumeOpen } = useRendererViewSnapshot();
  const root = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const actions = getRendererViewActions();
  useLayoutEffect(() => {
    if (!volumeOpen) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const panel = popup.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const top = anchor.top >= panel.height + 16 ? anchor.top - panel.height - 8 : anchor.bottom + 8;
      setPosition({ left: Math.max(8, Math.min(innerWidth - panel.width - 8, anchor.left + anchor.width / 2 - panel.width / 2)),
        top: Math.max(8, Math.min(innerHeight - panel.height - 8, top)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [volumeOpen]);
  useEffect(() => {
    if (!volumeOpen) return;
    slider.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) getRendererViewActions().setVolumeOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [volumeOpen]);
  const silent = muted || volume === 0;
  return <div ref={root} className="volume-control" onKeyDown={event => {
    if (!volumeOpen || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); actions.setVolumeOpen(false); trigger.current?.focus();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault(); event.stopPropagation(); actions.setVolume(volume + (event.key === "ArrowUp" ? 0.05 : -0.05));
    }
  }}>
    <button ref={trigger} id="volumeButton" className="timeline-volume-button" data-muted={muted} type="button"
      aria-label={t("volume.control")} title={t("volume.control")} aria-expanded={volumeOpen}
      aria-controls="volumePopover" onClick={() => actions.setVolumeOpen(!volumeOpen)}>
      <SpeakerIcon level={volume} silent={silent} />
    </button>
    {volumeOpen && createPortal(<div ref={popup} id="volumePopover" className="volume-popover kawai-theme-dark downloader-theme" style={position} role="group" aria-label={t("volume.control")}>
      <span id="volumeValue">{Math.round(volume * 100)}%</span>
      <div className="volume-slider" style={{ "--volume-level": volume } as CSSProperties}>
        <div className="volume-slider-track" aria-hidden="true"><div className="volume-slider-fill" /></div>
        <div className="volume-slider-thumb" aria-hidden="true" />
      <input ref={slider} id="volumeSlider" type="range" min="0" max="100" step="5"
        value={Math.round(volume * 100)} aria-label={t("volume.level")} aria-orientation="vertical"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        onChange={event => actions.setVolume(Number(event.target.value) / 100)} />
      </div>
      <button id="muteButton" className="volume-mute-button" type="button"
        aria-label={t(muted ? "volume.unmute" : "volume.mute")} title={t(muted ? "volume.unmute" : "volume.mute")}
        aria-pressed={muted} onClick={actions.toggleMute}><SpeakerIcon level={0} silent /></button>
    </div>, document.body)}
  </div>;
}
