import type { EvidenceReference } from '@orot/agent-runtime';
import { PUBLIC_WEB_SOURCE_ID, publicWebSources } from '../publicWebSources';
import { publisherAttribution, publisherSeeds } from './medlinePlusSeeds';

export const curatedPublisherProvider = 'Orot publisher index';
export function isCuratedPublisherReference(reference: EvidenceReference) {
  const locator = reference.locator as Record<string, unknown> | null;
  return (
    reference.sourceId === PUBLIC_WEB_SOURCE_ID &&
    locator?.provider === curatedPublisherProvider
  );
}

export const curatedReferenceSequence = (evidenceId: string) =>
  Number(/^publisher-web-result-([1-9]\d*)$/.exec(evidenceId)?.[1]);

export function validCuratedPublisherReference(reference: EvidenceReference) {
  const sources = publicWebSources(reference);
  const locator = reference.locator as Record<string, unknown> | null;
  const at = locator?.retrievedAt;
  const covered = locator?.coveredPages;
  const sequence = curatedReferenceSequence(reference.evidenceId);
  return (
    isCuratedPublisherReference(reference) &&
    !!sources &&
    typeof covered === 'number' &&
    Number.isSafeInteger(covered) &&
    covered >= sources.length &&
    covered <= publisherSeeds.length &&
    locator?.catalogPages === publisherSeeds.length &&
    sources.every(source =>
      publisherSeeds.some(seed => seed.url === source.url),
    ) &&
    Number.isSafeInteger(sequence) &&
    typeof at === 'string' &&
    Number.isFinite(Date.parse(at)) &&
    locator?.attribution === publisherAttribution &&
    locator.revisionBasis === 'publisher_snapshot' &&
    reference.sourceRevision === `retrieved:${at}` &&
    reference.evidenceRevision === `snapshot:${at}:${sequence}`
  );
}
