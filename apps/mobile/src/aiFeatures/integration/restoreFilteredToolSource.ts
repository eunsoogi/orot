import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { FilteredToolPeriod } from '../../storage/conversationToolFilteredPeriod';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';

/** Reopen the data-derived selection while keeping the original input absent. */
export function restoreFilteredToolSource(
  source: FilteredToolPeriod,
  registry: LocalEvidenceReferenceRegistry,
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'readFilteredToolPeriod'
  >,
) {
  const readSource = async (
    signal: AbortSignal,
  ): Promise<EvidenceSourceReadResult> => {
    if (signal.aborted) return { status: 'unavailable' };
    try {
      const current = await storage.readFilteredToolPeriod(source);
      if (signal.aborted) return { status: 'unavailable' };
      return {
        status: 'available',
        document: { sourceKind: 'health_context_period', ...current },
      };
    } catch {
      return { status: 'unavailable' };
    }
  };
  return registry.add({
    reference: source.reference,
    content: '',
    readSource,
    validate: async signal => (await readSource(signal)).status === 'available',
  });
}
