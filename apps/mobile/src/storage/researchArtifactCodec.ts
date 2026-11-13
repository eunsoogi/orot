import type { EvidenceReference } from '@orot/agent-runtime';
import { retainedResearchMetadata } from '../aiFeatures/integration/retainedResearchSearch';
import type { ResearchArtifact } from './researchArtifactStorage';
import type { SqlExecutor } from '@orot/storage';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { requireNonPhotoSources } from '../ragConversation/conversationArtifactSources';

export function researchArtifactRowId(id: string): number | null {
  const match = /^research-([1-9]\d*)$/u.exec(id);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) ? value : null;
}

/** The same transaction can validate a parent immediately before saving its descendant. */
export async function readResearchArtifact(
  tx: SqlExecutor,
  id: string,
): Promise<ResearchArtifact | null> {
  const rowId = researchArtifactRowId(id);
  if (rowId === null) return null;
  const result = await tx.execute(
    'SELECT snapshot_json FROM research_artifacts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM research_artifact_invalid invalid WHERE invalid.id = research_artifacts.id)',
    [rowId],
  );
  const item = decodeResearchArtifact(rowId, result.rows[0]?.snapshot_json);
  if (item?.originSession) {
    const session = await tx.execute(
      'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON s.generation = g.generation WHERE g.singleton = 1 AND s.id = ? AND s.hidden = 0',
      [item.originSession],
    );
    if (!session.rows.length) return null;
  }
  return item;
}

/** Revalidate persisted source links and reject unsupported text before exposing a saved snapshot. */
export function decodeResearchArtifact(
  id: unknown,
  serialized: unknown,
): ResearchArtifact | null {
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    typeof serialized !== 'string' ||
    serialized.length > 50000
  )
    return null;
  try {
    const value = JSON.parse(serialized);
    const source = value.source;
    // Older web rows without a complete input inventory cannot be safely exposed after source deletion.
    if (
      source?.kind === 'public_web_search' &&
      (value.inputLineage !== 'complete' || !Array.isArray(value.inputSources))
    )
      return null;
    const inputSources = value.inputSources ?? [];
    const validatedInputs = decodeConversationArtifact(
      JSON.stringify({
        id: 'validation',
        sessionId: 'validation',
        createdAt: '2026-01-01T00:00:00.000Z',
        providerId: 'validation',
        modelId: 'validation',
        status: 'complete',
        question: 'validation',
        answer: 'validation',
        sources: inputSources,
        citations: [],
      }),
    );
    if (
      !source ||
      typeof source !== 'object' ||
      !['publication', 'public_web_search'].includes(source.kind) ||
      source.status !== 'historical_snapshot' ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.originFeature !== 'string' ||
      !value.originFeature ||
      !validatedInputs ||
      (value.originSession !== undefined &&
        value.originSession !== null &&
        (typeof value.originSession !== 'string' || !value.originSession)) ||
      (value.providerId !== null && typeof value.providerId !== 'string') ||
      (value.modelId !== null && typeof value.modelId !== 'string')
    )
      return null;
    if (
      source.kind === 'publication'
        ? value.generatedText !== null
        : typeof value.generatedText !== 'string' || !value.generatedText.trim()
    )
      return null;
    const match =
      source.kind === 'publication' && typeof source.url === 'string'
        ? /^https:\/\/europepmc\.org\/article\/([A-Za-z0-9._-]{1,80})\/([A-Za-z0-9._-]{1,80})$/u.exec(
            source.url,
          )
        : null;
    if (source.kind === 'publication' && !match) return null;
    const reference: EvidenceReference = {
      sourceKind: 'external_medical',
      sourceId: source.kind === 'publication' ? 'europe-pmc' : 'public-web',
      sourceRevision: 'snapshot',
      evidenceId: 'snapshot',
      evidenceRevision: 'snapshot',
      effectiveTime: null,
      reviewState: 'unknown',
      locator:
        source.kind === 'publication'
          ? {
              provider: 'Europe PMC',
              source: match![1],
              recordId: match![2],
              title: source.title,
              originalUrl: source.url,
              publicationDate: source.publicationDate,
              updatedDate: source.updatedDate,
              retrievedAt: source.retrievedAt,
            }
          : {
              kind: 'public_web_search',
              sources: source.sources,
              retrievedAt: source.retrievedAt,
            },
    };
    const validated = retainedResearchMetadata([reference])[0];
    if (
      !validated ||
      JSON.stringify(validated) !== JSON.stringify(source) ||
      !validated.retrievedAt ||
      validated.retrievedAt !== value.createdAt
    )
      return null;
    return {
      id,
      createdAt: value.createdAt,
      originFeature: value.originFeature,
      originSession: value.originSession ?? null,
      providerId: value.providerId,
      modelId: value.modelId,
      source: validated,
      generatedText: value.generatedText,
      inputSources: requireNonPhotoSources(validatedInputs.sources),
    };
  } catch {
    return null;
  }
}
