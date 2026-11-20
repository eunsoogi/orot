import type { StoredSteeringInstruction } from '../storage/conversationSteeringStorage';
import type { DisplayMessage } from './conversationDisplayMessage';
import {
  conversationBubblePaint,
  type ConversationBubblePresentation,
} from './conversationBubblePaint';
import { transcriptMessageVisible } from './conversationWorkspaceLayout';

type Part = 'user' | 'assistant' | 'opening' | 'pending' | 'steering';

export function conversationBubbleKey(part: Part, id: number | string) {
  return `${part}:${id}`;
}

/** A session only advances part-specific live high-water marks. Producer IDs rise
 * monotonically; retained/cold messages use non-positive IDs. Avoid a permanent
 * set of old rows, or eviction that would let an old bubble become eligible. */
export function createConversationBubbleEntrances(_sessionId?: number) {
  let armed = false;
  const parts: Record<Exclude<Part, 'steering'>, number> = {
    user: 0,
    assistant: 0,
    opening: 0,
    pending: 0,
  };
  const liveSteering = new Set<string>();
  const consume = (key: string) => {
    const split = key.indexOf(':');
    const part = key.slice(0, split) as Part;
    if (part === 'steering') {
      if (liveSteering.has(key)) return false;
      liveSteering.add(key);
      return true;
    }
    const id = Number(key.slice(split + 1));
    if (!Number.isSafeInteger(id) || id <= parts[part]) return false;
    parts[part] = id;
    return true;
  };
  const consumeSteering = (rows: readonly StoredSteeringInstruction[] = []) => {
    for (const row of rows) consume(conversationBubbleKey('steering', row.id));
  };
  return {
    observe({
      messages,
      instructions,
      pendingId,
      showPendingBubble,
      presentation,
    }: {
      readonly messages: readonly DisplayMessage[];
      readonly instructions?: readonly StoredSteeringInstruction[];
      readonly pendingId?: number;
      readonly showPendingBubble?: boolean;
      readonly presentation: ConversationBubblePresentation;
    }) {
      // A mounted surface has already had its layout-effect chance. Reconcile
      // the full semantic projection so entrances missed by the viewport or
      // hidden only by the wide layout cannot play later.
      for (const message of messages) {
        if (
          message.id <= 0 ||
          message.restoredHistory ||
          !transcriptMessageVisible(message, false)
        )
          continue;
        const { opening, showBody } = conversationBubblePaint(
          message,
          presentation,
        );
        if (opening) consume(conversationBubbleKey('opening', message.id));
        if (showBody)
          consume(
            conversationBubbleKey(
              message.role === 'user' ? 'user' : 'assistant',
              message.id,
            ),
          );
        consumeSteering(
          message.id === pendingId
            ? instructions
            : message.steeringInstructions,
        );
      }
      if (pendingId !== undefined && pendingId > 0) {
        consumeSteering(instructions);
        if (showPendingBubble)
          consume(conversationBubbleKey('pending', pendingId));
      }
      armed = true;
    },
    claim(key: string, eligible: boolean) {
      return consume(key) && armed && eligible;
    },
  };
}
