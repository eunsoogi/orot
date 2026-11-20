import { createDailyReportIdentity } from '@orot/domain';
import { todayIdentity } from './dailyReportTodayIdentity';
import { useConversationSessions } from '../../ragConversation/ConversationSessionsContext';
import { startConversationReportTurn } from '../../ragConversation/startConversationReportTurn';
import { AppButton } from '../../layout/AppButton';
import { t } from '../../i18n';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { RetainedConversationTask } from '../../ragConversation/conversationTaskState';
import type { AiFeatureServices } from './featureServices';
import { ConversationSavedReportMessage } from './ConversationSavedReportMessage';
import type { ComponentProps } from 'react';
import { DailyReportRoute } from './DailyReportRoute';

/** Restored cards show committed reports; reminders first read their delivered day, never auto-start work. */
export function ConversationReportTask({
  card,
  sessionId,
  services,
  onOpenSource,
  onChat,
  onTaskIdentity,
  onTaskResult,
  onBack,
  ownsOperation,
}: {
  card: RetainedConversationTask;
  sessionId: number;
  services: AiFeatureServices;
  onOpenSource: (source: EvidenceReference) => void;
} & Pick<
  ComponentProps<typeof DailyReportRoute>,
  'onChat' | 'onTaskIdentity' | 'onTaskResult' | 'onBack' | 'ownsOperation'
>) {
  const store = useConversationSessions();
  if (card.task.kind !== 'daily_report') return null;
  // Reminder entry is a read of the delivered day, not authority to start today's generation.
  if (card.task.reminder && services.dailyReport)
    return (
      <DailyReportRoute
        feature={services.dailyReport}
        initialIdentity={card.task.identity}
        expectedReport={card.task.report}
        taskRevision={card.revision}
        reminder
        inline
        providerSelection={null}
        onTaskIdentity={onTaskIdentity}
        onTaskResult={onTaskResult}
        onSelectToday={async request => {
          await onTaskIdentity?.(
            createDailyReportIdentity(request.localDate, request.timeZone),
          );
        }}
        onChat={onChat}
        onBack={onBack}
        ownsOperation={ownsOperation}
        resolveSources={services.dailyReportSources}
        onOpenSource={onOpenSource}
      />
    );
  if (!card.task.report)
    return (
      <AppButton
        title={t(
          card.task.identity.key === todayIdentity()?.key
            ? 'dailyReport.generate'
            : 'dailyReport.selectToday',
        )}
        onPress={() => {
          startConversationReportTurn(
            store,
            () => store.getSnapshot().activeId === sessionId,
            services.sendRagMessage,
          );
        }}
      />
    );
  return (
    <ConversationSavedReportMessage
      target={card.task.report}
      services={services}
      onOpenSource={onOpenSource}
    />
  );
}
