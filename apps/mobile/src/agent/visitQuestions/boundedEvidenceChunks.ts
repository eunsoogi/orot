import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { VisitQuestionChunkBuilder } from './evidenceRevalidation';
import { LocalEvidenceIdentifiers } from '../../aiFeatures/integration/evidenceIdentifiers';
import type { EvidenceChunk } from '@orot/rag';

/** Model queries select a bounded window; citation checks reread only exact record identities. */
export function createBoundedVisitQuestionChunkBuilder(
  loadData: () => Promise<LocalEvidenceData>,
): VisitQuestionChunkBuilder {
  const identifiers = new LocalEvidenceIdentifiers();
  async function protectContent(
    data: LocalEvidenceData,
    chunks: EvidenceChunk[],
    signal?: AbortSignal,
  ) {
    // Search only the bounded text for stored IDs, including references outside
    // the candidate window. Keep original rows and citation metadata untouched.
    const raw = chunks.map(chunk => chunk.text).join('\n');
    for (const identifier of await data.findIdentifiers(raw, signal))
      identifiers.register(identifier);
    return chunks.map(chunk => ({
      ...chunk,
      text: identifiers.redact(chunk.text),
    }));
  }
  return async (_repository, selection) => {
    if (selection?.signal?.aborted)
      throw new Error('Evidence search was cancelled.');
    if (!selection?.identities && !selection?.query?.trim())
      throw new Error(
        'A model query or selected citation identities are required.',
      );
    const data = await loadData();
    if (selection.identities)
      return protectContent(
        data,
        await data.loadCurrentChunks(selection.identities, selection.signal),
        selection.signal,
      );
    const candidates = await data.readCandidates(
      selection.query!,
      selection.signal,
    );
    if (!candidates.catalog.inventoryComplete)
      throw new Error(
        'The requested evidence search could not be completed safely.',
      );
    const chunks = await data.loadCurrentChunks(
      candidates.candidates.map(({ kind, record }) => ({
        kind,
        id: record.id,
      })),
      selection.signal,
    );
    return protectContent(data, chunks, selection.signal);
  };
}
