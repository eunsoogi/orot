import '../src/agent/polyfills';
import { NativeModules } from 'react-native';
import {
  openSettingsConsentNativeStore,
  consentFixtureIdentity,
  consentFixtureSlots,
} from './settingsConsentNativeStore';
import { createSettingsConsentPersistenceFixture } from './settingsConsentPersistenceFixture';

const busy = new Set<string>();
const phases = [
  'create',
  'approve',
  'inspect',
  'revoke',
  'revoke-retaining-sql',
  'cleanup',
] as const;

/** Native test-host command only. Every phase reopens the UUID's encrypted database
 * and protected state, allowing the host to terminate/relaunch between phases. */
export async function runSettingsConsentPersistenceOperation(
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    parameters.synthetic !== 'settings-consent' ||
    !NativeModules.OrotTestControl
  )
    throw new Error('Explicit synthetic native consent fixture required');
  const identifier = consentFixtureIdentity(parameters.fixtureIdentifier);
  if (!phases.includes(parameters.phase as (typeof phases)[number]))
    throw new Error('Unknown settings consent fixture phase');
  if (busy.has(identifier)) throw new Error('Synthetic fixture already in use');
  busy.add(identifier);
  let store:
    Awaited<ReturnType<typeof openSettingsConsentNativeStore>> | undefined;
  let removed = false;
  try {
    store = await openSettingsConsentNativeStore(
      identifier,
      parameters.phase === 'create',
    );
    if (parameters.phase === 'cleanup') {
      await store.remove();
      removed = true;
      return {
        synthetic: true,
        providerExecution: 'not-configured',
        cleaned: true,
      };
    }
    const fixture = createSettingsConsentPersistenceFixture(store);
    if (parameters.phase === 'approve') {
      for (const slot of consentFixtureSlots) await fixture.approve(slot);
    } else if (
      parameters.phase === 'revoke' ||
      parameters.phase === 'revoke-retaining-sql'
    ) {
      await fixture.revoke(parameters.phase === 'revoke-retaining-sql');
    }
    return {
      ...(await fixture.inspect()),
      encrypted: true,
      phase: parameters.phase,
    };
  } finally {
    if (store && !removed) store.close();
    busy.delete(identifier);
  }
}
