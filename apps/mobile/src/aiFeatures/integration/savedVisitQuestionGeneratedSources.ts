import type { VisitQuestion } from '@orot/domain';
import type { EvidenceItem } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreConversationParentSource } from './restoreConversationParentSource';
import { restoreConversationSummarySource } from './restoreConversationSummarySource';
import { restoreResearchSource } from './restoreResearchSource';
import { SavedVisitQuestionsReadError } from './savedVisitQuestionCitation';

/** Rebind stored historical AI dependencies through their revision-checked catalogs. */
export async function restoreSavedGeneratedSources(
  sources: NonNullable<VisitQuestion['generatedArtifactSources']>,
  data: AiFeatureLocalData | undefined,
  registry: LocalEvidenceReferenceRegistry,
): Promise<{ items: EvidenceItem[]; unknown: boolean }> {
  const items: EvidenceItem[] = [];
  let unknown = false;
  for (const source of sources) {
    if (!data)
      throw new SavedVisitQuestionsReadError('changed_generated_source');
    const reference = {
      sourceKind: 'generated_artifact' as const,
      sourceId: source.id,
      sourceRevision: source.revision,
      evidenceId: source.id,
      evidenceRevision: source.revision,
      locator: { kind: 'generated_artifact', type: source.type },
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    const signal = new AbortController().signal;
    const restored =
      source.kind === 'generated_research'
        ? await restoreResearchSource(
            {
              kind: source.kind,
              reference,
              id: source.id,
              revision: source.revision,
            },
            registry,
            data,
            signal,
          )
        : source.kind === 'generated_conversation'
          ? await restoreConversationParentSource(
              {
                kind: source.kind,
                reference,
                id: source.id,
                revision: source.revision,
              },
              registry,
              data,
              signal,
            )
          : await restoreConversationSummarySource(
              {
                kind: source.kind,
                reference,
                id: source.id,
                revision: source.revision,
              },
              registry,
              data,
              signal,
            );
    if (!restored)
      throw new SavedVisitQuestionsReadError('changed_generated_source');
    unknown ||= restored.sourceStatus === 'unknown';
    items.push({
      ...restored.reference,
      content: '질문 생성에 사용한 이전 AI 결과',
    });
  }
  return { items, unknown };
}
