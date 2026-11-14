import { useAppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import { DailyReportFlowScreen } from './DailyReportFlowScreen';
import { DailyReportRoute } from './DailyReportRoute';
import { ConversationReportTask } from './ConversationReportTask';
import { conversationIntentForRoute } from './conversationIntent';
import { AiProviderSelectorRow } from './AiProviderSelectorRow';
import { SummaryHistoryScreen } from '../../diseaseHypotheses/SummaryHistoryScreen';
import { ConversationSummaryHistory } from '../../diseaseHypotheses/ConversationSummaryHistory';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationHistoryScreen } from '../../ragConversation/ConversationHistoryScreen';
import { useColorScheme } from 'react-native';
import { createNextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { ConversationVisitQuestionCard } from './ConversationVisitQuestionCard';
import { defaultVisitQuestionRouteOperations } from './visitQuestionsRouteOperations';

export type {
  VisitQuestionsRenderInput,
  VisitQuestionsRouteState,
  AiFeatureFlowScreenProps,
} from './AiFeatureFlowScreenTypes';
import type { AiFeatureFlowScreenProps } from './AiFeatureFlowScreenTypes';

/** Renders one stack destination while the parent keeps source/provider overlays mounted above it. */
export function AiFeatureFlowScreen({
  isEntryCurrent,
  onOpenSavedAnalysis,
  onOpenSavedVisitQuestions,
  onRestoreSummary,
  route,
  navigationRouteKey,
  onFeatureNavigationStateChange,
  renderVisitQuestions,
  onRouteStateChange,
  onBack,
  onOpenProviderSelection,
  onOpenConversationHistory,
  onOpenDailyReport,
  reportOwnsOperation,
  onOpenSource,
  resolveSelectedAi,
  confirmConsent,
  selectedAiRevision,
  services,
}: AiFeatureFlowScreenProps) {
  const providerSelection = (
    <AiProviderSelectorRow
      embedded
      onPress={onOpenProviderSelection}
      resolveSelectedAi={resolveSelectedAi}
      revision={selectedAiRevision}
    />
  );
  const intent = conversationIntentForRoute(route);
  const reminderRuntime = useAppointmentReminderRuntime();
  const followUp = reminderRuntime?.dailyReportFollowUps.get(
    navigationRouteKey ?? '',
  );
  const colorScheme = useColorScheme();
  // Navigation prepares a request; only an explicit Send can start inference or consent.
  const conversation = (
    <ConversationScreen
      isEntryCurrent={isEntryCurrent}
      entryContext={{
        intent: intent ?? 'conversation',
        entryKey: navigationRouteKey ?? route,
        appointmentId: reminderRuntime?.overviewPreparationTargets.get(
          navigationRouteKey ?? '',
        ),
        ...(followUp ? { dailyReport: followUp } : {}),
      }}
      providerSelection={providerSelection}
      voiceSelection={{
        revision: selectedAiRevision,
        resolve: resolveSelectedAi,
      }}
      renderStoredReportTask={(card, onChat, onTaskIdentity, onTaskResult) => (
        <ConversationReportTask
          card={card}
          services={services}
          onChat={onChat}
          onTaskIdentity={onTaskIdentity}
          onTaskResult={onTaskResult}
          onBack={onBack}
          onOpenSource={onOpenSource}
          ownsOperation={reportOwnsOperation}
        />
      )}
      renderSavedReport={
        services.dailyReport
          ? (report, onChat) => (
              <DailyReportRoute
                key={report.identity.key}
                feature={services.dailyReport!}
                initialIdentity={report.identity}
                expectedReport={report}
                providerSelection={null}
                onBack={onBack}
                onChat={onChat}
                resolveSources={services.dailyReportSources}
                onOpenSource={onOpenSource}
                ownsOperation={reportOwnsOperation}
                inline
              />
            )
          : undefined
      }
      renderReportTask={
        route === 'daily-report'
          ? (
              onChat,
              onTaskIdentity,
              onTaskResult,
              expectedReport,
              taskRevision,
            ) => (
              <DailyReportFlowScreen
                services={services}
                routeKey={navigationRouteKey}
                providerSelection={null}
                onBack={onBack}
                onChat={onChat}
                onTaskIdentity={onTaskIdentity}
                onTaskResult={onTaskResult}
                expectedReport={expectedReport}
                taskRevision={taskRevision}
                onOpenSource={onOpenSource}
                ownsOperation={reportOwnsOperation}
                fallback={null}
                inline
              />
            )
          : undefined
      }
      navigationRouteKey={navigationRouteKey}
      onNavigationStateChange={onFeatureNavigationStateChange}
      onBack={onBack}
      onOpenHistory={onOpenConversationHistory}
      onOpenDailyReport={onOpenDailyReport}
      onSend={services.sendRagMessage}
      onOpenSource={onOpenSource}
      resolveToolSource={services.resolveToolSource}
      resolveColdToolSource={services.resolveColdConversationToolSource}
      discoverManualVisits={services.conversationArtifacts}
      prepareVisitQuestions={
        services.prepareVisitQuestionTurn
          ? (question, _history, signal, observer, context) =>
              services.prepareVisitQuestionTurn!({
                question,
                context,
                signal: signal ?? new AbortController().signal,
                observer,
                resolveSelectedAi,
                confirmConsent,
              })
          : undefined
      }
      renderVisitQuestions={(message, sessionId, store, onRegenerate) => (
        <ConversationVisitQuestionCard
          message={message}
          sessionId={sessionId}
          store={store}
          operations={defaultVisitQuestionRouteOperations}
          services={services}
          onOpenSource={onOpenSource}
          theme={createNextVisitQuestionsTheme(colorScheme === 'dark')}
          onRegenerate={onRegenerate}
        />
      )}
    />
  );
  if (intent !== null) return conversation;

  switch (route) {
    case 'daily-report':
      return conversation;
    case 'saved-visit-questions':
      return renderVisitQuestions
        ? renderVisitQuestions({
            readOnly: true,
            navigationRouteKey,
            onBack,
            onOpenProviderSelection,
            onOpenSource,
            onRouteStateChange,
            resolveSelectedAi,
            confirmConsent,
            resolveSource: services.resolveSource,
            generatedArtifactTools: services.generatedArtifactTools,
            registerVisitQuestionSource: services.registerVisitQuestionSource,
            selectedAiRevision,
            loadSavedVisitQuestions: services.loadSavedVisitQuestions,
          })
        : conversation;
    case 'saved-analysis':
      return (
        <ConversationSummaryHistory
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          history={services.summaryHistory}
          onOpenSource={onOpenSource}
        />
      );
    case 'conversation-history':
      return (
        <ConversationHistoryScreen
          onBack={onBack}
          onOpenSavedAnalysis={onOpenSavedAnalysis}
          onOpenSavedVisitQuestions={onOpenSavedVisitQuestions}
        />
      );
    case 'summary-history':
      return services.summaryHistory && onRestoreSummary ? (
        <SummaryHistoryScreen
          history={services.summaryHistory}
          onRestore={onRestoreSummary}
        />
      ) : (
        conversation
      );
    default:
      return conversation;
  }
}
