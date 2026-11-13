import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useMemo, useSyncExternalStore } from 'react';
import { useConversationSessions } from './ConversationSessionsContext';
import { ConversationComposer } from './ConversationComposer';
import { ConversationHeaderTitle } from './ConversationHeaderTitle';
import { styles } from './ConversationScreen.styles';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { ConversationHistory } from './ConversationHistory';
import { ConversationEntryAction } from './ConversationEntryAction';
import { ManualVisitTargetPanels } from './ManualVisitTargetPanels';
import { navigationText } from '../i18n/navigation';
import { getRagConversationCopy } from './copy';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useConversationSessionActions } from './useConversationSessionActions';
import { useConversationScreenLayout } from './useConversationScreenLayout';
import {
  useConversationEntryIntent,
  conversationEntryForSession,
} from './useConversationEntryIntent';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { sendConversationMessage } from './conversationVisitDispatch';
import { regenerateVisitQuestions } from './conversationVisitRegenerate';
import { useConversationScreenControls } from './useConversationScreenControls';
import { ConversationPhotoConsentSurface } from './ConversationPhotoConsentSurface';
import { t } from '../i18n';
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
  const { setContentHeight, composerLayout } = useConversationScreenLayout();
  const store = useConversationSessions();
  useConversationEntryIntent(store, entryContext);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const reportOwner = useMemo(
    () =>
      renderReportTask && navigationRouteKey
        ? store.reportTaskOwner(navigationRouteKey)
        : null,
    [store, renderReportTask, navigationRouteKey],
  );
  const session = snapshot.sessions.find(
    item => item.id === snapshot.activeId,
  )!;
  const { id, draft, messages, pendingMessage, busy, error } = session;
  const { photo, focus } = useConversationScreenControls(store, id);
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
              requestSessionId={id}
              requestActivity={session.requestActivity}
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
