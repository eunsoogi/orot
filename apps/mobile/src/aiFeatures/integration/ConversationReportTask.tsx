import type { EvidenceReference } from '@orot/agent-runtime';
import type { DailyReportIdentity } from '@orot/domain';
import type { RetainedConversationTask } from '../../ragConversation/conversationTaskState';
import type { ConversationEntryContext } from './conversationIntent';
import type { AiFeatureServices } from './featureServices';
import { DailyReportRoute } from './DailyReportRoute';

/** Restored cards re-read the existing report; opening them never starts generation. */
export function ConversationReportTask({
  card,
  services,
  onChat,
  onTaskIdentity,
  onTaskResult,
  onBack,
  onOpenSource,
  ownsOperation,
}: {
  card: RetainedConversationTask;
  services: AiFeatureServices;
  onChat: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => void;
  onTaskIdentity: (identity: DailyReportIdentity) => Promise<void>;
  onTaskResult: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => Promise<void>;
  onBack: () => void;
  onOpenSource: (source: EvidenceReference) => void;
  ownsOperation?: boolean;
}) {
  if (card.task.kind !== 'daily_report' || !services.dailyReport) return null;
  return (
    <DailyReportRoute
      feature={services.dailyReport}
      initialIdentity={card.task.identity}
      expectedReport={card.task.report}
      taskRevision={card.revision}
      onTaskIdentity={onTaskIdentity}
      onTaskResult={onTaskResult}
      providerSelection={null}
      onBack={onBack}
      onChat={onChat}
      resolveSources={services.dailyReportSources}
      onOpenSource={onOpenSource}
      ownsOperation={ownsOperation}
      inline
    />
  );
}
