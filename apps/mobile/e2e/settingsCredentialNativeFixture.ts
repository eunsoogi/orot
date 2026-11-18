import { resetGenericPassword } from 'react-native-keychain';
import { createCredentialMutationOwner } from '../src/agent/execution/credentialMutation';
import { createVoiceSettingsStore } from '../src/voiceSettings/createVoiceSettingsStore';
import { createSettingsConsentPersistenceFixture } from './settingsConsentPersistenceFixture';
import {
  consentFixtureIdentity,
  openSettingsConsentNativeStore,
} from './settingsConsentNativeStore';

/** Admitted native hosts only. Reuses the actual API key/epoch writer with a
 * separate UUID Keychain item. No real account/catalog/provider is consulted.
 * Inspection rereads durable credentials; it is not a live-call race probe. */
export async function openSettingsCredentialNativeFixture(
  identifier: unknown,
  create: boolean,
) {
  const name = consentFixtureIdentity(identifier);
  const service = `com.orot.test.${name}.credential-lifecycle`;
  const native = await openSettingsConsentNativeStore(name, create);
  const mutation = createCredentialMutationOwner();
  const credential = createVoiceSettingsStore({
    service,
    beginCredentialMutation: () => mutation.begin(),
    beginSettingsMutation: () => mutation.begin(),
  });
  const fixture = createSettingsConsentPersistenceFixture({
    ...native,
    credentialEpoch: slot =>
      slot === 'voice'
        ? credential.consentAccountEpoch(false)
        : Promise.resolve(`synthetic-${slot}-credential`),
  });
  return {
    async initializeAndApprove() {
      if (!create)
        throw new Error('Synthetic initialization requires fresh host');
      if ((await credential.accountStatus()).connected)
        throw new Error('Synthetic credential already exists');
      await credential.setAccountKey('synthetic-credential-a-not-a-real-key');
      await fixture.approve('voice');
      return fixture.inspect();
    },
    inspect: fixture.inspect,
    authorization: () => fixture.authorization('voice'),
    revoke: () => fixture.revoke(true),
    async replace() {
      const before = await credential.consentAccountEpoch(false);
      if (!before) throw new Error('Synthetic prior credential required');
      await credential.setAccountKey('synthetic-credential-b-not-a-real-key');
      const after = await credential.consentAccountEpoch(false);
      if (!after || after === before)
        throw new Error('Synthetic replacement did not change identity');
      return fixture.inspect();
    },
    approve: () => fixture.approve('voice'),
    async removeCredential() {
      await credential.setAccountKey('');
      if ((await credential.consentAccountEpoch(false)) !== null)
        throw new Error('Synthetic removed credential retained an epoch');
      return fixture.inspect();
    },
    close: native.close,
    async remove() {
      await native.remove();
      await resetGenericPassword({ service });
    },
  };
}
