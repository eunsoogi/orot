import type { DisplayMessage } from './conversationDisplayMessage';
import type { VoiceMarkerPresentation } from './ConversationHistoryProps';
import type { VoiceEndTaskCard } from '../storage/conversationTaskCardCodec';

type Marker = VoiceMarkerPresentation & { readonly task: VoiceEndTaskCard };
type Key = { readonly createdAt: string; readonly id: string };
type MarkerGroup = { restored: Marker[]; current: Marker[] };

function marker(card: VoiceMarkerPresentation): card is Marker {
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
  cards: readonly VoiceMarkerPresentation[] | undefined,
) {
  const markers = cards?.filter(marker).sort(compare);
  if (!markers?.length) return undefined;
  const positions = new Map<number, number>();
  const restored: { id: number; key: Key }[] = [];
  const live: number[] = [];
  for (const message of messages) {
    if (!message.restoredHistory) {
      positions.set(message.id, live.length);
      live.push(message.id);
    } else if (message.voiceTimelineOrder)
      restored.push({ id: message.id, key: message.voiceTimelineOrder });
  }
  const before = new Map<number | null, MarkerGroup>();
  for (const card of markers) {
    const anchor = card.liveAfterMessageId;
    // A missing witness comes from storage; null (or an earlier restored
    // message) still belongs to a call captured by this live Conversation.
    const current = anchor !== undefined;
    const followed =
      anchor != null && anchor > 0 ? positions.get(anchor) : undefined;
    const at =
      (!current
        ? (firstMatch(restored, row => compare(card, row.key) <= 0)?.id ??
          live[0])
        : followed !== undefined
          ? live[followed + 1]
          : anchor !== null && anchor > 0
            ? firstMatch(live, id => id > anchor)
            : live[0]) ?? null;
    let group = before.get(at);
    if (!group) {
      group = { restored: [], current: [] };
      before.set(at, group);
    }
    group[current ? 'current' : 'restored'].push(card);
  }
  return before;
}
