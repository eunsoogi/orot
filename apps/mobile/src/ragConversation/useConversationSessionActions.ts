import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { useNavigationActionPlacement } from '../navigation/useNavigationActionPlacement';
import { getRagConversationCopy } from './copy';

/** Register session actions where the current navigation geometry can expose them. */
export function useConversationSessionActions(
  onOpenHistory: (() => void) | undefined,
  onCreate: () => void,
) {
  const copy = getRagConversationCopy();
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
            onPress: onCreate,
          },
        ]
      : [],
  );
  return placement !== 'contextual' || !hasDockActions;
}
