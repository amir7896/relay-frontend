import type {
  ChannelListItem,
  ChannelListItemPriority,
} from '../../../api/types';

export const PRIORITIES: Array<{
  id: ChannelListItemPriority;
  label: string;
  short: string;
}> = [
  { id: 'highest', label: 'Highest', short: '↑↑' },
  { id: 'high', label: 'High', short: '↑' },
  { id: 'medium', label: 'Medium', short: '—' },
  { id: 'low', label: 'Low', short: '↓' },
  { id: 'lowest', label: 'Lowest', short: '↓↓' },
];

export function normalizeListItem(item: ChannelListItem): ChannelListItem {
  return {
    ...item,
    description: item.description ?? '',
    priority: item.priority ?? 'medium',
    labels: Array.isArray(item.labels) ? item.labels : [],
    estimate: item.estimate ?? null,
    parentItemId: item.parentItemId ?? null,
    dueAt: item.dueAt ?? null,
    jiraKey: item.jiraKey ?? null,
    jiraUrl: item.jiraUrl ?? null,
    updatedAt: item.updatedAt ?? item.createdAt,
  };
}

export function issueKey(
  listName: string,
  item: ChannelListItem,
  allItems: ChannelListItem[],
): string {
  const prefix =
    listName
      .replace(/[^a-zA-Z0-9]+/g, '')
      .slice(0, 4)
      .toUpperCase() || 'TASK';
  const ordered = [...allItems].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const index = ordered.findIndex((row) => row.id === item.id);
  return `${prefix}-${index >= 0 ? index + 1 : '?'}`;
}

export function priorityMeta(priority?: ChannelListItemPriority | null) {
  return (
    PRIORITIES.find((item) => item.id === (priority ?? 'medium')) ??
    PRIORITIES[2]
  );
}
