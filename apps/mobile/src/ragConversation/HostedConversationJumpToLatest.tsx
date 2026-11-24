import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { ConversationJumpToLatest } from './ConversationJumpToLatest';

export type ConversationJumpControl = {
  readonly sessionId?: number;
  readonly visible: boolean;
  readonly onPress: () => void;
};

export const ConversationJumpHost = createContext<
  ((control: ConversationJumpControl | null) => void) | null
>(null);

/** Keep scroll ownership in History while the workspace paints the same single
 * native hit target above the passive composer scrim. */
export function HostedConversationJumpToLatest({
  sessionId,
  visible,
  onPress,
}: ConversationJumpControl) {
  const host = useContext(ConversationJumpHost);
  const action = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    action.current = onPress;
    return () => {
      action.current = null;
    };
  }, [onPress]);
  useLayoutEffect(() => () => host?.(null), [host]);
  useLayoutEffect(() => {
    host?.({ sessionId, visible, onPress: () => action.current?.() });
  }, [host, sessionId, visible]);
  return host ? null : (
    <ConversationJumpToLatest
      key={sessionId}
      visible={visible}
      bottom={8}
      onPress={onPress}
    />
  );
}
