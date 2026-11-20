import { useContext, useState } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import {
  DailyReportSourceLinks,
  DailyReportSourceResolverContext,
} from '../aiFeatures/integration/DailyReportSourceLinks';
import type { ColdConversationSourceOwner } from '../aiFeatures/integration/coldConversationSourceResolvers';
import { t } from '../i18n';
import type { DisplayMessage } from './conversationDisplayMessage';
import { ConversationSources } from './ConversationSources';

/** Own this row's evidence display and immediately suppress confirmed stale report revisions. */
export function useConversationMessageEvidence({
  suppliedMessage,
  showCitations,
  onOpenSource,
  onLinkError,
}: {
  readonly suppliedMessage: DisplayMessage;
  readonly showCitations: boolean;
  readonly onOpenSource: (
    reference: EvidenceReference,
    owner?: ColdConversationSourceOwner,
  ) => void;
  readonly onLinkError: () => void;
}) {
  const resolveDailyReport = useContext(DailyReportSourceResolverContext);
  const [unavailableReportKey, setUnavailableReportKey] = useState<string>();
  const target = suppliedMessage.dailyReport;
  const reportKey = target
    ? JSON.stringify([target.identity.key, target.runId, target.revision])
    : undefined;
  // A confirmed stale revision may remain in the transcript until its owner
  // refreshes. Suppress only this row's prose and sources immediately.
  const message: DisplayMessage =
    reportKey !== undefined && unavailableReportKey === reportKey
      ? {
          id: suppliedMessage.id,
          role: suppliedMessage.role,
          content: t('dailyReport.sourceError'),
          restoredHistory: suppliedMessage.restoredHistory,
        }
      : suppliedMessage;
  // Alias identity belongs to this answer, never to whichever run is globally current.
  const openSource = (reference: EvidenceReference) =>
    message.sourceOwner
      ? onOpenSource(reference, message.sourceOwner)
      : onOpenSource(reference);
  const citations =
    showCitations && message.dailyReport && resolveDailyReport ? (
      <DailyReportSourceLinks
        key={reportKey}
        {...message.dailyReport}
        resolve={resolveDailyReport}
        testIDPrefix={`rag-conversation-message-${message.id}-report`}
        onOpen={onOpenSource}
        onStale={() => {
          setUnavailableReportKey(reportKey);
          onLinkError();
        }}
      />
    ) : showCitations ? (
      <ConversationSources
        testIDPrefix={`rag-conversation-message-${message.id}`}
        references={message.citations ?? []}
        onOpenSource={openSource}
        onLinkError={onLinkError}
      />
    ) : null;
  return { message, openSource, citations };
}
