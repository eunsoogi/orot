import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { artifactSource } from './artifactLineage';
import { presentEvidenceSource } from './evidenceSourcePresentation';
import { jsonByteLength } from './evidenceUtils';

function parseInput(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    typeof input.evidenceId !== 'string' ||
    !/^e\d{1,12}$/u.test(input.evidenceId)
  )
    return undefined;
  return { evidenceId: input.evidenceId };
}

/** Follow only a source disclosed by a previously retrieved artifact, with its current revision. */
export function createArtifactSourceTool(
  kind: 'personal_record' | 'reviewed_memory',
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
): EvidenceSearchTool {
  return {
    id:
      kind === 'personal_record'
        ? 'artifact-personal-source'
        : 'artifact-reviewed-memory-source',
    sourceKind: kind,
    execution: 'local_read_only',
    description:
      'Follow a source evidenceId disclosed by a saved AI result. The original source is revalidated before it is returned.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['evidenceId'],
      properties: { evidenceId: { type: 'string', pattern: '^e[0-9]{1,12}$' } },
    },
    parseInput,
    async search(request) {
      const parsed = parseInput(request.input);
      if (
        !parsed ||
        !request.allowedScope.sourceKinds.includes(kind) ||
        request.allowedScope.sourceIds ||
        request.allowedScope.timeRange ||
        !Number.isSafeInteger(request.resultLimit) ||
        request.resultLimit < 1 ||
        request.resultLimit > 8 ||
        !Number.isSafeInteger(request.maxPayloadBytes) ||
        request.maxPayloadBytes < 1024
      )
        throw new Error('Artifact source scope is unavailable.');
      const lineage = artifactSource(
        registry,
        request.operationRunId,
        parsed.evidenceId as string,
      );
      if (
        !lineage ||
        lineage.reference.sourceKind !== kind ||
        !data.summaryArtifactDiscovery
      )
        throw new Error('Artifact source is unavailable.');
      const reference = lineage.reference;
      const original = registry.resolve(reference);
      if (!original) throw new Error('Artifact source is unavailable.');
      const discovery = await data.summaryArtifactDiscovery(registry);
      const readSource = async (signal: AbortSignal) => {
        const parent = await discovery.read(lineage.parentId, signal);
        if (!parent) return { status: 'missing' as const };
        if (
          parent.metadata.revision !== lineage.parentRevision ||
          parent.sourceStatus !== lineage.sourceStatus
        )
          return { status: 'changed' as const };
        const source = await registry.readSource(reference, signal);
        const latest = await discovery.read(lineage.parentId, signal);
        if (!latest) return { status: 'missing' as const };
        if (
          latest.metadata.revision !== lineage.parentRevision ||
          latest.sourceStatus !== lineage.sourceStatus
        )
          return { status: 'changed' as const };
        return source;
      };
      const result = await readSource(request.signal);
      if (
        result.status !== 'available' ||
        result.document.sourceKind === 'generated_artifact' ||
        (kind === 'reviewed_memory') !==
          (result.document.sourceKind === 'reviewed_memory')
      )
        throw new Error('Artifact source changed or is unavailable.');
      const raw = JSON.stringify(presentEvidenceSource(result.document));
      for (const id of await data.findIdentifiers(raw, request.signal))
        registry.registerSensitiveIdentifier(id);
      const content = registry.redactText(raw);
      if (jsonByteLength(content) > request.maxPayloadBytes - 1024)
        throw new Error('Artifact source exceeds the requested size.');
      const item = registry.add({
        reference: original,
        content,
        readSource,
        validate: async signal =>
          (await readSource(signal)).status === 'available',
      });
      return {
        items: [item],
        conflicts: [],
        coverage: [
          {
            sourceKind: kind,
            searchedSourceIds: [item.sourceId],
            gaps: [],
            truncated: false,
            resultLimit: request.resultLimit,
            returnedCount: 1,
          },
        ],
      } satisfies EvidenceBatch;
    },
  };
}
