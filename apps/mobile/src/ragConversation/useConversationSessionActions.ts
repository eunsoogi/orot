import { useNavigationActionPlacement } from '../navigation/useNavigationActionPlacement';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import type { ConversationSessions } from './conversationSessions';
import type { getRagConversationCopy } from './copy';

/** Keep history before new session in the host actions and retain a header fallback. */
export function useConversationSessionActions(
  store: ConversationSessions,
  copy: ReturnType<typeof getRagConversationCopy>,
  onOpenHistory?: () => void,
): boolean {
  const placement = useNavigationActionPlacement();
  const hasDockActions = useNavigationRouteActions(
    placement === 'contextual'
      ? [
          {
            id: 'conversation-history',
            label: copy.sessions,
            accessibilityLabel: copy.sessions,
            testID: 'rag-conversation-sessions-toggle',
            systemImageName: 'clock.arrow.circlepath',
            disabled: !onOpenHistory,
            onPress: () => onOpenHistory?.(),
          },
          {
            id: 'conversation-new-session',
            label: copy.newConversation,
            accessibilityLabel: copy.newConversation,
            testID: 'rag-conversation-new-session',
            systemImageName: 'plus',
            onPress: () => {
              store.create();
            },
          },
        ]
      : [],
  );
  return placement !== 'contextual' || !hasDockActions;
}
