import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { SelectOption, SelectProps } from "@kawaikara/kawai-ui";

/** App-local listbox: portals escape scroll cards; only the list itself scrolls. */
export const PopupSelect = forwardRef<HTMLButtonElement, SelectProps>(function PopupSelect({
  id, label, options = [], value, defaultValue = "", onValueChange, disabled,
  description, error, placeholder = "—", className = "", onKeyDown, onBlur,
  onClick, name, listClassName = "", placement = "auto", controlSize, emptyMessage = "—", children: _children, ...props
}, ref) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(defaultValue);
  const selected = value ?? internal;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const selectedOption = options.find(option => option.value === selected);
  const openList = () => {
    const index = options.findIndex(option => option.value === selected && !option.disabled);
    setActive(index < 0 ? options.findIndex(option => !option.disabled) : index);
    setOpen(true);
  };
  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    if (value === undefined) setInternal(option.value);
    setOpen(false);
    onValueChange?.(option.value, option);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const top = placement === "top" || (placement === "auto" && below < 260 && above > below);
      setPosition({ position: "fixed", left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        width: Math.min(r.width, window.innerWidth - 16), maxHeight: Math.max(40, Math.min(320, top ? above : below)),
        ...(top ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", close);
    };
  }, [open, placement]);
  useLayoutEffect(() => {
    const container = list.current;
    const option = container?.children[active] as HTMLElement | undefined;
    if (!container || !option) return;
    if (option.offsetTop < container.scrollTop) container.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > container.scrollTop + container.clientHeight)
      container.scrollTop = option.offsetTop + option.offsetHeight - container.clientHeight;
  }, [active, open, position]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const move = (direction: number) => {
    for (let step = 1; step <= options.length; step++) {
      const index = (active + direction * step + options.length) % options.length;
      if (!options[index].disabled) { setActive(index); return; }
    }
  };
  return <div className="popup-select-field">
    {label && <label id={`${selectId}-label`} htmlFor={selectId}>{label}</label>}
    {name && <input type="hidden" name={name} value={selected} />}
    <button {...props} id={selectId} ref={node => { trigger.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }}
      type="button" role="combobox" className={`popup-select-trigger ${className}`} value={selected} disabled={disabled}
      data-selected-label={selectedOption?.label} aria-haspopup="listbox" aria-controls={`${selectId}-listbox`} aria-expanded={open}
      aria-labelledby={label ? `${selectId}-label` : props["aria-labelledby"]}
      aria-invalid={Boolean(error) || undefined} aria-describedby={error || description ? `${selectId}-helper` : undefined}
      aria-activedescendant={open && active >= 0 ? `${selectId}-option-${active}` : undefined}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) open ? setOpen(false) : openList(); }}
      onBlur={event => { onBlur?.(event); if (!list.current?.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        onKeyDown?.(event); if (event.defaultPrevented) return;
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") setOpen(false);
          else if (!open) openList();
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") move(event.key === "ArrowDown" ? 1 : -1);
          else if (event.key === "Home") setActive(options.findIndex(option => !option.disabled));
          else if (event.key === "End") setActive(options.map(option => !option.disabled).lastIndexOf(true));
          else if (options[active]) choose(options[active]);
        } else if (event.key === "Tab") setOpen(false);
      }}>
      <span>{selectedOption?.label ?? placeholder}</span><span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </button>
    {(error || description) && <p id={`${selectId}-helper`} className="popup-select-help">{error ?? description}</p>}
    {open && createPortal(<div ref={list} role="listbox" id={`${selectId}-listbox`} className={`popup-select-list ${listClassName}`}
      aria-labelledby={label ? `${selectId}-label` : selectId} style={position}>
      {options.length ? options.map((option, index) => <div key={option.value} id={`${selectId}-option-${index}`} role="option"
        aria-selected={option.value === selected} aria-disabled={option.disabled || undefined} data-active={active === index}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => !option.disabled && setActive(index)} onClick={() => choose(option)}>
        <span>{option.label}</span>{option.value === selected && <span aria-hidden="true">✓</span>}
      </div>) : <div>{emptyMessage}</div>}
    </div>, document.body)}
  </div>;
});
