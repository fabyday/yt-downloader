import { useEffect, useId, useState, type ReactNode } from "react";

// App-owned until NumberInput is included in a released/pinned KawaiUI build.
// Do not depend on uncommitted exports from a sibling checkout.
export function NumberInput({ label, description, value, min, max, step = 1, onValueChange }: {
  label: string; description?: ReactNode; value: number; min: number; max: number;
  step?: number; layout?: "stacked"; onValueChange: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (candidate: number) => {
    const next = Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, Number((Math.round(candidate / step) * step).toFixed(8)))) : value;
    setDraft(String(next)); onValueChange(next);
  };
  return <div className="app-number-input">
    <label htmlFor={id}>{label}</label>
    {description && <small id={`${id}-description`}>{description}</small>}
    <div className="app-number-input-control">
      <input id={id} type="text" role="spinbutton" inputMode="decimal" aria-label={label}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} value={draft}
        onChange={event => { if (/^-?(?:\d+(?:\.\d*)?|\.\d*)?$/.test(event.target.value)) setDraft(event.target.value); }}
        onBlur={event => commit(Number(event.target.value))}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault(); commit(value + (event.key === "ArrowUp" ? step : -step));
          }
        }} />
      <span>
        <button type="button" tabIndex={-1} aria-label={`${label} +`} disabled={value >= max}
          onPointerDown={event => event.preventDefault()} onClick={() => commit(value + step)}>+</button>
        <button type="button" tabIndex={-1} aria-label={`${label} −`} disabled={value <= min}
          onPointerDown={event => event.preventDefault()} onClick={() => commit(value - step)}>−</button>
      </span>
    </div>
  </div>;
}
