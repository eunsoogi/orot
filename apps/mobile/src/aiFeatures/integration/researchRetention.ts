import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';
import { retainedResearchMetadata } from './retainedResearchSearch';
import type { ResearchSessionLease } from '../../storage/researchArtifactStorage';
import type { ResearchArtifactInput } from '../../storage/researchArtifactStorage';
import {
  isControlledPublicWebQuery,
  parsePublicWebQuery,
} from '../../agent/execution/publicWebQuery';
import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { stableJson } from './evidenceUtils';
import { RetainedSourceInvalidError } from './retainedSourceError';

type LoadData = () => Promise<AiFeatureLocalData>;

export { retainLiteratureResults } from './researchLiteratureRetention';

/** A web result is generated prose with cited public links, not an original source passage. */
export function retainPublicWebResults(
  tool: EvidenceSearchTool,
  loadData: LoadData,
  providerId: string,
  modelId: string,
  originFeature: string,
  session?: ResearchSessionLease,
  captureInputs?: (
    signal: AbortSignal,
  ) => Promise<readonly SavedSummarySource[]>,
  onRetained?: (
    ids: readonly number[],
    signal: AbortSignal,
    references?: readonly import('@orot/agent-runtime').ToolSourceReference[],
    scope?: import('./toolReferenceIndex').RunCallIdentity,
  ) => Promise<void>,
): EvidenceSearchTool {
  const pending = new Map<
    string,
    {
      signature: string;
      result: EvidenceBatch;
      snapshots: ResearchArtifactInput[];
      lease: number;
    }
  >();
  return {
    ...tool,
    async search(request) {
      const storage = await (await loadData()).openResearchArtifactStorage?.();
      const lease = await storage?.currentGeneration();
      const key = stableJson([request.operationRunId, request.operationKey]);
      const signature = stableJson({
        input: request.input,
        scope: request.allowedScope,
        resultLimit: request.resultLimit,
        maxPayloadBytes: request.maxPayloadBytes,
      });
      const prior = pending.get(key);
      if (prior) {
        if (
          request.signal.aborted ||
          prior.signature !== signature ||
          !storage
        ) {
          pending.delete(key);
          throw new Error('The pending research request is unavailable.');
        }
        try {
          const ids = await storage.append(
            prior.snapshots,
            prior.lease,
            request.signal,
            session,
          );
          await onRetained?.(ids, request.signal, prior.result.items, {
            operationRunId: request.operationRunId,
            callId: request.operationKey,
          });
        } catch (error) {
          if (
            request.signal.aborted ||
            error instanceof RetainedSourceInvalidError
          )
            pending.delete(key);
          throw error;
        }
        pending.delete(key);
        return prior.result;
      }
      // The public tool accepts topic labels and constructs the outbound query itself.
      const query =
        parsePublicWebQuery(request.input)?.query ?? request.input.query;
      const controlled =
        typeof query === 'string' && isControlledPublicWebQuery(query);
      let inputSources: readonly SavedSummarySource[] | null =
        controlled && !captureInputs ? [] : null;
      if (captureInputs) {
        // A query influenced by a removed local source must not be dispatched or retained.
        const captured = await captureInputs(request.signal);
        if (originFeature !== 'record_conversation' || session)
          inputSources = captured;
      }
      const result = await tool.search(request);
      if (storage && lease !== undefined && !('status' in result)) {
        if (!inputSources) {
          // Free-form queries can contain personal record text; no input lineage is available here yet.
          return {
            ...result,
            coverage: result.coverage.map(entry => ({
              ...entry,
              gaps: [
                ...entry.gaps,
                'This free-form research result could not be retained without input lineage.',
              ],
            })),
          };
        }
        const snapshots = result.items.flatMap((item, index) => {
          const source = retainedResearchMetadata([item])[0];
          if (
            !source ||
            source.kind !== 'public_web_search' ||
            !source.retrievedAt
          )
            return [];
          return [
            {
              createdAt: source.retrievedAt,
              originFeature,
              originSession: session?.id ?? null,
              providerId,
              modelId,
              source,
              generatedText: item.content,
              inputSources,
              requestKey: stableJson([
                ...(session ? [session.id] : []),
                request.operationRunId,
                request.operationKey,
                index,
              ]),
            },
          ];
        });
        if (snapshots.length !== result.items.length)
          throw new Error('A web result lacks valid retained source metadata.');
        try {
          const ids = await storage.append(
            snapshots,
            lease,
            request.signal,
            session,
          );
          await onRetained?.(ids, request.signal, result.items, {
            operationRunId: request.operationRunId,
            callId: request.operationKey,
          });
        } catch (error) {
          if (
            !request.signal.aborted &&
            !(error instanceof RetainedSourceInvalidError)
          )
            pending.set(key, { signature, result, snapshots, lease });
          throw error;
        }
      }
      return result;
    },
  };
}
