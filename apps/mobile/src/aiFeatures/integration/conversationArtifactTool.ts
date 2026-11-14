import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { registerArtifactSource } from './artifactLineage';
import { jsonByteLength } from './evidenceUtils';
import { parseConversationArtifactInput } from './conversationArtifactInput';
import {
  conversationArtifactExcerpt,
  compactConversationArtifactExcerpt,
} from './conversationArtifactExcerpt';

import { artifactCursorState } from './artifactCursorState';

/** Return bounded prior answers as historical AI output, with revalidated parent and source links. */
export function createConversationArtifactTool(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  options: {
    readonly scope?: string;
    readonly referenceOnly?: boolean;
    readonly onPage?: (
      query: string,
      cursor: string | null,
      items: readonly EvidenceItem[],
    ) => void;
  } = {},
): EvidenceSearchTool {
  const cursorState = artifactCursorState(registry, 'conversation');
  return {
    id: 'local-conversation-artifacts',
    sourceKind: 'generated_artifact',
    execution: 'local_read_only',
    description:
      'Search previous saved AI conversations. Their answers are historical generated interpretations, not verified medical facts. Use the continuation token for older results.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 240 },
        cursor: { type: 'string', maxLength: 64 },
      },
    },
    parseInput: parseConversationArtifactInput,
    async search(request) {
      const parsed = parseConversationArtifactInput(request.input);
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
        !data.conversationArtifactDiscovery
      )
        throw new Error(
          'The conversation artifact search scope is unavailable.',
        );
      const query = parsed.query as string;
      const scope = options.scope ?? request.operationRunId;
      const token = parsed.cursor as string | undefined;
      const continuation = token ? cursorState.tokens.get(token) : undefined;
      if (
        token &&
        (!continuation ||
          continuation.scope !== scope ||
          continuation.query !== query)
      )
        throw new Error('The conversation artifact cursor is invalid.');
      const discovery = await data.conversationArtifactDiscovery(registry);
      const page = await discovery.search({
        query,
        cursor: continuation?.cursor,
        limit: request.resultLimit,
        signal: request.signal,
      });
      const items: EvidenceItem[] = [];
      const parents: { id: string; revision: string }[] = [];
      const registrations: Array<() => void> = [];
      let omitted = page.unavailableCount;
      let lastCursor: string | undefined;
      let resumeCursor: string | undefined;
      for (const [index, metadata] of page.items.entries()) {
        const detail = await discovery.read(metadata.id, request.signal);
        if (!detail || detail.metadata.revision !== metadata.revision) {
          omitted++;
          continue;
        }
        const sourceStatus = detail.sourceStatus;
        const body = options.referenceOnly
          ? compactConversationArtifactExcerpt(metadata, sourceStatus)
          : conversationArtifactExcerpt(
              metadata,
              detail.content,
              detail.sources,
              sourceStatus,
            );
        for (const id of await data.findIdentifiers(body, request.signal))
          registry.registerSensitiveIdentifier(id);
        const latest = await discovery.read(metadata.id, request.signal);
        if (
          !latest ||
          latest.metadata.revision !== metadata.revision ||
          latest.sourceStatus !== sourceStatus
        ) {
          omitted++;
          continue;
        }
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
              conversation: current.content,
              sources: current.sources,
              sourceStatus: current.sourceStatus,
            },
          };
        };
        const base = {
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
          readSource,
          validate: async (signal: AbortSignal) =>
            (await readSource(signal)).status === 'available',
        };
        let item = registry.add({ ...base, content: body });
        let full = !options.referenceOnly;
        if (jsonByteLength([...items, item]) > request.maxPayloadBytes - 1024) {
          if (lastCursor) {
            resumeCursor = lastCursor;
            break;
          }
          full = false;
          item = registry.add({
            ...base,
            content: compactConversationArtifactExcerpt(metadata, sourceStatus),
          });
          if (jsonByteLength([item]) > request.maxPayloadBytes - 1024)
            throw new Error('Artifact metadata exceeds the requested size.');
        }
        items.push(item);
        parents.push({ id: metadata.id, revision: metadata.revision });
        lastCursor = page.itemCursors[index];
        if (full)
          registrations.push(() => {
            for (const source of detail.sources)
              if (source.sourceKind !== 'external_medical')
                registerArtifactSource(
                  registry,
                  request.operationRunId,
                  source,
                  {
                    id: metadata.id,
                    revision: metadata.revision,
                    sourceStatus,
                    catalog: 'conversation',
                  },
                );
          });
      }
      if (request.signal.aborted)
        throw new Error('Conversation search was cancelled.');
      if (
        items.length &&
        !(await registry.revalidateEvidence(items, request.signal))
      )
        throw new Error('A saved conversation changed during search.');
      if (
        items.length &&
        !(await discovery.revalidatePage(parents, request.signal))
      )
        throw new Error('A saved conversation changed during search.');
      for (const register of registrations) register();
      const nextCursor = resumeCursor ?? page.nextCursor;
      const nextToken = nextCursor
        ? `conversation-page-${++cursorState.sequence}`
        : undefined;
      if (nextToken && nextCursor) {
        if (cursorState.tokens.size >= 1024)
          cursorState.tokens.delete(cursorState.tokens.keys().next().value!);
        cursorState.tokens.set(nextToken, { scope, query, cursor: nextCursor });
      }
      options.onPage?.(query, nextToken ?? null, items);
      return {
        items,
        conflicts: [],
        coverage: [
          {
            sourceKind: 'generated_artifact',
            searchedSourceIds: items.map(item => item.sourceId),
            gaps: omitted
              ? ['Some saved AI results could not be included.']
              : [],
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
