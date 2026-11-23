import type { EvidenceReference } from '@orot/agent-runtime';
import type { RetainedConversationTask } from '../../ragConversation/conversationTaskState';
import type { AiFeatureServices } from './featureServices';
import { ConversationSavedReportMessage } from './ConversationSavedReportMessage';
import type { ComponentProps } from 'react';
import { DailyReportRoute } from './DailyReportRoute';

/** Restored cards show committed reports; reminders first read their delivered day, never auto-start work. */
export function ConversationReportTask({
  card,
  services,
  onOpenSource,
  onChat,
  onTaskIdentity,
  onTaskResult,
  onBack,
  ownsOperation,
}: {
  card: RetainedConversationTask;
  services: AiFeatureServices;
  onOpenSource: (source: EvidenceReference) => void;
} & Pick<
  ComponentProps<typeof DailyReportRoute>,
  'onChat' | 'onTaskIdentity' | 'onTaskResult' | 'onBack' | 'ownsOperation'
>) {
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
        showTodaySelection={false}
        providerSelection={null}
        onTaskIdentity={onTaskIdentity}
        onTaskResult={onTaskResult}
        onChat={onChat}
        onBack={onBack}
        ownsOperation={ownsOperation}
        resolveSources={services.dailyReportSources}
        onOpenSource={onOpenSource}
      />
    );
  // A date-only history item is not a new report request.
  if (!card.task.report) return null;
  return (
    <ConversationSavedReportMessage
      target={card.task.report}
      services={services}
      onOpenSource={onOpenSource}
    />
  );
}
