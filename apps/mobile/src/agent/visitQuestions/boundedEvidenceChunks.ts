import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { VisitQuestionChunkBuilder } from './evidenceRevalidation';

/** Model queries select a bounded window; citation checks reread only exact record identities. */
export function createBoundedVisitQuestionChunkBuilder(
  loadData: () => Promise<LocalEvidenceData>,
): VisitQuestionChunkBuilder {
  return async (_repository, selection) => {
    if (selection?.signal?.aborted)
      throw new Error('Evidence search was cancelled.');
    if (!selection?.identities && !selection?.query?.trim())
      throw new Error(
        'A model query or selected citation identities are required.',
      );
    const data = await loadData();
    if (selection.identities)
      return data.loadCurrentChunks(selection.identities, selection.signal);
    const candidates = await data.readCandidates(
      selection.query!,
      selection.signal,
    );
    if (!candidates.catalog.inventoryComplete)
      throw new Error(
        'The requested evidence search could not be completed safely.',
      );
    return data.loadCurrentChunks(
      candidates.candidates.map(({ kind, record }) => ({
        kind,
        id: record.id,
      })),
      selection.signal,
    );
  };
}
