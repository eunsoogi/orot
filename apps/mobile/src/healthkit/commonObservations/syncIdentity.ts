/** Keeps a source replay from changing a record whose stored evidence is unchanged. */
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
