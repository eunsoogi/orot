import { conversationComposerDisabled } from './conversationComposerDisabled';
import { useConversationPresentationSnapshot } from './useConversationPresentationSnapshot';
import { ConversationBackButton } from './ConversationBackButton';
import { AppText as Text } from '../layout/AppText';
import { useMemo } from 'react';
import { useContinuousConversationEntry } from './useContinuousConversationEntry';
import { useConversationSessions } from './ConversationSessionsContext';
import { ConversationSteeringComposer } from './ConversationSteeringComposer';
import { ConversationWorkspace } from './ConversationWorkspace';
import { styles } from './ConversationScreen.styles';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { ConversationHistory } from './ConversationHistory';
import { ConversationEntryAction } from './ConversationEntryAction';
import { ManualVisitTargetPanels } from './ManualVisitTargetPanels';
import { getRagConversationCopy } from './copy';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useConversationScreenLayout } from './useConversationScreenLayout';
import { conversationEntryForSession } from './useConversationEntryIntent';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { dispatchConversationMessage } from './conversationVisitDispatch';
import { regenerateVisitQuestions } from './conversationVisitRegenerate';
import { useConversationScreenControls } from './useConversationScreenControls';
import { ConversationPhotoConsentSurface } from './ConversationPhotoConsentSurface';
import { t } from '../i18n';
import { ConversationQuickChoices } from './ConversationQuickChoices';
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
  useContinuousConversationEntry(
    store,
    entryContext,
    session,
    voiceSelection?.revision,
    !isEntryCurrent || isEntryCurrent(),
  );
  const { id, messages, pendingMessage, busy, error } = session;
  const { photo, focus, quickChoices, ...composer } =
    useConversationScreenControls(
      store,
      id,
      isEntryCurrent,
      voiceSelection,
      busy,
      onSend,
      retainedActions,
      prepareVisitQuestions,
    );
  const selectedReport =
    session.dailyReport ?? conversationEntryForSession(store, id)?.dailyReport;
  const toolSourceSessionId = store.toolSourceSessionId(id);
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
      {providerSelection ? (
        <View style={styles.provider}>{providerSelection}</View>
      ) : null}
      <Text style={styles.disclaimer}>{copy.transmissionNotice}</Text>
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
      <View
        style={styles.content}
        testID="conversation-content-viewport"
        onLayout={event => setContentHeight(event.nativeEvent.layout.height)}
      >
        <ConversationWorkspace
          session={session}
          sourceActions={sourceActions}
          routeKey={navigationRouteKey}
          composer={
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
          }
        >
          <ConversationHistory
            replyFocus={focus}
            coldResumeBusy={coldResumeBusy}
            onContinueCold={requestId =>
              store.resumeCold(id, requestId).catch(() => {})
            }
            historyHasMore={session.historyHasMore}
            historyLoading={session.historyLoading}
            historyLoadFailed={session.historyLoadFailed}
            onLoadOlderHistory={() => store.loadOlderHistory(id)}
            sessionId={id}
            requestSessionId={id}
            requestActivity={session.requestActivity}
            compact={composerLayout.compact}
            header={header}
            steeringInstructions={session.steeringInstructions}
            messages={messages}
            pendingMessage={pendingMessage}
            error={error}
            unsavedCount={session.unsavedCount}
            retryingSave={session.retryingSave || busy}
            onRetrySave={() => {
              store.retrySave(id);
            }}
            restoreFailed={
              session.restoreFailed || session.modelSelectionFailed
            }
            onRetryRestore={() => {
              if (session.modelSelectionFailed)
                store.synchronizeModel(true).catch(() => {});
              else store.retryRestore(id);
            }}
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
                content="recaps"
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
              <>
                <ConversationTasks.ConversationStoredTaskCards
                  onRestart={question => store.sendPrompt(id, question, onSend)}
                  store={store}
                  session={session}
                  onOpenSource={onOpenSource}
                  routeKey={navigationRouteKey}
                  durableSessionId={toolSourceSessionId}
                  renderStoredReportTask={renderStoredReportTask}
                />
                <ConversationQuickChoices>
                  <ConversationTasks.ConversationTaskHeader
                    store={store}
                    session={session}
                    onOpenSource={onOpenSource}
                    selectedReport={selectedReport}
                    routeKey={navigationRouteKey}
                    reportOwner={reportOwner}
                    onOpenDailyReport={onOpenDailyReport}
                    retainedActions={quickChoices}
                    visitAction={
                      <ConversationEntryAction
                        {...{ store, session, prepareVisitQuestions }}
                      />
                    }
                    renderReportTask={renderReportTask}
                    renderSavedReport={renderSavedReport}
                  />
                </ConversationQuickChoices>
              </>
            }
          />
        </ConversationWorkspace>
      </View>
    </KeyboardAvoidingView>
  );
}
