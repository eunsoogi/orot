import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import {
  querySchema,
  plainQuerySchema,
  queryInput,
} from './evidenceSearchQuery';
import { evidenceRagSearchQuery } from '../../healthEvidence/evidenceCandidateScope';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { healthOverviewEvidence } from './healthOverviewEvidence';
import { scopedEvidenceItems } from './evidenceItemScope';
import { localEvidenceKey } from './evidenceSnapshot';
import { manualHistoryEffectiveDate } from './manualHistoryEvidence';
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
} from './evidenceUtils';

function resultCoverage(
  snapshot: LocalEvidenceSnapshot,
  request: EvidenceSearchRequest,
  sourceKind: EvidenceItem['sourceKind'],
  items: readonly EvidenceItem[],
  truncated: boolean,
  failure?: string,
) {
  const base = snapshot.coverage.find(value => value.sourceKind === sourceKind);
  return {
    sourceKind,
    // Only the application snapshot can attest that ranked selection covered a complete local inventory.
    ...(base?.selectionMethod ? { selectionMethod: base.selectionMethod } : {}),
    searchedSourceIds: [...new Set(items.map(item => item.sourceId))],
    ...(request.allowedScope.timeRange
      ? { requestedTimeRange: request.allowedScope.timeRange }
      : {}),
    gaps: [...(base?.gaps ?? []), ...(failure ? [failure] : [])],
    truncated: Boolean(base?.truncated || truncated),
    resultLimit: request.resultLimit,
    returnedCount: items.length,
  };
}

/** Creates one local-only search surface per evidence kind and never returns an out-of-scope item. */
export function createLocalEvidenceSearchTool(input: {
  readonly id: string;
  readonly sourceKind: EvidenceItem['sourceKind'];
  readonly maxResults?: number;
  readonly snapshot?: LocalEvidenceSnapshot;
  readonly registry?: LocalEvidenceReferenceRegistry;
  readonly allowHealthOverview?: boolean;
  readonly rag: Pick<LocalE5RagService, 'search'>;
  readonly loadSnapshot?: (
    query: string,
    request: EvidenceSearchRequest,
  ) => Promise<LocalEvidenceSnapshot>;
}): EvidenceSearchTool {
  const allowOverview = Boolean(
    input.allowHealthOverview && input.sourceKind === 'personal_record',
  );
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    execution: 'local_read_only',
    description:
      input.sourceKind === 'personal_record'
        ? 'Search local medication registrations and doses, health measurements, activity, sleep, symptoms, visits, transcripts and user-entered historical health notes. Transcripts or photos are not prerequisites. ' +
          (allowOverview
            ? 'For a general health summary choose view=health_overview to retrieve bounded recent facts across health topics in one read. '
            : '') +
          'Otherwise specify the desired record types in query for relevance ranking. A partial result never establishes that omitted records do not exist.'
        : 'Search current, reviewed local memory relevant to the question.',
    inputSchema: allowOverview ? querySchema : plainQuerySchema,
    parseInput: value => queryInput(value, allowOverview),
    async search(request) {
      const parsed = queryInput(request.input, allowOverview);
      if (!parsed) throw new Error('The local evidence query is invalid.');
      let snapshot = input.snapshot ?? unsearchedSnapshot;
      try {
        if (input.loadSnapshot)
          snapshot = await input.loadSnapshot(parsed.query as string, request);
        if (
          parsed.view === 'health_overview' &&
          input.sourceKind === 'personal_record' &&
          !request.allowedScope.sourceIds
        ) {
          if (!input.registry)
            throw new Error('Overview source validation is unavailable.');
          return healthOverviewEvidence(
            snapshot,
            input.registry,
            request,
            input.maxResults ?? request.resultLimit,
          );
        }
        const candidates = scopedEvidenceItems(
          snapshot.items,
          request,
          input.sourceKind,
          item => manualHistoryEffectiveDate(item, input.registry),
        );
        const candidateKeys = new Set(candidates.map(localEvidenceKey));
        const chunks = snapshot.chunks.filter(chunk =>
          candidateKeys.has(
            localEvidenceKey({
              sourceId: chunk.metadata.sourceId,
              evidenceId: chunk.metadata.evidenceId,
            }),
          ),
        );
        if (candidates.length === 0 || chunks.length === 0) {
          const items: EvidenceItem[] = [];
          return {
            items,
            coverage: [
              resultCoverage(snapshot, request, input.sourceKind, items, false),
            ],
            conflicts: [],
          } satisfies EvidenceBatch;
        }

        // Candidate loading keeps the original query. Mixed ranking adds concept keys
        // beside it; measurement-only ranking can use those keys alone.
        const hits = await input.rag.search(
          evidenceRagSearchQuery(parsed.query as string),
          chunks,
          request.resultLimit,
          { signal: request.signal },
        );
        const byKey = new Map(
          candidates.map(item => [localEvidenceKey(item), item]),
        );
        const selected: EvidenceItem[] = [];
        const seen = new Set<string>();
        let omittedForPayload = false;
        const maxPayloadBytes = Math.min(
          request.maxPayloadBytes,
          MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
        );
        // Keep bounded room for a later model-selected literature search or refinement.
        for (const hit of hits.slice(
          0,
          Math.min(
            request.resultLimit,
            input.maxResults ?? request.resultLimit,
          ),
        )) {
          const item = byKey.get(localEvidenceKey(hit.chunk.metadata));
          if (!item || seen.has(localEvidenceKey(item))) continue;
          const candidate = [...selected, item];
          const candidateCoverage = resultCoverage(
            snapshot,
            request,
            input.sourceKind,
            candidate,
            hits.length >= request.resultLimit || omittedForPayload,
            omittedForPayload
              ? '일부 근거가 요청 크기 제한으로 제외되었어요.'
              : undefined,
          );
          if (
            jsonByteLength({
              items: candidate,
              coverage: [candidateCoverage],
              conflicts: [],
            }) > maxPayloadBytes
          ) {
            omittedForPayload = true;
            continue;
          }
          selected.push(item);
          seen.add(localEvidenceKey(item));
        }
        return {
          items: selected,
          coverage: [
            resultCoverage(
              snapshot,
              request,
              input.sourceKind,
              selected,
              hits.length >= request.resultLimit ||
                omittedForPayload ||
                selected.length < hits.length,
              omittedForPayload
                ? '일부 근거가 요청 크기 제한으로 제외되었어요.'
                : undefined,
            ),
          ],
          conflicts: [],
        } satisfies EvidenceBatch;
      } catch {
        const items: EvidenceItem[] = [];
        return {
          items,
          coverage: [
            resultCoverage(
              snapshot,
              request,
              input.sourceKind,
              items,
              true,
              '로컬 검색을 사용할 수 없어 근거를 찾지 못했어요.',
            ),
          ],
          conflicts: [],
        } satisfies EvidenceBatch;
      }
    },
  };
}

// An unexecuted tool has no evidence or coverage claim. This fallback is used only
// to describe a failed first read, never as an invented complete inventory.
const unsearchedSnapshot: LocalEvidenceSnapshot = {
  inventory: {
    inventoryComplete: false,
    availableKinds: [],
    queriedKinds: [],
    unsupportedKinds: [],
    truncatedKinds: [],
  },
  items: [],
  chunks: [],
  coverage: [],
  gaps: [],
  batchFor: () => ({ items: [], coverage: [], conflicts: [] }),
};
