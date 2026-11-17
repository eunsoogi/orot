import type { Owner } from './conversationReadingPositionTypes';
import type { useConversationReadingPosition } from './useConversationReadingPosition';
import { conversationReadingKey } from './conversationReadingAnchor';
/** Coalesce reader events while serializing protected writes; never save rendered text. */
export function saveConversationReadingPosition(
  state: Owner,
  input: Parameters<typeof useConversationReadingPosition>[0],
  current: () => boolean,
  override?: { offset?: number; bottom?: boolean },
) {
  if (
    !current() ||
    !state.ready ||
    !state.storage ||
    state.version === undefined ||
    input.blocked ||
    input.focused
  )
    return;
  const offset = override?.offset ?? input.geometry.current?.offset;
  if (offset === undefined || state.origin === null) return;
  const origin = state.origin;
  let chosen:
    | {
        key: NonNullable<ReturnType<typeof conversationReadingKey>>;
        y: number;
      }
    | undefined;
  input.messages.forEach((message, index) => {
    const y = state.rows.get(message.id);
    const key = conversationReadingKey(input.messages, index);
    if (y === undefined || !key) return;
    const absolute = origin + y.y;
    if (!chosen || (absolute <= offset && absolute > chosen.y))
      chosen = { key, y: absolute };
  });
  if (!chosen) return;
  state.write = {
    ...chosen.key,
    offset: Math.max(0, offset - chosen.y),
    bottom: override?.bottom ?? input.followsBottom.current,
  };
  if (state.writing) return;
  state.writing = true;
  (async () => {
    try {
      while (current() && state.write) {
        const position = state.write;
        state.write = undefined;
        await state.storage!.write(
          state.id!,
          state.version!,
          position,
          current,
        );
      }
    } catch {
      /* A failed position save never changes transcript retention or consent. */
    } finally {
      state.writing = false;
    }
  })();
}
