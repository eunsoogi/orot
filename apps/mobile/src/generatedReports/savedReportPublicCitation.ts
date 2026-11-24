import type { EvidenceReference } from '@orot/agent-runtime';
import { retainedResearchMetadata } from '../aiFeatures/integration/retainedResearchSearch';
import { archivedCitationOriginalUrl } from '../ragConversation/archivedCitationOriginalUrl';
import type { SavedArchivedCitation } from '../ragConversation/savedArchivedCitations';

/** Require a stored, unambiguous original. Never guess an old link or article ID. */
export function savedReportPublicCitationUrl(
  citation: Pick<SavedArchivedCitation, 'kind' | 'publicOrdinal'>,
  reference: EvidenceReference,
) {
  if (citation.kind === 'public_web') {
    const ordinal = citation.publicOrdinal;
    return typeof ordinal === 'number' &&
      Number.isSafeInteger(ordinal) &&
      ordinal >= 0
      ? archivedCitationOriginalUrl(citation, reference)
      : undefined;
  }
  if (
    citation.kind !== 'external_medical' ||
    reference.sourceId !== 'europe-pmc'
  )
    return undefined;
  const [snapshot] = retainedResearchMetadata([reference]);
  if (snapshot?.kind !== 'publication') return undefined;
  const [, , , , source, recordId] = snapshot.url.split('/');
  if (reference.evidenceId !== `${source}:${recordId}`) return undefined;
  return archivedCitationOriginalUrl(citation, reference);
}
