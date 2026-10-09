import type { EvidenceReference } from '@orot/agent-runtime';
import { withLocalDeletionAwareRevalidation } from '../../memory/deletionAwareEvidenceRevalidation';

type EvidenceRevalidator = (
  references: readonly EvidenceReference[],
  signal: AbortSignal,
) => Promise<boolean>;

export type LocalEvidenceIdentityResolver = (
  reference: EvidenceReference,
) => EvidenceReference | undefined;

/** Checks tombstones by local identity while keeping opaque aliases in citations and registry validation. */
export function revalidateWithLocalDeletionGuard(
  references: readonly EvidenceReference[],
  signal: AbortSignal,
  revalidate: EvidenceRevalidator,
  resolveIdentity?: LocalEvidenceIdentityResolver,
): Promise<boolean> {
  const identities = references.map(reference =>
    resolveIdentity ? resolveIdentity(reference) : reference,
  );
  if (identities.some(reference => !reference)) return Promise.resolve(false);

  // SQLCipher uses the original IDs for deletion checks; the registry still validates the aliases.
  return withLocalDeletionAwareRevalidation((_identities, currentSignal) =>
    revalidate(references, currentSignal),
  )(identities as EvidenceReference[], signal);
}
