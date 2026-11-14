import type { EvidenceReference } from '@orot/agent-runtime';
import { stableJson } from './evidenceUtils';
import { publicWebSources } from '../../externalMedicalEvidence/publicWebSources';

type Destination = 'europe-pmc' | 'public-web';
/** Only an exact validated protected descriptor may supply this snapshot. It is provenance, not consent. */
export interface ProtectedExternalReferences {
  readonly version: 1;
  readonly destination: Destination;
  readonly sequence: number;
  readonly references: readonly EvidenceReference[];
}

function valid(reference: EvidenceReference, destination: Destination) {
  if (
    !reference ||
    reference.sourceKind !== 'external_medical' ||
    reference.sourceId !== destination ||
    reference.reviewState !== 'unknown' ||
    !['sourceRevision', 'evidenceId', 'evidenceRevision'].every(
      key =>
        typeof reference[key as keyof EvidenceReference] === 'string' &&
        reference[key as keyof EvidenceReference],
    ) ||
    !(
      reference.effectiveTime === null ||
      typeof reference.effectiveTime === 'string'
    )
  )
    return false;
  const value = reference.locator;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const locator = value as Record<string, unknown>;
  if (destination === 'public-web') {
    const sequence = Number(
      /^web-result-([1-9]\d*)$/.exec(reference.evidenceId)?.[1],
    );
    const at = locator.retrievedAt;
    return (
      !!publicWebSources(reference) &&
      Number.isSafeInteger(sequence) &&
      sequence > 0 &&
      typeof at === 'string' &&
      Number.isFinite(Date.parse(at)) &&
      locator.provider === 'ChatGPT web search' &&
      locator.revisionBasis === 'retrieval_snapshot' &&
      reference.sourceRevision === `retrieved:${at}` &&
      reference.evidenceRevision === `snapshot:${at}:${sequence}`
    );
  }
  return (
    locator.provider === 'Europe PMC' &&
    typeof locator.source === 'string' &&
    typeof locator.recordId === 'string' &&
    typeof locator.retrievedAt === 'string' &&
    reference.evidenceId === `${locator.source}:${locator.recordId}` &&
    reference.sourceRevision === `retrieved:${locator.retrievedAt}` &&
    reference.evidenceRevision ===
      (locator.updatedDate
        ? `updated:${locator.updatedDate}`
        : `retrieved:${locator.retrievedAt}`) &&
    locator.originalUrl ===
      `https://europepmc.org/article/${encodeURIComponent(locator.source)}/${encodeURIComponent(locator.recordId)}`
  );
}

/** Restore exact previously admitted references without searching or registering a reusable grant. */
export function protectedExternalReferences(
  destination: Destination,
  saved?: ProtectedExternalReferences,
) {
  const references = new Map<string, EvidenceReference>();
  let sequence = 0;
  const add = (reference: EvidenceReference) => {
    if (!valid(reference, destination))
      throw new Error('Invalid external provenance.');
    const value = JSON.parse(JSON.stringify(reference)) as EvidenceReference;
    references.set(stableJson(value), value);
  };
  if (saved) {
    if (
      saved.version !== 1 ||
      saved.destination !== destination ||
      !Array.isArray(saved.references) ||
      !Number.isSafeInteger(saved.sequence) ||
      saved.sequence < 0 ||
      stableJson(saved).length > 2_000_000
    )
      throw new Error('Invalid protected external snapshot.');
    saved.references.forEach(reference => {
      if (references.has(stableJson(reference)))
        throw new Error('Duplicate external provenance.');
      add(reference);
    });
    sequence = saved.sequence;
    if (
      destination === 'public-web' &&
      saved.references.some(
        reference => Number(reference.evidenceId.slice(11)) > sequence,
      )
    )
      throw new Error('External sequence does not cover its references.');
    if (destination === 'europe-pmc' && sequence !== 0)
      throw new Error('Invalid literature sequence.');
  }
  return {
    add,
    hasSequenceCapacity: () => sequence < Number.MAX_SAFE_INTEGER,
    nextSequence() {
      if (sequence >= Number.MAX_SAFE_INTEGER)
        throw new Error('External sequence exhausted.');
      return ++sequence;
    },
    validates(reference: EvidenceReference) {
      return references.has(stableJson(reference));
    },
    snapshot(): ProtectedExternalReferences {
      return JSON.parse(
        JSON.stringify({
          version: 1,
          destination,
          sequence,
          references: [...references.values()],
        }),
      );
    },
  };
}
