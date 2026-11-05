import type { StoredConversationToolTurn } from '../../storage/conversationToolEventStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreRetainedSources } from './restoreRetainedSources';
import { stableJson } from './evidenceUtils';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { bindConversationToolSource } from './bindConversationToolSource';

/** Reissue local aliases after validating each persisted tool source, never exposing durable IDs. */
export async function restoreConversationToolTurns(
  turns: readonly StoredConversationToolTurn[],
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
  signal: AbortSignal,
  sessionId: string,
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'readToolTurns'
  >,
) {
  return Promise.all(
    turns.map(async turn => ({
      ...turn,
      toolEvents: await Promise.all(
        turn.toolEvents.map(async event => {
          const lineage = turn.lineages.find(
            value =>
              value.runId === event.operationRunId &&
              value.callId === event.callId,
          );
          if (!lineage || signal.aborted)
            throw new Error('Tool source is unavailable.');
          const restored = await restoreRetainedSources(
            lineage.sources,
            registry,
            data,
          );
          if (restored.sourceChanged || signal.aborted)
            throw new Error('Tool source changed.');
          let index = 0;
          const sources = event.sources.map(source => {
            if (source.sourceKind === 'external_medical') return source;
            const dependency = lineage.sources[index++];
            const alias =
              dependency &&
              restored.mapping.get(stableJson(dependency.reference));
            if (!alias) throw new Error('Tool source is unavailable.');
            const bound = bindConversationToolSource({
              alias,
              sessionId,
              runId: event.operationRunId,
              callId: event.callId,
              snapshot: { event, lineage },
              storage,
              registry,
            });
            return {
              sourceKind: bound.sourceKind,
              sourceId: bound.sourceId,
              sourceRevision: bound.sourceRevision,
              evidenceId: bound.evidenceId,
              evidenceRevision: bound.evidenceRevision,
            };
          });
          return { ...event, sources };
        }),
      ),
    })),
  );
}
