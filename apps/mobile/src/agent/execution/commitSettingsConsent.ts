import type { createConsentAuthority } from './consentAuthority';
import type { SettingsConsentGrant } from './settingsConsentGrant';
import type {
  createSettingsConsentStorage,
  SettingsConsentSlot,
  SettingsConsentDomain,
} from '../../storage/settingsConsentStorage';

/** Coordinates independently protected stores without pretending they share a transaction.
 * Durable suspension makes a committed SQL grant unusable until selection and credential
 * ownership are rechecked after commit. The caller supplies a shared, slot-owned authority. */
export async function commitSettingsConsent(input: {
  readonly slot: SettingsConsentSlot;
  readonly authority: ReturnType<typeof createConsentAuthority>;
  readonly grants: ReturnType<typeof createSettingsConsentStorage>;
  readonly makeGrant: (generation: string) => SettingsConsentGrant;
  readonly additionalGrants?: (generation: string) => readonly {
    domain: Exclude<SettingsConsentDomain, 'model'>;
    grant: SettingsConsentGrant;
  }[];
  readonly saveSelection: () => Promise<void>;
  readonly isSelectionCurrent: () => Promise<boolean>;
  readonly isPreviousSelectionCurrent: () => Promise<boolean>;
  readonly isCredentialCurrent: () => Promise<boolean>;
  readonly isRequestCurrent: () => boolean;
  readonly signal: AbortSignal;
}): Promise<void> {
  const requestCurrent = () =>
    !input.signal.aborted && input.isRequestCurrent();
  if (!requestCurrent()) throw new Error('Settings decision cancelled');
  const prior = await input.authority.current();
  if (!requestCurrent()) throw new Error('Settings decision cancelled');
  const suspended = await input.authority.suspend();
  const token = suspended.generation;
  let activationAttempted = false;
  const staged: { token: string; domain: SettingsConsentDomain }[] = [];
  const selectedCurrent = async () =>
    requestCurrent() &&
    (await input.isCredentialCurrent()) &&
    requestCurrent() &&
    (await input.isSelectionCurrent()) &&
    requestCurrent();
  try {
    if (!requestCurrent() || !(await input.isCredentialCurrent()))
      throw new Error('Settings owner changed');
    const decisions = [
      { domain: 'model' as const, grant: input.makeGrant(token) },
      ...(input.additionalGrants?.(token) ?? []),
    ];
    if (new Set(decisions.map(value => value.domain)).size !== decisions.length)
      throw new Error('Duplicate permission recipient domain');
    for (const decision of decisions) {
      if (decision.grant.identity.authorityGeneration !== token)
        throw new Error('Settings authority mismatch');
      const activation = `${token}-${decision.domain}`;
      staged.push({ token: activation, domain: decision.domain });
      await input.grants.stage(
        input.slot,
        activation,
        decision.grant,
        decision.domain,
      );
    }
    if (!requestCurrent()) throw new Error('Settings decision cancelled');
    await input.saveSelection();
    if (!(await selectedCurrent()))
      throw new Error('Settings selection changed');
    activationAttempted = true;
    for (const decision of staged)
      await input.grants.activate(
        input.slot,
        decision.token,
        requestCurrent,
        decision.domain,
      );
    if (!(await input.authority.complete(suspended, selectedCurrent)))
      throw new Error('Settings permission activation incomplete');
    const current = await input.authority.current();
    if (current?.generation !== token || !(await selectedCurrent()))
      throw new Error('Settings owner changed after activation');
  } catch (error) {
    // Pending cleanup is best-effort only because durable suspension is the safety gate.
    // Never restore an old authority after SQL activation may have replaced its grant.
    try {
      for (const decision of staged) await input.grants.cancel(decision.token);
    } catch {
      /* A pending row cannot authorize. */
    }
    if (activationAttempted) {
      try {
        await input.authority.suspendCurrent(token);
      } catch {
        /* This owner remains blocked. */
      }
    }
    if (prior && !activationAttempted) {
      try {
        await input.authority.restore(
          suspended,
          prior,
          async () =>
            (await input.isCredentialCurrent()) &&
            (await input.isPreviousSelectionCurrent()),
        );
      } catch {
        /* Failed proof/persistence keeps this owner blocked. */
      }
    }
    throw error;
  }
}
