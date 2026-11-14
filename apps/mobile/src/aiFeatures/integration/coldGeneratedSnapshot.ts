import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  SavedGeneratedResearchSource,
  SavedGeneratedConversationSource,
  SavedSummarySource,
} from '../../diseaseHypotheses/savedSummaries';
import type { AiFeatureLocalData } from './localData';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { fingerprint, stableJson } from './evidenceUtils';

export type ColdLinkedSource =
  SavedGeneratedResearchSource | SavedGeneratedConversationSource;
type Document = Extract<
  EvidenceSourceReadResult,
  { status: 'available' }
>['document'];

/** Read authoritative snapshots without invoking catalog restoration or allocating aliases.
 * Legacy citations, treatment ownership and native photo lineage need their own contracts. */
export async function readColdGeneratedSnapshot(
  source: ColdLinkedSource,
  data: AiFeatureLocalData,
  signal: AbortSignal,
) {
  if (signal.aborted) return null;
  if (source.kind === 'generated_research') {
    const discovery = await data.researchArtifactDiscovery?.();
    const value = await discovery?.read(source.id, signal);
    if (!value || signal.aborted) return null;
    return {
      metadata: value.metadata,
      dependencies: value.content.inputSources,
      signature: stableJson(value),
      document: (aliases: EvidenceReference[]): Document => ({
        sourceKind: 'generated_artifact',
        metadata: value.metadata,
        research: { ...value.content, inputSources: [] },
        sources: [...value.sources, ...aliases],
        sourceStatus: 'unknown',
      }),
    };
  }
  const storage = await data.openConversationArtifactStorage?.();
  const saved = await storage?.read(source.id);
  if (
    !saved ||
    signal.aborted ||
    saved.citations === undefined ||
    saved.treatmentContext ||
    saved.submittedInput?.ocr ||
    saved.sources.some(
      value => 'kind' in value && value.kind === 'conversation_photo',
    )
  )
    return null;
  const dependencies = saved.sources as readonly SavedSummarySource[];
  const keys = new Set(dependencies.map(value => stableJson(value.reference)));
  if (saved.citations.some(value => !keys.has(stableJson(value)))) return null;
  const metadata = {
    type: 'conversation_turn' as const,
    id: saved.id,
    originFeature: 'record_conversation',
    originSession: saved.sessionId,
    createdAt: saved.createdAt,
    eventTime: null,
    revision: fingerprint(saved),
    providerId: saved.providerId,
    modelId: saved.modelId,
    completion: saved.status,
    review: 'unreviewed' as const,
  };
  return {
    metadata,
    dependencies,
    signature: stableJson(saved),
    document: (aliases: EvidenceReference[]): Document => ({
      sourceKind: 'generated_artifact',
      metadata,
      conversation: { question: saved.question, answer: saved.answer },
      sources: aliases,
      // Generated dependencies remain interpretations; restoration never promotes them to facts.
      sourceStatus: 'unknown',
    }),
  };
}
