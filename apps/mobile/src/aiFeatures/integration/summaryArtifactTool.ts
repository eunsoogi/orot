import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { jsonByteLength } from './evidenceUtils';
import { registerArtifactSource } from './artifactLineage';
import { artifactExcerpt } from './artifactExcerpt';
import { summaryArtifactCoverage } from './summaryArtifactCoverage';

import { artifactCursorState } from './artifactCursorState';

function parseInput(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(key => key !== 'query' && key !== 'cursor') ||
    typeof input.query !== 'string' ||
    !input.query.trim() ||
    input.query.length > 240 ||
    (input.cursor !== undefined &&
      (typeof input.cursor !== 'string' || input.cursor.length > 64))
  )
    return undefined;
  return {
    query: input.query.trim(),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
}

/** Search retained AI text as historical output, never as an independent clinical fact. */
export function createSummaryArtifactTool(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  options: {
    readonly scope?: string;
    readonly onPage?: (
      query: string,
      cursor: string | null,
      items: readonly EvidenceItem[],
    ) => void;
    readonly referenceOnly?: boolean;
  } = {},
): EvidenceSearchTool {
  const state = artifactCursorState(registry, 'summary');
  return {
    id: 'local-generated-artifacts',
    sourceKind: 'generated_artifact',
    execution: 'local_read_only',
    description:
      'Find previously saved AI summaries, daily reports, or disease possibilities. These are historical generated interpretations, not verified medical facts. Use the returned continuation token to inspect older pages.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 240 },
        cursor: { type: 'string', maxLength: 64 },
      },
    },
    parseInput,
    async search(request) {
      const parsed = parseInput(request.input);
      if (
        !parsed ||
        !request.allowedScope.sourceKinds.includes('generated_artifact') ||
        request.allowedScope.sourceIds ||
        request.allowedScope.timeRange ||
        !Number.isSafeInteger(request.resultLimit) ||
        request.resultLimit < 1 ||
        request.resultLimit > 8 ||
        !Number.isSafeInteger(request.maxPayloadBytes) ||
        request.maxPayloadBytes < 2048 ||
        !data.summaryArtifactDiscovery
      )
        throw new Error('The generated artifact search scope is unavailable.');
      const query = parsed.query as string;
      const scope = options.scope ?? request.operationRunId;
      const token = parsed.cursor as string | undefined;
      const continuation = token ? state.tokens.get(token) : undefined;
      if (
        token &&
        (!continuation ||
          continuation.query !== query ||
          continuation.scope !== scope)
      )
        throw new Error('The generated artifact cursor is invalid.');
      const discovery = await data.summaryArtifactDiscovery(registry);
      const page = await discovery.search({
        query,
        limit: request.resultLimit,
        cursor: continuation?.cursor,
        signal: request.signal,
      });
      const items: EvidenceItem[] = [];
      const parents: { id: string; revision: string }[] = [];
      const registrations: Array<() => void> = [];
      let omitted = page.unavailableCount;
      let lastEmittedId: string | undefined;
      let resumeCursor: string | undefined;
      for (const metadata of page.items) {
        const detail = await discovery.read(metadata.id, request.signal);
        if (!detail || detail.metadata.revision !== metadata.revision) {
          omitted += 1;
          continue;
        }
        const sourceStatus = detail.sourceStatus;
        const excerpt = artifactExcerpt(
          metadata,
          detail.content,
          sourceStatus,
          detail.sources,
        );
        let compact = Boolean(options.referenceOnly);
        const body = compact ? excerpt.compact : excerpt.full;
        for (const id of await data.findIdentifiers(body, request.signal))
          registry.registerSensitiveIdentifier(id);
        const readSource = async (signal: AbortSignal) => {
          const current = await discovery.read(metadata.id, signal);
          if (!current) return { status: 'missing' as const };
          if (
            current.metadata.revision !== metadata.revision ||
            current.sourceStatus !== sourceStatus
          )
            return { status: 'changed' as const };
          return {
            status: 'available' as const,
            document: {
              sourceKind: 'generated_artifact' as const,
              metadata: current.metadata,
              analysis: current.content,
              sourceStatus: current.sourceStatus,
            },
          };
        };
        const itemInput = {
          reference: {
            sourceKind: 'generated_artifact' as const,
            sourceId: metadata.id,
            sourceRevision: metadata.revision,
            evidenceId: metadata.id,
            evidenceRevision: metadata.revision,
            locator: { kind: 'generated_artifact', type: metadata.type },
            effectiveTime: null,
            reviewState: 'unreviewed' as const,
          },
          content: body,
          readSource,
          validate: async (signal: AbortSignal) =>
            (await readSource(signal)).status === 'available',
        };
        let item = registry.add(itemInput);
        // Reserve space for coverage and cursor metadata in the provider payload.
        if (jsonByteLength([...items, item]) > request.maxPayloadBytes - 1024) {
          if (lastEmittedId) {
            // Resume after the last emitted result so this matching artifact is not skipped.
            resumeCursor = lastEmittedId;
            break;
          }
          compact = true;
          item = registry.add({ ...itemInput, content: excerpt.compact });
          if (jsonByteLength([item]) > request.maxPayloadBytes - 1024)
            throw new Error('Artifact metadata exceeds the requested size.');
        }
        items.push(item);
        parents.push({ id: metadata.id, revision: metadata.revision });
        lastEmittedId = metadata.id;
        registrations.push(() => {
          for (const section of compact ? [] : detail.content.hypotheses) {
            for (const reference of [
              ...section.supportingEvidence,
              ...section.contraryEvidence,
            ]) {
              if (reference.sourceKind !== 'external_medical')
                registerArtifactSource(
                  registry,
                  request.operationRunId,
                  reference,
                  {
                    id: metadata.id,
                    revision: metadata.revision,
                    sourceStatus,
                  },
                );
            }
          }
        });
      }
      if (
        items.length &&
        !(await registry.revalidateEvidence(items, request.signal))
      )
        throw new Error('A saved summary changed during search.');
      if (
        items.length &&
        !(await discovery.revalidatePage(parents, request.signal))
      )
        throw new Error('A saved summary changed during search.');
      if (request.signal.aborted)
        throw new Error('Artifact search was cancelled.');
      for (const register of registrations) register();
      const nextCursor = resumeCursor ?? page.nextCursor;
      const nextToken = nextCursor ? `page-${++state.sequence}` : undefined;
      if (nextToken && nextCursor) {
        if (state.tokens.size >= 1024)
          state.tokens.delete(state.tokens.keys().next().value!);
        state.tokens.set(nextToken, { scope, query, cursor: nextCursor });
      }
      options.onPage?.(query, nextToken ?? null, items);
      return {
        items,
        conflicts: [],
        coverage: [
          {
            sourceKind: 'generated_artifact',
            searchedSourceIds: items.map(item => item.sourceId),
            gaps: summaryArtifactCoverage(
              omitted,
              page.unknownLineageCount ?? 0,
            ),
            truncated: Boolean(omitted || nextToken),
            selectionMethod: 'paged_retrieval',
            ...(nextToken ? { nextCursor: nextToken } : {}),
            resultLimit: request.resultLimit,
            returnedCount: items.length,
          },
        ],
      } satisfies EvidenceBatch;
    },
  };
}
