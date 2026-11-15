import { conversationComposerDisabled } from './conversationComposerDisabled';
import { useConversationPresentationSnapshot } from './useConversationPresentationSnapshot';
import { ConversationBackButton } from './ConversationBackButton';
import { AppText as Text } from '../layout/AppText';
import { useMemo } from 'react';
import { useConversationSessions } from './ConversationSessionsContext';
import { ConversationSteeringComposer } from './ConversationSteeringComposer';
import { ConversationWorkspace } from './ConversationWorkspace';
import { ConversationHeaderTitle } from './ConversationHeaderTitle';
import { styles } from './ConversationScreen.styles';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { ConversationHistory } from './ConversationHistory';
import { ConversationEntryAction } from './ConversationEntryAction';
import { ManualVisitTargetPanels } from './ManualVisitTargetPanels';
import { getRagConversationCopy } from './copy';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useConversationSessionActions } from './useConversationSessionActions';
import { useConversationScreenLayout } from './useConversationScreenLayout';
import {
  useConversationEntryIntent,
  conversationEntryForSession,
} from './useConversationEntryIntent';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { dispatchConversationMessage } from './conversationVisitDispatch';
import { regenerateVisitQuestions } from './conversationVisitRegenerate';
import { useConversationScreenControls } from './useConversationScreenControls';
import { ConversationPhotoConsentSurface } from './ConversationPhotoConsentSurface';
import { t } from '../i18n';
import * as ConversationTasks from './ConversationTaskPanels';
/** Presents app-owned sessions as a transcript above a persistent composer. */
export function ConversationScreen({
  isEntryCurrent,
  entryContext,
  navigationRouteKey,
  providerSelection,
  voiceSelection,
  renderReportTask,
  renderSavedReport,
  renderStoredReportTask,
  onNavigationStateChange,
  onBack,
  onOpenHistory,
  onOpenDailyReport,
  retainedActions,
  onSend,
  onOpenSource,
  resolveToolSource,
  resolveColdToolSource,
  prepareVisitQuestions,
  renderVisitQuestions,
  discoverManualVisits,
}: ConversationScreenProps) {
  const copy = getRagConversationCopy();
  const { setContentHeight, composerLayout } = useConversationScreenLayout();
  const store = useConversationSessions();
  useConversationEntryIntent(store, entryContext);
  const snapshot = useConversationPresentationSnapshot(store, isEntryCurrent);
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
  const { id, messages, pendingMessage, busy, error } = session;
  const { photo, focus, ...composer } = useConversationScreenControls(
    store,
    id,
    isEntryCurrent,
    voiceSelection,
    busy,
    onSend,
  );
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
  const sourceActions = {
    onOpenSource,
    onLinkError,
    toolSourceSessionId,
    resolveToolSource,
  };
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
  const coldResumeBusy = busy || session.restoring || session.retryingSave;

  const header = (
    <View style={styles.header}>
      {!navigationRouteKey && <ConversationBackButton onBack={onBack} />}
      <ConversationHeaderTitle
        title={copy.title}
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
      <ConversationTasks.ConversationTaskHeader
        store={store}
        session={session}
        onOpenSource={onOpenSource}
        selectedReport={selectedReport}
        routeKey={navigationRouteKey}
        reportOwner={reportOwner}
        onOpenDailyReport={onOpenDailyReport}
        retainedActions={retainedActions}
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
            testID="conversation-content-viewport"
            onLayout={event =>
              setContentHeight(event.nativeEvent.layout.height)
            }
          >
            <ConversationWorkspace
              session={session}
              sourceActions={sourceActions}
            >
              <ConversationHistory
                replyFocus={focus}
                coldResumeBusy={coldResumeBusy}
                onContinueCold={requestId =>
                  store.resumeCold(id, requestId).catch(() => {})
                }
                sessionId={id}
                requestSessionId={id}
                requestActivity={session.requestActivity}
                compact={composerLayout.compact}
                header={header}
                messages={messages}
                pendingMessage={pendingMessage}
                error={error}
                unsavedCount={session.unsavedCount}
                retryingSave={session.retryingSave || busy}
                onRetrySave={() => store.retrySave(id)}
                restoreFailed={session.restoreFailed}
                onRetryRestore={() => store.retryRestore(id)}
                onOpenSource={onOpenSource}
                {...{ resolveToolSource, resolveColdToolSource }}
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
                  <ConversationTasks.ConversationStoredTaskCards
                    store={store}
                    session={session}
                    onOpenSource={onOpenSource}
                    routeKey={navigationRouteKey}
                    durableSessionId={toolSourceSessionId}
                    renderStoredReportTask={renderStoredReportTask}
                  />
                }
              />
            </ConversationWorkspace>
            <ConversationSteeringComposer
              {...composer}
              photo={photo}
              session={session}
              store={store}
              cancelling={session.requestActivity?.stage === 'cancelling'}
              disabled={conversationComposerDisabled(session)}
              compact={composerLayout.compact}
              maximumInputHeight={composerLayout.maximumInputHeight}
              onChangeText={value => store.setDraft(id, value)}
              onSend={() =>
                dispatchConversationMessage(
                  store,
                  id,
                  onSend,
                  prepareVisitQuestions,
                )
              }
              onCancel={() => store.cancel(id)}
            />
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}
