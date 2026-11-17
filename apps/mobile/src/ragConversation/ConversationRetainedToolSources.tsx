import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { ConversationHistoryProps } from './ConversationHistoryProps';
import { ConversationToolEventSources } from './ConversationToolEventSources';

type Props = Pick<
  ConversationHistoryProps,
  'onOpenSource' | 'onLinkError' | 'resolveToolSource'
> & {
  events: readonly ConversationToolEvent[];
  sessionId?: string | null;
  durableMessageId?: string;
};

/** History retains evidence access, not a replay of completed execution progress.
 * Keep the existing source resolver and its action-time revocation checks intact.
 */
export function ConversationRetainedToolSources(props: Props) {
  const [expanded, setExpanded] = useState(false);
  const events = props.events.filter(event => event.sources.length > 0);
  if (!events.length) return null;
  return (
    <View testID="conversation-retained-tool-sources">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        style={styles.toolEventToggle}
      >
        <AppText style={styles.toolEventName}>
          {t('ragConversation.tool.sources')}
        </AppText>
      </Pressable>
      {expanded
        ? events.map(event => (
            <ConversationToolEventSources
              key={`${event.operationRunId}/${event.callId}`}
              event={event}
              sessionId={props.sessionId ?? null}
              durableMessageId={props.durableMessageId}
              resolveToolSource={props.resolveToolSource}
              onOpenSource={props.onOpenSource}
              onLinkError={props.onLinkError}
              allowSourceActions
            />
          ))
        : null}
    </View>
  );
}
