import type { DisplayMessage } from './conversationDisplayMessage';
import type { RetainedConversationTask } from './conversationTaskState';
import type { VoiceEndTaskCard } from '../storage/conversationTaskCardCodec';

type Marker = RetainedConversationTask & { readonly task: VoiceEndTaskCard };
type Key = { readonly createdAt: string; readonly id: string };

function marker(card: RetainedConversationTask): card is Marker {
  return card.task.kind === 'voice_end';
}

function compare(a: Key, b: Key) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function firstMatch<T>(items: readonly T[], atOrAfter: (item: T) => boolean) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (atOrAfter(items[mid]!)) high = mid;
    else low = mid + 1;
  }
  return items[low];
}

/** Insert local markers without admitting them as model rows or reordering ordinary rows. */
export function conversationVoiceEndPlacement(
  messages: readonly DisplayMessage[],
  cards: readonly RetainedConversationTask[] | undefined,
) {
  const markers = cards?.filter(marker).sort(compare);
  if (!markers?.length) return undefined;
  const positions = new Map<number, number>();
  const restored: { id: number; key: Key }[] = [];
  const live: number[] = [];
  messages.forEach((message, index) => {
    positions.set(message.id, index);
    if (!message.restoredHistory) live.push(message.id);
    else if (message.voiceTimelineOrder)
      restored.push({ id: message.id, key: message.voiceTimelineOrder });
  });
  const before = new Map<number | null, Marker[]>();
  for (const card of markers) {
    const anchor = card.liveAfterMessageId;
    const followed = anchor == null ? undefined : positions.get(anchor);
    const at =
      (anchor === null
        ? messages[0]?.id
        : followed !== undefined
          ? messages[followed + 1]?.id
          : anchor !== undefined && anchor > 0
            ? firstMatch(live, id => id > anchor)
            : (firstMatch(restored, row => compare(card, row.key) <= 0)?.id ??
              live[0])) ?? null;
    const group = before.get(at);
    if (group) group.push(card);
    else before.set(at, [card]);
  }
  return before;
}
