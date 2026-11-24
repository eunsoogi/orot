import type { EvidenceReference } from '@orot/agent-runtime';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import {
  isPublicWebReference,
  publicWebSources,
} from '../externalMedicalEvidence/publicWebSources';
import type { SavedArchivedCitation } from './savedArchivedCitations';

/** Resolve the exact link only after the protected archive has selected its original reference. */
export function archivedCitationOriginalUrl(
  citation: Pick<SavedArchivedCitation, 'kind' | 'publicOrdinal'>,
  reference: EvidenceReference,
): string | undefined {
  if (reference.sourceKind !== 'external_medical') return undefined;
  if (citation.kind === 'public_web')
    return publicWebSources(reference)?.[citation.publicOrdinal ?? 0]?.url;
  if (citation.kind !== 'external_medical' || isPublicWebReference(reference))
    return undefined;
  const locator = reference.locator;
  const url =
    locator &&
    typeof locator === 'object' &&
    'originalUrl' in locator &&
    typeof locator.originalUrl === 'string'
      ? locator.originalUrl
      : '';
  return isSafeEuropePmcArticleUrl(url) ? url : undefined;
}
