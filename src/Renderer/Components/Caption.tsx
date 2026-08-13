import { Text, type TextProps } from "@kawaikara/kawai-ui";

export interface CaptionProps
  extends Omit<TextProps, "as" | "size" | "tone"> {}

/** Small app-specific caption used above values and compact sections. */
export function Caption({ className, ...props }: CaptionProps) {
  return (
    <Text
      {...props}
      as="span"
      size="xs"
      tone="muted"
      className={className ? `value-caption ${className}` : "value-caption"}
    />
  );
}
