import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import type { ConversationEntryContext } from './conversationIntent';
import { resolveConversationEntryTarget } from './conversationVisitTarget';
import { prepareDailyReportConversationEvidence } from './dailyReportConversationEvidence';
import { conversationHistoryIsCurrent } from './conversationHistorySources';
import type { EvidenceReference } from '@orot/agent-runtime';

/** Resolve explicit targets before provider work so neither can silently fall back. */
export async function resolveConversationTargets(input: {
  context?: ConversationEntryContext;
  loadLocalData: RagConversationServiceDependencies['loadLocalData'];
  resolveDailyReport: RagConversationServiceDependencies['resolveDailyReport'];
  registry: RagConversationServiceDependencies['registry'];
  signal: AbortSignal;
}) {
  const selected = input.context?.dailyReport;
  const report =
    selected && input.resolveDailyReport
      ? await prepareDailyReportConversationEvidence({
          report: selected,
          resolve: input.resolveDailyReport,
          registry: input.registry,
          loadLocalData: input.loadLocalData,
          signal: input.signal,
        })
      : undefined;
  if (selected && !report) return { failure: 'stale_evidence' as const };
  const target = await resolveConversationEntryTarget(input);
  return { ...target, report };
}

/** Both retained conversation and selected report must still be current at dispatch. */
export function conversationInputsAreCurrent(
  registry: RagConversationServiceDependencies['registry'],
  references: readonly EvidenceReference[],
  signal: AbortSignal,
  report?: { isCurrent(): Promise<boolean> } | null,
) {
  return async () =>
    (await conversationHistoryIsCurrent(registry, references, signal)) &&
    (!report || (await report.isCurrent()));
}

/** Local evidence is retrieved through tools and explicitly selected targets. */
export async function emptyConversationSnapshot() {
  return { batch: { items: [], coverage: [], conflicts: [] }, chunks: [] };
}
