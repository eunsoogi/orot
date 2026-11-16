import { useEffect, useState } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { AiFeatureServices } from './featureServices';
import type { ConversationEntryContext } from './conversationIntent';
import { ConversationMessage } from '../../ragConversation/ConversationMessage';
import { conversationDailyReportText } from './conversationDailyReportText';
import { t } from '../../i18n';

/** Legacy card restoration is lookup-only and joins the transcript without reopening a generation form. */
export function ConversationSavedReportMessage({
  target,
  services,
  onOpenSource,
}: {
  target: NonNullable<ConversationEntryContext['dailyReport']>;
  services: AiFeatureServices;
  onOpenSource: (source: EvidenceReference) => void;
}) {
  const [content, setContent] = useState('');
  const [citations, setCitations] = useState<readonly EvidenceReference[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setContent('');
    setCitations([]);
    async function restore() {
      const saved = await services.dailyReport?.lookup(target.identity);
      if (controller.signal.aborted) return;
      if (
        !saved ||
        saved.status !== 'saved' ||
        saved.runId !== target.runId ||
        saved.revision !== target.revision
      ) {
        setContent(t('dailyReport.sourceError'));
        return;
      }
      const sources = await services.dailyReportSources?.(
        target.identity,
        target.runId,
        target.revision,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (sources?.status !== 'current') {
        setContent(t('dailyReport.sourceError'));
        return;
      }
      setContent(conversationDailyReportText(saved));
      setCitations(sources.sources);
    }
    restore().catch(() => {
      if (!controller.signal.aborted) setContent(t('dailyReport.lookupError'));
    });
    return () => controller.abort();
  }, [target, services]);
  if (!content) return null;
  return (
    <ConversationMessage
      message={{
        id: 0,
        role: 'assistant',
        content,
        dailyReport: target,
        citations,
      }}
      onOpenSource={onOpenSource}
      onLinkError={() => setContent(t('dailyReport.sourceError'))}
    />
  );
}
