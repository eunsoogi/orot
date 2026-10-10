import type { EvidenceReference } from '@orot/agent-runtime';
import { withLocalDeletionAwareRevalidation } from '../../memory/deletionAwareEvidenceRevalidation';

type EvidenceRevalidator = (
  references: readonly EvidenceReference[],
  signal: AbortSignal,
) => Promise<boolean>;

export type LocalEvidenceIdentityResolver = (
  reference: EvidenceReference,
) => EvidenceReference | undefined;

function deletionGuardIdentity(
  reference: EvidenceReference,
): EvidenceReference | undefined {
  const locator = reference.locator;
  if (
    reference.sourceKind !== 'personal_record' ||
    !locator ||
    typeof locator !== 'object' ||
    Array.isArray(locator)
  )
    return reference;
  const fields = locator as Record<string, unknown>;
  if (fields.kind !== 'local_record') return reference;
  if (
    typeof fields.recordId !== 'string' ||
    fields.recordId !== reference.evidenceId
  )
    return undefined;

  // The shared deletion guard accepts stored row IDs through its structured-record fallback.
  return { ...reference, locator: { ...fields, kind: 'structured_record' } };
}

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
  const guardIdentities = (identities as EvidenceReference[]).map(
    deletionGuardIdentity,
  );
  if (guardIdentities.some(reference => !reference))
    return Promise.resolve(false);

  // Keep model-facing aliases unchanged for the registry's revision validation.
  return withLocalDeletionAwareRevalidation((_identities, currentSignal) =>
    revalidate(references, currentSignal),
  )(guardIdentities as EvidenceReference[], signal);
}
