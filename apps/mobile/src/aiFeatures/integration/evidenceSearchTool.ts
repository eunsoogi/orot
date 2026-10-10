import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import { localEvidenceKey } from './evidenceSnapshot';
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
} from './evidenceUtils';

const querySchema: JsonObject = {
  type: 'object',
  required: ['query'],
  properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } },
  additionalProperties: false,
};

function queryInput(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.query !== 'string' ||
    record.query.trim().length === 0 ||
    record.query.trim().length > 1000
  ) {
    return undefined;
  }
  return { query: record.query.trim() };
}

function withinRange(
  item: EvidenceItem,
  range: EvidenceSearchRequest['allowedScope']['timeRange'],
): boolean {
  if (!range) return true;
  if (!item.effectiveTime) return false;
  const value = Date.parse(item.effectiveTime);
  const from = Date.parse(range.fromInclusive);
  const to = Date.parse(range.toExclusive);
  return (
    Number.isFinite(value) &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    value >= from &&
    value < to
  );
}

function scopedItems(
  snapshot: LocalEvidenceSnapshot,
  request: EvidenceSearchRequest,
  sourceKind: EvidenceItem['sourceKind'],
): EvidenceItem[] {
  return snapshot.items.filter(
    item =>
      item.sourceKind === sourceKind &&
      (!request.allowedScope.sourceIds ||
        request.allowedScope.sourceIds.includes(item.sourceId)) &&
      withinRange(item, request.allowedScope.timeRange),
  );
}

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
  readonly snapshot: LocalEvidenceSnapshot;
  readonly rag: Pick<LocalE5RagService, 'search'>;
}): EvidenceSearchTool {
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    execution: 'local_read_only',
    description:
      input.sourceKind === 'personal_record'
        ? '로컬 건강 기록, 방문 정보, transcript에서 질문과 관련된 현재 근거를 검색합니다.'
        : '검토된 로컬 기억에서 질문과 관련된 현재 근거를 검색합니다.',
    inputSchema: querySchema,
    parseInput: queryInput,
    async search(request) {
      const parsed = queryInput(request.input);
      if (!parsed) throw new Error('The local evidence query is invalid.');
      const candidates = scopedItems(input.snapshot, request, input.sourceKind);
      const candidateKeys = new Set(candidates.map(localEvidenceKey));
      const chunks = input.snapshot.chunks.filter(chunk =>
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
            resultCoverage(
              input.snapshot,
              request,
              input.sourceKind,
              items,
              false,
            ),
          ],
          conflicts: [],
        } satisfies EvidenceBatch;
      }

      try {
        const hits = await input.rag.search(
          parsed.query as string,
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
        for (const hit of hits.slice(0, request.resultLimit)) {
          const item = byKey.get(localEvidenceKey(hit.chunk.metadata));
          if (!item || seen.has(localEvidenceKey(item))) continue;
          const candidate = [...selected, item];
          const candidateCoverage = resultCoverage(
            input.snapshot,
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
              input.snapshot,
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
              input.snapshot,
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
