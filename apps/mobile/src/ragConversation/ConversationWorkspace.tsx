import { useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { FloatingAssistantSurface } from '../assistantAppearance/FloatingAssistantSurface';
import {
  FloatingIdentityInset,
  useFloatingIdentityInset,
} from '../assistantAppearance/FloatingIdentityInset';
import { activityLabel } from '../assistantAppearance/AssistantHeader';
import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';
import type { ConversationHistoryProps } from './ConversationHistoryProps';
import { ConversationToolEvents } from './ConversationToolEvents';
import { SeparatedConversationActivity } from './ConversationWorkspaceContext';
import { conversationWorkspaceLayout } from './conversationWorkspaceLayout';

type SourceActions = Pick<
  ConversationHistoryProps,
  'onOpenSource' | 'onLinkError' | 'toolSourceSessionId' | 'resolveToolSource'
>;
type Props = {
  sourceActions: SourceActions;
  session: ConversationSession;
  children: ReactNode;
};

/** Stable presentation wrappers preserve transcript, composer and session across reflow. */
export function ConversationWorkspace(props: Props) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const geometry = useNavigationGeometry();
  const plan = conversationWorkspaceLayout(
    geometry?.hasHinge === true,
    width,
    fontScale,
  );
  return (
    <FloatingAssistantSurface
      session={props.session}
      identityWidth={plan.visible ? plan.activityWidth : undefined}
    >
      <View
        style={styles.row}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        testID="conversation-workspace"
      >
        <ActivityPane
          {...props}
          visible={plan.visible}
          width={plan.activityWidth}
        />
        <View style={styles.transcript}>
          <SeparatedConversationActivity.Provider value={plan.visible}>
            <TranscriptInset separated={plan.visible}>
              {props.children}
            </TranscriptInset>
          </SeparatedConversationActivity.Provider>
        </View>
      </View>
    </FloatingAssistantSurface>
  );
}

function TranscriptInset({
  separated,
  children,
}: {
  separated: boolean;
  children: ReactNode;
}) {
  const identityInset = useFloatingIdentityInset();
  return (
    <FloatingIdentityInset.Provider value={separated ? 0 : identityInset}>
      {children}
    </FloatingIdentityInset.Provider>
  );
}

/** Reuses only already-permitted activity summaries; mounting never fetches or executes tools. */
function ActivityPane({
  session,
  visible,
  width,
  sourceActions: props,
}: Props & { visible: boolean; width: number }) {
  const inset = useFloatingIdentityInset();
  const messages = session.pendingMessage
    ? [...session.messages, session.pendingMessage]
    : session.messages;
  const activity = activityLabel(session);
  const hasEvents = messages.some(message => message.toolEvents?.length);
  return (
    <View
      style={[styles.pane, { width }, !visible && styles.hidden]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      testID="conversation-activity-pane"
    >
      <ScrollView
        contentContainerStyle={[styles.activity, { paddingTop: inset + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('ragConversation.workspace.activity')}
        </AppText>
        {activity ? (
          <AppText accessibilityLiveRegion="polite" style={styles.secondary}>
            {activity}
          </AppText>
        ) : null}
        {!hasEvents ? (
          <AppText style={styles.secondary}>
            {t('ragConversation.workspace.empty')}
          </AppText>
        ) : null}
        {messages.map(message =>
          message.toolEvents?.length ? (
            <ConversationToolEvents
              key={message.id}
              events={message.toolEvents}
              messageId={message.toolMessageId ?? String(message.id)}
              durableMessageId={message.toolMessageId}
              sessionId={props.toolSourceSessionId}
              resolveToolSource={props.resolveToolSource}
              onOpenSource={props.onOpenSource}
              onLinkError={props.onLinkError}
              allowSourceActions
            />
          ) : null,
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, minHeight: 0, flexDirection: 'row' },
  transcript: { flex: 1, minWidth: 0, minHeight: 0 },
  pane: {
    minHeight: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: appColors.border,
  },
  hidden: { display: 'none' },
  activity: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  heading: { fontSize: 17, fontWeight: '600' },
  secondary: { fontSize: 14, color: appColors.secondary },
});
