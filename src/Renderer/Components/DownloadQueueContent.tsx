import {
  Badge,
  Button,
  CheckBox,
  Flex,
  Portal,
  Progress,
  Stack,
  Surface,
  Text,
} from "@kawaikara/kawai-ui";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../I18nProvider";
import {
  getRendererViewActions,
  type QueueViewItem,
  useRendererViewSnapshot,
} from "../viewStore";

interface QueueMenuState {
  itemId: string;
  x: number;
  y: number;
}

export function DownloadQueueContent() {
  const { t } = useI18n();
  const { queueItems } = useRendererViewSnapshot();
  const actions = getRendererViewActions();
  const [menu, setMenu] = useState<QueueMenuState | null>(null);

  useEffect(() => {
    const closeMenu = () => setMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, []);

  if (queueItems.length === 0) {
    return <Text size="sm" tone="muted">{t("queue.empty")}</Text>;
  }

  const menuItem = menu
    ? queueItems.find((item) => item.id === menu.itemId) ?? null
    : null;

  return (
    <>
      <Stack gap="sm">
        {queueItems.map((item, index) => (
          <QueueRow
            key={item.id}
            index={index}
            item={item}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ itemId: item.id, x: event.clientX, y: event.clientY });
            }}
            onOpen={actions.openOutput}
            onRemove={actions.removeQueueItem}
            onSelect={actions.toggleQueueItemSelection}
          />
        ))}
      </Stack>

      {menu && menuItem ? (
        <Portal>
          <Surface
            padding="sm"
            radius="md"
            role="menu"
            className="queue-context-menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <Stack gap="xs">
              {menuItem.canPause ? (
                <Button
                  size="sm"
                  variant="ghost"
                  fullWidth
                  onClick={() => actions.pauseQueueItem(menuItem.id)}
                >
                  {t("queue.pause")}
                </Button>
              ) : null}
              {menuItem.canResume ? (
                <Button
                  size="sm"
                  variant="ghost"
                  fullWidth
                  onClick={() => actions.resumeQueueItem(menuItem.id)}
                >
                  {t("queue.resume")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                fullWidth
                onClick={() => actions.removeQueueItem(menuItem.id)}
              >
                {t("common.delete")}
              </Button>
            </Stack>
          </Surface>
        </Portal>
      ) : null}
    </>
  );
}

function QueueRow({
  index,
  item,
  onContextMenu,
  onOpen,
  onRemove,
  onSelect,
}: {
  index: number;
  item: QueueViewItem;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpen: (outputPath: string) => void;
  onRemove: (itemId: string) => void;
  onSelect: (itemId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Surface
      padding="sm"
      radius="md"
      className={`queue-row ${item.status}${item.editing ? " editing" : ""}${item.selected ? " selected" : ""}`}
      aria-label={item.title}
      onContextMenu={onContextMenu}
    >
      <Flex align="center" justify="between" gap="sm" className="queue-row-header">
        <CheckBox
          value={item.id}
          checked={item.selected}
          className="queue-item-checkbox"
          aria-label={t("queue.selectItem", { title: item.title })}
          label={
            <Text
              as="span"
              size="sm"
              weight="semibold"
              className="queue-title"
              title={item.title}
            >
              {index + 1}. {item.title}
            </Text>
          }
          onChange={() => onSelect(item.id)}
        />
        <Badge size="sm" className="queue-status">
          {item.statusLabel}
        </Badge>
      </Flex>

      <Text as="div" size="xs" tone="muted" className="queue-meta" title={item.meta}>
        {item.meta}
      </Text>

      <Progress
        value={item.progress * 100}
        size="sm"
        className="queue-progress-track"
        indicatorClassName="queue-progress-fill"
        aria-label={item.statusLabel}
      />

      <Flex align="center" justify="between" gap="sm" className="queue-row-footer">
        <Text
          as="div"
          size="xs"
          tone="muted"
          className="queue-message"
          title={item.message}
        >
          {item.message}
        </Text>
        {item.outputPath ? (
          <Button
            size="sm"
            variant="secondary"
            className="queue-open-button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(item.outputPath!);
            }}
          >
            {t("common.open")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="queue-open-button"
          disabled={!item.canRemove}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item.id);
          }}
        >
          {t("common.delete")}
        </Button>
      </Flex>
    </Surface>
  );
}
