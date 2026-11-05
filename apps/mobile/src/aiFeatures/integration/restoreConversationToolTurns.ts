import type { StoredConversationToolTurn } from '../../storage/conversationToolEventStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreRetainedSources } from './restoreRetainedSources';
import { stableJson } from './evidenceUtils';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { bindConversationToolSource } from './bindConversationToolSource';
import { restoreFilteredToolSource } from './restoreFilteredToolSource';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import {
  isExternalToolResearch,
  sameToolSource,
} from '../../storage/conversationToolExternalSource';
import { restoreResearchSource } from './restoreResearchSource';

/** Reissue local aliases after validating each persisted tool source, never exposing durable IDs. */
export async function restoreConversationToolTurns(
  turns: readonly StoredConversationToolTurn[],
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
  signal: AbortSignal,
  sessionId: string,
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'readToolTurns' | 'readFilteredToolPeriod'
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
            lineage.sources.filter(
              (source): source is ConversationArtifactSource =>
                !(
                  'kind' in source &&
                  source.kind === 'filtered_medication_period'
                ) && !isExternalToolResearch(source),
            ),
            registry,
            data,
          );
          if (restored.sourceChanged || signal.aborted)
            throw new Error('Tool source changed.');
          let index = 0;
          const sources = await Promise.all(
            event.sources.map(async source => {
              if (source.sourceKind === 'external_medical') {
                const dependency = lineage.sources[index];
                if (
                  !isExternalToolResearch(dependency) ||
                  !sameToolSource(source, dependency.reference)
                )
                  return source;
                index += 1;
                const restoredResearch = await restoreResearchSource(
                  dependency.research,
                  registry,
                  data,
                  signal,
                );
                if (!restoredResearch)
                  throw new Error('Tool research source is unavailable.');
                const bound = bindConversationToolSource({
                  alias: restoredResearch.reference,
                  sessionId,
                  runId: event.operationRunId,
                  callId: event.callId,
                  snapshot: { event, lineage },
                  storage,
                  registry,
                });
                const projected = {
                  sourceKind: 'external_medical' as const,
                  sourceId: bound.sourceId,
                  sourceRevision: bound.sourceRevision,
                  evidenceId: bound.evidenceId,
                  evidenceRevision: bound.evidenceRevision,
                };
                registry.toolReferences.bindResearch(projected, bound);
                return projected;
              }
              const dependency = lineage.sources[index++];
              const alias =
                dependency &&
                'kind' in dependency &&
                dependency.kind === 'filtered_medication_period'
                  ? restoreFilteredToolSource(dependency, registry, storage)
                  : dependency &&
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
            }),
          );
          return { ...event, sources };
        }),
      ),
    })),
  );
}
