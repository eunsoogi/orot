import type { ConversationLayoutSkeleton } from '@orot/agent-runtime';
import type { ConversationSession } from './conversationSessionTypes';

/** A retained request can continue while hidden; its visual hint cannot. */
export function layoutSkeletonPublisher(input: {
  readonly id: number;
  readonly responseId: number;
  readonly current: () => boolean;
  readonly update: (id: number, patch: Partial<ConversationSession>) => void;
}) {
  let selection: (() => boolean) | undefined;
  return {
    setCurrent(current: () => boolean) {
      selection = current;
    },
    publish(
      pending: ConversationSession['pendingMessage'] | undefined,
      layout: ConversationLayoutSkeleton | undefined,
    ) {
      const captured = selection;
      const owns = () => input.current() && Boolean(captured?.());
      if (!owns() || pending?.id !== input.responseId) return;
      const layoutSkeleton =
        layout && !pending.withholdHealthBody
          ? { current: owns, layout }
          : undefined;
      const pendingMessage = { ...pending, layoutSkeleton };
      input.update(input.id, { pendingMessage });
    },
  };
}
