import type { EvidenceItem, EvidenceSearchTool } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/service';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { ArtifactContinuation } from '../../ragConversation/artifactContinuation';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createSummaryArtifactTool } from './summaryArtifactTool';
import { createConversationArtifactTool } from './conversationArtifactTool';
import { createArtifactSourceTool } from './artifactSourceTool';
import { createResearchArtifactTool } from './researchArtifactTool';

/** Keep continuation tokens scoped to their originating catalog and conversation. */
export function conversationGeneratedTools(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  observer: RagConversationObserver | undefined,
) {
  const tools: EvidenceSearchTool[] = [];
  const pages = new Map<'summary' | 'conversation', ArtifactContinuation>();
  const citedPages = new Map<string, ArtifactContinuation | null>();
  const onPage =
    (catalog: 'summary' | 'conversation') =>
    (query: string, cursor: string | null, items: readonly EvidenceItem[]) => {
      if (!cursor || !observer?.conversationScope) pages.delete(catalog);
      else
        pages.set(catalog, {
          query,
          cursor,
          ...(catalog === 'conversation' ? { catalog } : {}),
        });
      const page =
        cursor && observer?.conversationScope
          ? {
              query,
              cursor,
              ...(catalog === 'conversation' ? { catalog } : {}),
            }
          : null;
      for (const item of items) citedPages.set(item.evidenceId, page);
    };
  if (data.summaryArtifactDiscovery)
    tools.push(
      createSummaryArtifactTool(data, registry, {
        scope: observer?.conversationScope,
        onPage: onPage('summary'),
      }),
    );
  if (data.conversationArtifactDiscovery)
    tools.push(
      createConversationArtifactTool(data, registry, {
        scope: observer?.conversationScope,
        onPage: onPage('conversation'),
      }),
    );
  if (data.researchArtifactDiscovery)
    tools.push(createResearchArtifactTool(data, registry));
  if (tools.length) {
    tools.push(createArtifactSourceTool('personal_record', data, registry));
    tools.push(createArtifactSourceTool('reviewed_memory', data, registry));
  }
  return {
    tools,
    /** Paging handles are not yet part of the protected cold factory. */
    hasPagingState: () => pages.size > 0 || citedPages.size > 0,
    choose(outcome: RagConversationOutcome): ArtifactContinuation | null {
      if (outcome.status === 'no_evidence' || outcome.status === 'insufficient')
        return pages.get('summary') ?? pages.get('conversation') ?? null;
      if (outcome.status !== 'answer') return null;
      for (const citation of outcome.citations) {
        if (citation.sourceKind !== 'generated_artifact') continue;
        if (!registry.resolve(citation)) continue;
        const candidate = citedPages.get(citation.evidenceId);
        if (candidate) return candidate;
      }
      return null;
    },
  };
}
