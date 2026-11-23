/** Each denied variant still runs through the real Memory Detail reader. */
export const historicalMemoryBoundaryCases = [
  'explicit record tombstone',
  'explicit source tombstone',
  'physical deletion',
  'other namespace',
  'malformed provenance',
  'forged row identity',
  'forged text',
  'mismatched appointment',
  'non-owner review',
  'orphan source identity',
  'replacement missing attestation',
  'replacement different parent revision',
  'locked open',
  'warm connection locked',
  'locked after read',
] as const;
