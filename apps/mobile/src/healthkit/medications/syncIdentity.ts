/** Prefixes HealthKit identifiers so imported records cannot collide with user-authored IDs. */
export function medicationDefinitionId(conceptIdentifier: string): string {
  return 'healthkit-medication:' + conceptIdentifier;
}

export function doseEventId(sampleIdentifier: string): string {
  return 'healthkit-dose-event:' + sampleIdentifier.toLowerCase();
}

/** Replays of unchanged HealthKit objects preserve their first ingest time. */
export function preserveIngestedAt<T extends { readonly ingestedAt: string }>(
  existing: T | null,
  candidate: T,
): T {
  if (!existing) return candidate;
  const withExistingIngestTime = {
    ...candidate,
    ingestedAt: existing.ingestedAt,
  };
  return JSON.stringify(withExistingIngestTime) === JSON.stringify(existing)
    ? existing
    : candidate;
}

export function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
