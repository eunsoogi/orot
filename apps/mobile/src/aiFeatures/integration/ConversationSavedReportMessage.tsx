import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
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
  const targetKey = JSON.stringify([
    target.identity.key,
    target.runId,
    target.revision,
  ]);
  const [displayKey, setDisplayKey] = useState<string>();
  const [content, setContent] = useState('');
  const [citations, setCitations] = useState<readonly EvidenceReference[]>([]);
  useEffect(() => {
    let controller: AbortController | undefined;
    async function restore(read: AbortController) {
      const saved = await services.dailyReport?.lookup(target.identity);
      if (read.signal.aborted) return;
      if (
        !saved ||
        saved.status !== 'saved' ||
        saved.runId !== target.runId ||
        saved.revision !== target.revision
      ) {
        setDisplayKey(targetKey);
        setContent(t('dailyReport.sourceError'));
        return;
      }
      const sources = await services.dailyReportSources?.(
        target.identity,
        target.runId,
        target.revision,
        read.signal,
      );
      if (read.signal.aborted) return;
      if (sources?.status !== 'current') {
        setDisplayKey(targetKey);
        setContent(t('dailyReport.sourceError'));
        return;
      }
      setDisplayKey(targetKey);
      setContent(conversationDailyReportText(saved));
      setCitations(sources.sources);
    }
    const refresh = () => {
      // Fence the old read before clearing: a late lookup/source result must not resurrect deleted prose.
      controller?.abort();
      setDisplayKey(undefined);
      setContent('');
      setCitations([]);
      const read = new AbortController();
      controller = read;
      restore(read).catch(() => {
        if (!read.signal.aborted) {
          setDisplayKey(targetKey);
          setContent(t('dailyReport.lookupError'));
        }
      });
    };
    const unsubscribeClear = subscribeLocalDataClear(refresh);
    const unsubscribeSource = subscribeLocalSourceDeletion(refresh);
    refresh();
    return () => {
      controller?.abort();
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [target, targetKey, services]);
  if (!content || displayKey !== targetKey) return null;
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
      onLinkError={() => {
        setCitations([]);
        setContent(t('dailyReport.sourceError'));
      }}
    />
  );
}
