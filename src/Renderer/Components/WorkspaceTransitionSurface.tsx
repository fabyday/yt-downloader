import { Panel } from "@kawaikara/kawai-ui";
import type { ReactNode } from "react";

interface WorkspaceTransitionSurfaceProps {
  active: boolean;
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  direction: "left" | "right";
  role?: "region";
}

export function WorkspaceTransitionSurface({
  active,
  ariaLabel,
  children,
  className,
  direction,
  role,
}: WorkspaceTransitionSurfaceProps) {
  const offset = direction === "left" ? -32 : 32;

  return (
    <Panel
      padding="sm"
      radius="lg"
      className={`${className} tab-workspace-view${
        active ? " active" : " inactive"
      }`}
      initial={false}
      animate={
        active
          ? {
              opacity: 1,
              scale: 1,
              x: 0,
            }
          : {
              opacity: 0,
              scale: 0.992,
              x: offset,
            }
      }
      transition={{ duration: 0.36, ease: [0.4, 0, 0.2, 1] }}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={!active}
      inert={active ? undefined : true}
    >
      {children}
    </Panel>
  );
}
