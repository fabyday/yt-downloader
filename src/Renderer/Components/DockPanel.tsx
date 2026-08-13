import { Box, Flex, Surface, Text } from "@kawaikara/kawai-ui";
import type { ReactNode } from "react";

interface DockPanelProps {
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  id: string;
  label: string;
}

export function DockPanel({
  badge,
  children,
  className = "",
  id,
  label,
}: DockPanelProps) {
  return (
    <Surface
      id={id}
      padding="none"
      radius="md"
      className={`dock-panel ${className}`.trim()}
      aria-label={label}
    >
      <Flex align="center" justify="between" gap="sm" className="dock-panel-header">
        <Text as="div" size="sm" weight="semibold">
          {label}
        </Text>
        {badge}
      </Flex>
      <Box className="dock-panel-content">{children}</Box>
    </Surface>
  );
}
