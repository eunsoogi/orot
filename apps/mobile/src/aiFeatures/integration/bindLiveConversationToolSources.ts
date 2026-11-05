import type { ConversationToolEvent } from '@orot/agent-runtime';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreConversationToolTurns } from './restoreConversationToolTurns';

/** Only publish live links after the call and its lineage have been durably saved. */
export async function bindLiveConversationToolSources(
  event: ConversationToolEvent,
  sessionId: string,
  storage: ReturnType<typeof createConversationArtifactStorage>,
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
) {
  const turns = await storage.readToolTurns(sessionId);
  const owner = turns.find(turn =>
    turn.toolEvents.some(
      item =>
        item.operationRunId === event.operationRunId &&
        item.callId === event.callId,
    ),
  );
  if (!owner) return;
  const turn = {
    ...owner,
    toolEvents: owner.toolEvents.filter(
      item =>
        item.operationRunId === event.operationRunId &&
        item.callId === event.callId,
    ),
    lineages: owner.lineages.filter(
      item =>
        item.runId === event.operationRunId && item.callId === event.callId,
    ),
  };
  const [restored] = await restoreConversationToolTurns(
    [turn],
    registry,
    data,
    new AbortController().signal,
    sessionId,
    storage,
  );
  const sources = restored?.toolEvents[0]?.sources ?? [];
  for (const [index, source] of event.sources.entries()) {
    if (source.sourceKind !== 'external_medical') continue;
    const alias =
      sources[index] && registry.toolReferences.findResearch(sources[index]!);
    if (alias) registry.toolReferences.bindResearch(source, alias, event, true);
  }
}
