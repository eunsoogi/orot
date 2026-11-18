type Readers = { readSource: unknown; revalidateEvidence: unknown };
let canonical: Readers | undefined;

/** Called synchronously after the registry class definition, before callers can
 * replace its prototype. The first provenance cannot be reissued by a wrapper. */
export function registerEvidenceRegistryReaders(readers: Readers) {
  canonical ??= {
    readSource: readers.readSource,
    revalidateEvidence: readers.revalidateEvidence,
  };
}

/** Cycle-free lookup: neither this module nor its callers initialize the registry. */
export function ownsEvidenceRegistryReaders(readers: Readers) {
  return (
    canonical !== undefined &&
    readers.readSource === canonical.readSource &&
    readers.revalidateEvidence === canonical.revalidateEvidence
  );
}
