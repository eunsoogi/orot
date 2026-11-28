import { ConversationA2UILocalDraftOwner } from './conversationA2UILocalDraftOwner';
import { FloatingComposerSurface } from './FloatingComposerSurface';
import { NavigationOcclusionContext } from '../navigation/useNavigationContentInset';
import { type ContextType, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { FloatingAssistantSurface } from '../assistantAppearance/FloatingAssistantSurface';
import {
  FloatingIdentityInset,
  useFloatingIdentityInset,
} from '../assistantAppearance/FloatingIdentityInset';
import { activityLabel } from '../assistantAppearance/AssistantHeader';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';
import type { ConversationHistoryProps } from './ConversationHistoryProps';
import { ConversationToolEvents } from './ConversationToolEvents';
import {
  ConversationTranscriptTrailingLane,
  SeparatedConversationActivity,
} from './ConversationWorkspaceContext';
import { useConversationWorkspaceBounds } from './useConversationWorkspaceBounds';

import { conversationComposerDisabled } from './conversationComposerDisabled';
import { DirectPhotoPresentationScope } from './DirectPhotoPresentationScope';

type SourceActions = Pick<
  ConversationHistoryProps,
  'onOpenSource' | 'onLinkError' | 'toolSourceSessionId' | 'resolveToolSource'
>;
type Props = {
  sourceActions: SourceActions;
  localDraftOwner?: ContextType<typeof ConversationA2UILocalDraftOwner>;
  isEntryCurrent?: () => boolean;
  session: ConversationSession;
  children: ReactNode;
  composer?: ReactNode;
  photoPresentationAllowed?: () => boolean;
  photoOwnerKey?: object;
  routeKey?: string;
};

/** Stable presentation wrappers preserve transcript, composer and session across reflow. */
export function ConversationWorkspace(props: Props) {
  const {
    ref,
    measure,
    plan,
    profileVisualLift,
    workspaceOcclusion,
    trailingLane,
  } = useConversationWorkspaceBounds(props.routeKey);
  return (
    <View
      ref={ref}
      onLayout={measure}
      style={styles.host}
      testID="conversation-workspace-host"
    >
      <View
        style={[
          styles.frame,
          {
            height: plan.height,
            marginTop: plan.top,
            marginLeft: plan.leading,
            width: plan.activityWidth + plan.gap + plan.transcriptWidth,
          },
        ]}
      >
        <FloatingAssistantSurface
          session={props.session}
          profileVisualLift={profileVisualLift}
          identityWidth={
            plan.visible ? plan.activityWidth : plan.transcriptWidth
          }
        >
          <View
            style={[styles.row, !plan.visible && styles.single]}
            onLayout={measure}
            testID="conversation-workspace"
          >
            <ActivityPane
              {...props}
              visible={plan.visible}
              width={plan.activityWidth}
            />
            <View
              testID="conversation-transcript-pane"
              style={[
                styles.transcript,
                !plan.visible && styles.compactTranscript,
                { marginLeft: plan.gap, width: plan.transcriptWidth },
              ]}
            >
              <SeparatedConversationActivity.Provider value={plan.visible}>
                <TranscriptInset separated={plan.visible}>
                  <DirectPhotoPresentationScope
                    sessionId={props.session.id}
                    ownerKey={props.photoOwnerKey}
                    routeCurrent={() =>
                      (props.photoPresentationAllowed?.() ?? true) &&
                      (props.isEntryCurrent?.() ?? true)
                    }
                    available={
                      !conversationComposerDisabled(props.session) &&
                      !props.session.leaseRefreshRequired
                    }
                  >
                    <FloatingComposerSurface
                      composer={
                        <NavigationOcclusionContext.Provider
                          value={workspaceOcclusion}
                        >
                          {props.composer}
                        </NavigationOcclusionContext.Provider>
                      }
                    >
                      <ConversationA2UILocalDraftOwner.Provider
                        value={props.localDraftOwner}
                      >
                        <ConversationTranscriptTrailingLane.Provider
                          value={trailingLane}
                        >
                          {props.children}
                        </ConversationTranscriptTrailingLane.Provider>
                      </ConversationA2UILocalDraftOwner.Provider>
                    </FloatingComposerSurface>
                  </DirectPhotoPresentationScope>
                </TranscriptInset>
              </SeparatedConversationActivity.Provider>
            </View>
          </View>
        </FloatingAssistantSurface>
      </View>
    </View>
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
  // This pane is transient activity, not history. Answer citations and persisted
  // source/consent/checkpoint records remain owned by their existing surfaces.
  const liveMessages = messages.filter(
    message => !('restoredHistory' in message && message.restoredHistory),
  );
  const hasEvents = liveMessages.some(message => message.toolEvents?.length);
  return (
    <View
      style={[styles.pane, { width }, !visible && styles.hidden]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      testID="conversation-activity-pane"
    >
      <ScrollView
        testID="conversation-activity-lines"
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
        {liveMessages.map(message =>
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
  frame: { minHeight: 0 },
  single: { flexDirection: 'column' },
  host: { flex: 1, minWidth: 0, minHeight: 0 },
  row: { flex: 1, minHeight: 0, flexDirection: 'row' },
  compactTranscript: { flex: 1 },
  transcript: { minWidth: 0, minHeight: 0 },
  pane: {
    minHeight: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: appColors.border,
  },
  hidden: { display: 'none' },
  // Avoid stacking extra blank lines between already accessible 44pt disclosures.
  activity: { paddingHorizontal: 20, paddingBottom: 20, gap: 4 },
  heading: { fontSize: 17, fontWeight: '600' },
  secondary: { fontSize: 14, color: appColors.secondary },
});
