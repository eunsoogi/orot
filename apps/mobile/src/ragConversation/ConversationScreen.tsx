import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useConversationSessions } from './ConversationSessionsContext';
import { ConversationComposer } from './ConversationComposer';
import { ConversationHeaderTitle } from './ConversationHeaderTitle';
import { styles } from './ConversationScreen.styles';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  useWindowDimensions,
} from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { ConversationHistory } from './ConversationHistory';
import { ConversationEntryAction } from './ConversationEntryAction';
import { ManualVisitTargetPanels } from './ManualVisitTargetPanels';
import { navigationText } from '../i18n/navigation';
import { getRagConversationCopy } from './copy';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useNavigationOcclusion } from '../navigation/useNavigationContentInset';
import { useConversationSessionActions } from './useConversationSessionActions';
import { conversationComposerLayout } from './conversationComposerLayout';
import {
  useConversationEntryIntent,
  conversationEntryForSession,
} from './useConversationEntryIntent';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { sendConversationMessage } from './conversationVisitDispatch';
import { regenerateVisitQuestions } from './conversationVisitRegenerate';
import { useConversationPhotoControls } from './useConversationPhotoControls';
import { ConversationPhotoConsentSurface } from './ConversationPhotoConsentSurface';
import { t } from '../i18n';
import { useReplyFocusForSession } from '../replyNotifications/replyFocus';
import {
  ConversationTaskHeader,
  ConversationStoredTaskCards,
} from './ConversationTaskPanels';

/** Presents app-owned sessions as a transcript above a persistent composer. */
export function ConversationScreen({
  entryContext,
  navigationRouteKey,
  providerSelection,
  renderReportTask,
  renderSavedReport,
  renderStoredReportTask,
  onNavigationStateChange,
  onBack,
  onOpenHistory,
  onOpenDailyReport,
  onSend,
  onOpenSource,
  resolveToolSource,
  prepareVisitQuestions,
  renderVisitQuestions,
  discoverManualVisits,
}: ConversationScreenProps) {
  const copy = getRagConversationCopy();
  const [contentHeight, setContentHeight] = useState(0);
  const { fontScale } = useWindowDimensions();
  const occlusion = useNavigationOcclusion();
  const composerLayout = conversationComposerLayout(
    contentHeight,
    occlusion.scrollContentInsets.bottom,
    fontScale,
  );
  const store = useConversationSessions();
  useConversationEntryIntent(store, entryContext);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const hasReportTask = Boolean(renderReportTask);
  const reportOwner = useMemo(
    () =>
      hasReportTask && navigationRouteKey
        ? store.reportTaskOwner(navigationRouteKey)
        : null,
    [store, hasReportTask, navigationRouteKey],
  );
  const session = snapshot.sessions.find(
    item => item.id === snapshot.activeId,
  )!;
  const { id, draft, messages, pendingMessage, busy, error } = session;
  const photo = useConversationPhotoControls(store, id);
  const focus = useReplyFocusForSession(id);
  const selectedReport =
    session.dailyReport ?? conversationEntryForSession(store, id)?.dailyReport;
  // Source validation uses the retained identity, not the session's view-only numeric ID.
  const toolSourceSessionId = store.toolSourceSessionId(id);
  const showSessionActionsInHeader = useConversationSessionActions(
    store,
    copy,
    onOpenHistory,
  );
  const onLinkError = () =>
    store.setError(id, t('ragConversation.conversation.sourceOpenFailed'));
  // App-owned sessions keep drafts and requests alive when this route is removed.
  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: false,
    },
    0,
    onNavigationStateChange,
  );

  const header = (
    <View style={styles.header}>
      {!navigationRouteKey && (
        <Button
          accessibilityLabel={navigationText.back.accessibilityLabel}
          onPress={onBack}
          title={navigationText.back.label}
        />
      )}
      <ConversationHeaderTitle
        title={copy.title}
        session={session}
        historyLabel={copy.sessions}
        newLabel={copy.newConversation}
        showActions={showSessionActionsInHeader}
        onHistory={onOpenHistory}
        onNew={store.create}
      />
      {providerSelection ? (
        <View style={styles.provider}>{providerSelection}</View>
      ) : null}
      <Text style={styles.disclaimer}>{copy.transmissionNotice}</Text>
      <ConversationEntryAction
        store={store}
        session={session}
        prepareVisitQuestions={prepareVisitQuestions}
      />
      <ConversationTaskHeader
        store={store}
        session={session}
        onOpenSource={onOpenSource}
        selectedReport={selectedReport}
        routeKey={navigationRouteKey}
        reportOwner={reportOwner}
        onOpenDailyReport={onOpenDailyReport}
        renderReportTask={renderReportTask}
        renderSavedReport={renderSavedReport}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={
        !navigationRouteKey && Platform.OS === 'ios' ? 'padding' : undefined
      }
      style={styles.screen}
      testID="rag-conversation-screen"
    >
      <ConversationPhotoConsentSurface controller={store.photoConsent} />
      <AdaptiveColumns
        routeKey={navigationRouteKey}
        testID="rag-conversation-columns"
        primary={
          <View
            style={styles.content}
            onLayout={event =>
              setContentHeight(event.nativeEvent.layout.height)
            }
          >
            <ConversationHistory
              replyFocus={focus}
              compact={composerLayout.compact}
              header={header}
              messages={messages}
              pendingMessage={pendingMessage}
              error={error}
              unsavedCount={session.unsavedCount}
              retryingSave={session.retryingSave || busy}
              onRetrySave={() => {
                store.retrySave(id);
              }}
              restoreFailed={session.restoreFailed}
              onRetryRestore={() => {
                store.retryRestore(id);
              }}
              onOpenSource={onOpenSource}
              resolveToolSource={resolveToolSource}
              renderVisitQuestions={
                renderVisitQuestions
                  ? message =>
                      renderVisitQuestions(message, id, store, () =>
                        regenerateVisitQuestions({
                          store,
                          sessionId: id,
                          message,
                          prepare: prepareVisitQuestions,
                        }),
                      )
                  : undefined
              }
              toolSourceSessionId={toolSourceSessionId}
              onLinkError={onLinkError}
              beforeMessages={
                <ManualVisitTargetPanels
                  store={store}
                  sessionId={id}
                  durableSessionId={toolSourceSessionId}
                  discover={discoverManualVisits}
                  messages={messages}
                  session={session}
                  compact={composerLayout.compact}
                  disclaimer={copy.disclaimer}
                />
              }
              footer={
                <ConversationStoredTaskCards
                  store={store}
                  session={session}
                  onOpenSource={onOpenSource}
                  routeKey={navigationRouteKey}
                  durableSessionId={toolSourceSessionId}
                  renderStoredReportTask={renderStoredReportTask}
                />
              }
            />
            <ConversationComposer
              photo={photo}
              value={draft}
              busy={busy}
              disabled={
                session.restoring ||
                session.restoreFailed ||
                session.quarantined ||
                session.retryingSave ||
                (session.restoreAfterRetry && Boolean(session.unsavedCount))
              }
              compact={composerLayout.compact}
              maximumInputHeight={composerLayout.maximumInputHeight}
              onChangeText={value => store.setDraft(id, value)}
              onSend={() => {
                sendConversationMessage(
                  store,
                  id,
                  onSend,
                  prepareVisitQuestions,
                ).catch(() => {});
              }}
              onCancel={() => store.cancel(id)}
            />
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}
