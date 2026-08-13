import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Select, type SelectOption } from "@kawaikara/kawai-ui";

const RENDERER_SELECT_SET_EVENT = "kawai-renderer-select-set";

export interface RendererSelectProps {
  defaultValue: string;
  id: string;
  label: string;
  options: readonly SelectOption[];
}

export function RendererSelect({
  defaultValue,
  id,
  label,
  options,
}: RendererSelectProps) {
  const [value, setValue] = useState(defaultValue);
  const controlRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const control = controlRef.current;
    if (!control) {
      return;
    }

    const handleExternalValue = (event: Event) => {
      const nextValue = (event as CustomEvent<{ value?: unknown }>).detail?.value;
      if (
        typeof nextValue !== "string" ||
        !options.some((option) => option.value === nextValue)
      ) {
        return;
      }

      flushSync(() => setValue(nextValue));
    };

    control.addEventListener(RENDERER_SELECT_SET_EVENT, handleExternalValue);
    return () =>
      control.removeEventListener(
        RENDERER_SELECT_SET_EVENT,
        handleExternalValue,
      );
  }, [options]);

  return (
    <Select
      ref={controlRef}
      id={id}
      label={label}
      options={options}
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        queueMicrotask(() => {
          controlRef.current?.dispatchEvent(
            new Event("change", { bubbles: true }),
          );
        });
      }}
    />
  );
}

export function setRendererSelectValue(
  control: HTMLButtonElement,
  value: string,
): void {
  control.dispatchEvent(
    new CustomEvent(RENDERER_SELECT_SET_EVENT, { detail: { value } }),
  );
}
