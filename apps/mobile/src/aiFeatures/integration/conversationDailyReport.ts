import type { DailyReportIdentity } from '@orot/domain';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { createDailyReportFeature } from './dailyReportFeature';
import type { createDailyReportSourceResolver } from './dailyReportSources';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureEvidenceSources } from './captureEvidenceSources';
import { dailyReportConversationFailure } from './dailyReportConversationFailure';
import { conversationDailyReportText } from './conversationDailyReportText';

/** A report is a normal retained conversation turn, not a second screen or a copied task form. */
export function createConversationDailyReport(input: {
  feature: ReturnType<typeof createDailyReportFeature>;
  sources: ReturnType<typeof createDailyReportSourceResolver>;
  registry: LocalEvidenceReferenceRegistry;
}) {
  return async (
    question: string,
    identity: DailyReportIdentity,
    signal: AbortSignal,
    observer?: RagConversationObserver,
  ): Promise<RagConversationOutcome> => {
    if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
    const release = input.feature.retain(identity);
    let cancel = () => {};
    try {
      // A new explicit turn may replace a known stale report, never an unseen concurrent revision.
      const prior = await input.feature.lookup(identity);
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (prior.status === 'error')
        return { status: 'failure', kind: 'retrieval_failed' };
      const mode =
        prior.status === 'stale'
          ? { kind: 'revise' as const, expectedRunId: prior.runId }
          : prior.status === 'deleted'
            ? { kind: 'revise' as const, expectedRunId: null }
            : { kind: 'reuse_or_generate' as const };
      const operation = input.feature.start(identity, mode, observer);
      if (operation.status !== 'started')
        return { status: 'failure', kind: 'unavailable' };
      cancel = () => operation.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      const generated = await operation.result;
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (generated.status === 'failed')
        return dailyReportConversationFailure(generated.code);
      const saved = await input.feature.lookup(identity);
      if (saved.status !== 'saved' || saved.runId !== generated.runId)
        return { status: 'failure', kind: 'stale_evidence' };
      const target = { identity, runId: saved.runId, revision: saved.revision };
      const resolved = await input.sources(
        identity,
        saved.runId,
        saved.revision,
        signal,
      );
      if (resolved.status !== 'current')
        return { status: 'failure', kind: 'stale_evidence' };
      const answer = conversationDailyReportText(saved);
      // Capture cited source identities before retention; the exact report reference additionally
      // guards the full input lineage on restore, including uncited records and calendar changes.
      if (observer?.onRetentionCandidate) {
        try {
          const captured = await captureEvidenceSources(
            resolved.sources,
            input.registry,
            signal,
          );
          await observer.onRetentionCandidate(
            {
              question,
              answer,
              dailyReport: target,
              providerId: saved.context.provider.providerId,
              modelId: saved.context.provider.modelId,
              sources: captured.sources,
              citations: resolved.sources.map(ref =>
                captured.mapping.get(JSON.stringify(ref))!,
              ),
            },
            signal,
          );
        } catch {
          if (!signal.aborted) observer.onRetentionFailure?.();
        }
      }
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      return {
        status: 'answer',
        answer,
        citations: resolved.sources,
        healthSources: true,
        dailyReport: target,
      };
    } catch {
      return {
        status: 'failure',
        kind: signal.aborted ? 'cancelled' : 'unavailable',
      };
    } finally {
      signal.removeEventListener('abort', cancel);
      release();
    }
  };
}
