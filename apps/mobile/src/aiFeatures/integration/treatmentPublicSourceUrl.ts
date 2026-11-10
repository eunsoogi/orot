import type { EvidenceReference } from '@orot/agent-runtime';
import { hypertensionEducationPublication } from '../../treatmentContext/hypertensionEducation';
import { isSafeEuropePmcArticleUrl } from './articleLinks';
import { retainedResearchMetadata } from './retainedResearchSearch';

/** A treatment citation opens only its own reviewed URL or canonical publication locator. */
export function treatmentPublicSourceUrl(reference: EvidenceReference) {
  const reviewed = hypertensionEducationPublication(reference)?.originalUrl;
  if (reviewed) return reviewed;
  const [retained] = retainedResearchMetadata([reference]);
  if (
    retained?.kind === 'publication' &&
    isSafeEuropePmcArticleUrl(retained.url)
  )
    return retained.url;
  // A web result containing multiple links is not one original publication.
  if (retained?.kind === 'public_web_search' && retained.sources.length === 1)
    return retained.sources[0]?.url;

  // Older Europe PMC references retain the canonical URL without article metadata.
  const locator = reference.locator as Record<string, unknown> | null;
  const url = locator?.originalUrl;
  if (
    reference.sourceKind === 'external_medical' &&
    reference.sourceId === 'europe-pmc' &&
    locator?.provider === undefined &&
    locator?.source === undefined &&
    locator?.recordId === undefined &&
    typeof url === 'string' &&
    isSafeEuropePmcArticleUrl(url) &&
    new URL(url).href === url
  )
    return url;
  return undefined;
}
