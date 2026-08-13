import { Stack, Text } from "@kawaikara/kawai-ui";
import { useRendererViewSnapshot } from "../viewStore";

export function PresetDetailsContent() {
  const { presetDetails } = useRendererViewSnapshot();

  return (
    <Stack gap="xs">
      <Text as="div" size="sm" weight="semibold" className="preset-title">
        {presetDetails.title}
      </Text>
      <Text as="div" size="xs" tone="muted" className="preset-meta">
        {presetDetails.meta}
      </Text>
    </Stack>
  );
}

export function PresetFormatContent() {
  const { presetFormats } = useRendererViewSnapshot();

  return (
    <Stack gap="sm">
      {presetFormats.map((format) => (
        <Stack key={format.id} gap="xs" className="format-row">
          <Text as="div" size="sm" weight="semibold" className="format-name">
            {format.name}
          </Text>
          <Text as="div" size="xs" tone="muted" className="format-meta">
            {format.meta}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}
