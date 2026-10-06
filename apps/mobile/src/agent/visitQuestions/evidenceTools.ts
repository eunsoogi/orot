import type {
  EvidenceBatch,
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import {
  visitQuestionEvidenceIdentityKey,
  type VisitQuestionEvidenceAliases,
} from './evidenceAliases';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type { VisitQuestionSearchSource } from './evidenceSearch';

const QUERY_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 2, maxLength: 240 },
  },
};

function parseQuery(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const query = typeof record.query === 'string' ? record.query.trim() : '';
  if (
    Object.keys(record).length !== 1 ||
    Object.keys(record)[0] !== 'query' ||
    query.length < 2 ||
    query.length > 240
  ) {
    return undefined;
  }
  return { query };
}

function searchInput(
  request: EvidenceSearchRequest,
  maxEvidenceItems: number,
): { readonly query: string; readonly limit: number } {
  const parsed = parseQuery(request.input);
  const query = parsed?.query;
  if (typeof query !== 'string')
    throw new Error('The visit-question search query was invalid.');
  if (
    request.allowedScope.sourceIds !== undefined ||
    request.allowedScope.timeRange !== undefined
  ) {
    throw new Error('The visit-question search scope is unsupported.');
  }
  const limit = request.resultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxEvidenceItems) {
    throw new Error('The visit-question search limit was invalid.');
  }
  return { query, limit };
}

function toolId(sourceKind: VisitQuestionSearchSource): string {
  return sourceKind === 'personal_record'
    ? 'visit-question-personal-record-search'
    : 'visit-question-reviewed-memory-search';
}

/** Keeps role-selected research on the local, source-kind allowlist and shared evidence budget. */
export function createVisitQuestionEvidenceSearchTools(input: {
  readonly aliases: VisitQuestionEvidenceAliases;
  readonly searchEvidence: (
    query: string,
    maxEvidenceItems: number,
    sourceKind: VisitQuestionSearchSource,
    signal: AbortSignal,
  ) => Promise<VisitQuestionEvidenceCollection>;
  readonly initialEvidenceCount: number;
  readonly maxEvidenceItems: number;
}): readonly EvidenceSearchTool[] {
  const knownReferences = new Set(
    input.aliases.batch.items.map(visitQuestionEvidenceIdentityKey),
  );
  const search = (
    sourceKind: VisitQuestionSearchSource,
  ): EvidenceSearchTool => ({
    id: toolId(sourceKind),
    sourceKind,
    execution: 'local_read_only',
    description:
      sourceKind === 'personal_record'
        ? 'Search current local health records and transcript evidence for a short query. Return only source-linked evidence from the allowed local records.'
        : 'Search current user-reviewed Rememori memories for a short query. Return only source-linked reviewed memory.',
    inputSchema: QUERY_SCHEMA,
    parseInput: parseQuery,
    async search(request) {
      if (!request.allowedScope.sourceKinds.includes(sourceKind)) {
        throw new Error(
          'The requested local source kind is outside this workflow.',
        );
      }
      const { query, limit } = searchInput(request, input.maxEvidenceItems);
      const remaining = input.maxEvidenceItems - input.initialEvidenceCount;
      const maxEvidenceItems = Math.min(limit, remaining);
      if (maxEvidenceItems < 3) {
        throw new Error(
          'The visit-question workflow has no reserved research budget.',
        );
      }
      if (request.signal.aborted)
        throw new Error('The visit-question evidence search was cancelled.');

      const searched = await input.searchEvidence(
        query,
        maxEvidenceItems,
        sourceKind,
        request.signal,
      );
      if (request.signal.aborted)
        throw new Error('The visit-question evidence search was cancelled.');

      const aliased = input.aliases.aliasBatch(searched.batch);
      const items = aliased.items.filter(item => {
        const key = visitQuestionEvidenceIdentityKey(item);
        if (knownReferences.has(key)) return false;
        knownReferences.add(key);
        return true;
      });
      const batch: EvidenceBatch = {
        items,
        coverage: aliased.coverage.map(coverage => ({
          ...coverage,
          returnedCount: items.filter(
            item => item.sourceKind === coverage.sourceKind,
          ).length,
        })),
        conflicts: aliased.conflicts,
      };
      return batch;
    },
  });

  return [search('personal_record'), search('reviewed_memory')];
}
