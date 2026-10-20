import type { EvidenceReference } from '@orot/agent-runtime';
import { withLocalDeletionAwareRevalidation } from '../../memory/deletionAwareEvidenceRevalidation';
import { compoundEvidenceReferences } from './compoundEvidenceReferences';
import { parseHealthContextScope } from '../../healthEvidence/healthContext/scope';

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
  // External publications have no local tombstone identity; the run's snapshot validator still checks them below.
  const identities = references.map(reference =>
    reference.sourceKind === 'external_medical'
      ? reference
      : resolveIdentity
        ? resolveIdentity(reference)
        : reference,
  );
  if (identities.some(reference => !reference)) return Promise.resolve(false);
  const ordinary = (identities as EvidenceReference[]).filter(reference => {
    const locator = reference.locator;
    return !(
      reference.sourceKind === 'personal_record' &&
      locator &&
      typeof locator === 'object' &&
      !Array.isArray(locator) &&
      (locator as Record<string, unknown>).kind === 'health_context_period'
    );
  });
  const periods = (identities as EvidenceReference[]).filter(
    reference => !ordinary.includes(reference),
  );
  // Only registry-resolved, validated period locators use generation and aggregate-revision guards.
  // Unknown locators remain fail-closed; a synthetic ID is never passed off as a stored source row.
  if (
    periods.some(
      reference =>
        !resolveIdentity || !parseHealthContextScope(reference.locator),
    )
  )
    return Promise.resolve(false);
  const expanded = ordinary.map(compoundEvidenceReferences);
  if (expanded.some(value => !value)) return Promise.resolve(false);
  const guardIdentities = expanded
    .flatMap(value => value ?? [])
    .map(deletionGuardIdentity);
  if (guardIdentities.some(reference => !reference))
    return Promise.resolve(false);

  // Keep model-facing aliases unchanged for the registry's revision validation.
  return withLocalDeletionAwareRevalidation((_identities, currentSignal) =>
    revalidate(references, currentSignal),
  )(guardIdentities as EvidenceReference[], signal);
}
