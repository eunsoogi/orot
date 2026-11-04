import type { EvidenceItem, EvidenceSearchTool } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { jsonByteLength } from './evidenceUtils';
import { parseConversationArtifactInput } from './conversationArtifactInput';
import { readResearchSource } from './researchSourceReader';

/** Search retained public snapshots without treating generated web explanations as source text. */
export function createResearchArtifactTool(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
): EvidenceSearchTool {
  const cursors = new Map<
    string,
    { query: string; scope: string; cursor: string }
  >();
  let sequence = 0;
  return {
    id: 'local-research-artifacts',
    sourceKind: 'generated_artifact',
    execution: 'local_read_only',
    description:
      'Search previously retained public research snapshots. Publication entries contain citation metadata only; web explanations are generated historical text, not original passages or verified clinical facts. Use the continuation token to inspect older results.',
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
        !data.researchArtifactDiscovery
      )
        throw new Error('Research discovery scope is unavailable.');
      const query = parsed.query as string;
      const token = parsed.cursor as string | undefined;
      const continuation = token ? cursors.get(token) : undefined;
      if (
        token &&
        (!continuation ||
          continuation.query !== query ||
          continuation.scope !== request.operationRunId)
      )
        throw new Error('Research cursor is invalid.');
      const discovery = await data.researchArtifactDiscovery();
      const page = await discovery.search({
        query,
        cursor: continuation?.cursor,
        limit: request.resultLimit,
        signal: request.signal,
      });
      const items: EvidenceItem[] = [];
      const parents: { id: string; revision: string }[] = [];
      let omitted = page.unavailableCount;
      let lastEmitted: string | undefined;
      let resumeCursor: string | undefined;
      for (const meta of page.items) {
        const detail = await discovery.read(meta.id, request.signal);
        if (!detail || detail.metadata.revision !== meta.revision) {
          omitted++;
          continue;
        }
        const readSource = (signal: AbortSignal) =>
          readResearchSource(data, registry, meta.id, meta.revision, signal);
        const content = JSON.stringify({
          type: meta.type,
          createdAt: meta.createdAt,
          originFeature: meta.originFeature,
          provider: meta.providerId,
          model: meta.modelId,
          sourceStatus: 'historical_snapshot',
          warning:
            detail.content.source.kind === 'publication'
              ? 'Citation metadata only; publication abstract was not retained.'
              : 'Historical AI-generated public web explanation, not an original passage or independently verified fact.',
          source: detail.content.source,
          generatedText: detail.content.generatedText?.slice(0, 1200) ?? null,
          excerptTruncated: (detail.content.generatedText?.length ?? 0) > 1200,
        });
        for (const id of await data.findIdentifiers(content, request.signal))
          registry.registerSensitiveIdentifier(id);
        const itemInput = {
          reference: {
            sourceKind: 'generated_artifact' as const,
            sourceId: meta.id,
            sourceRevision: meta.revision,
            evidenceId: meta.id,
            evidenceRevision: meta.revision,
            locator: { kind: 'generated_artifact', type: meta.type },
            effectiveTime: meta.eventTime,
            reviewState: 'unknown' as const,
          },
          content,
          readSource,
          validate: async (signal: AbortSignal) =>
            (await readSource(signal)).status === 'available',
        };
        let item = registry.add(itemInput);
        if (jsonByteLength([...items, item]) > request.maxPayloadBytes - 1024) {
          if (lastEmitted) {
            resumeCursor = lastEmitted;
            break;
          }
          item = registry.add({
            ...itemInput,
            content: JSON.stringify({
              type: meta.type,
              createdAt: meta.createdAt,
              sourceStatus: 'historical_snapshot',
              warning:
                'Historical research snapshot; open its citation for the saved source and any generated explanation.',
              excerptTruncated: true,
            }),
          });
          if (jsonByteLength([item]) > request.maxPayloadBytes - 1024)
            throw new Error('Research metadata exceeds the payload limit.');
        }
        items.push(item);
        parents.push({ id: meta.id, revision: meta.revision });
        lastEmitted = meta.id;
      }
      if (
        request.signal.aborted ||
        (items.length &&
          (!(await registry.revalidateEvidence(items, request.signal)) ||
            !(await discovery.revalidatePage(parents, request.signal))))
      )
        throw new Error('A research snapshot changed during search.');
      const nextCursor = resumeCursor ?? page.nextCursor;
      const nextToken = nextCursor ? `research-page-${++sequence}` : undefined;
      if (nextToken && nextCursor) {
        if (cursors.size >= 1024) cursors.delete(cursors.keys().next().value!);
        cursors.set(nextToken, {
          query,
          scope: request.operationRunId,
          cursor: nextCursor,
        });
      }
      return {
        items,
        conflicts: [],
        coverage: [
          {
            sourceKind: 'generated_artifact',
            searchedSourceIds: items.map(item => item.sourceId),
            gaps: omitted ? ['Some research snapshots were unavailable.'] : [],
            truncated: Boolean(omitted || nextToken),
            selectionMethod: 'paged_retrieval',
            ...(nextToken ? { nextCursor: nextToken } : {}),
            resultLimit: request.resultLimit,
            returnedCount: items.length,
          },
        ],
      };
    },
  };
}
