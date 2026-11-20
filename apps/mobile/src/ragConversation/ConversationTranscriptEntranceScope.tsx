import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { ConversationBubbleEntranceContext } from './ConversationBubbleEntrance';
import { createConversationBubbleEntrances } from './conversationBubbleEntrances';
import type { ConversationBubblePresentation } from './conversationBubblePaint';
import type { DisplayMessage } from './conversationDisplayMessage';
import type { StoredSteeringInstruction } from '../storage/conversationSteeringStorage';

/** Hold one fail-closed system preference subscription, not a subscriber per bubble. */
function useEntranceMotionAllowed() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      reduced => {
        changed = true;
        if (active) setAllowed(!reduced);
      },
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      reduced => {
        if (active && !changed) setAllowed(!reduced);
      },
      () => undefined,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return allowed;
}

export function ConversationTranscriptEntranceScope({
  sessionId,
  availableMessages,
  instructions,
  pendingId,
  showPendingBubble,
  presentation,
  children,
}: {
  readonly sessionId?: number;
  readonly availableMessages: readonly DisplayMessage[];
  readonly instructions?: readonly StoredSteeringInstruction[];
  readonly pendingId?: number;
  readonly showPendingBubble?: boolean;
  readonly presentation: {
    readonly showCitations?: boolean;
    readonly showToolActivity?: boolean;
    readonly onContinueCold?: (requestId: string) => void;
  };
  readonly children: ReactNode;
}) {
  const receipts = useMemo(
    () => createConversationBubbleEntrances(sessionId),
    [sessionId],
  );
  const motionAllowed = useEntranceMotionAllowed();
  const showCitations = presentation.showCitations ?? true;
  const showToolActivity = presentation.showToolActivity ?? true;
  const canResume = Boolean(presentation.onContinueCold);
  // Child layout effects consume the first painted snapshot before the session is armed.
  // Seed offscreen history too so a later prepend/focus cannot animate old content.
  useEffect(() => {
    const paint: ConversationBubblePresentation = {
      showCitations,
      showToolActivity,
      canResume,
    };
    receipts.observe({
      messages: availableMessages,
      instructions,
      pendingId,
      showPendingBubble,
      presentation: paint,
    });
  }, [
    availableMessages,
    instructions,
    pendingId,
    showPendingBubble,
    showCitations,
    showToolActivity,
    canResume,
    receipts,
  ]);
  const scope = useMemo(
    () => ({ receipts, motionAllowed }),
    [receipts, motionAllowed],
  );
  return (
    <ConversationBubbleEntranceContext.Provider value={scope}>
      {children}
    </ConversationBubbleEntranceContext.Provider>
  );
}
