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

/** Restored cards expose only the committed report as an assistant message; they never restart work. */
export function ConversationReportTask({
  card,
  sessionId,
  services,
  onOpenSource,
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
