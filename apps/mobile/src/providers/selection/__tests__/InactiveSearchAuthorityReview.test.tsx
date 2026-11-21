import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { openMigrationSqlite } from '../../../../../../packages/storage/__tests__/migrationSqliteDatabase';
import { apple } from '../../../aiFeatures/integration/featureServiceFixtures';
import { resolveSelectedAiProvider } from '../../../aiFeatures/integration/provider';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../../agent/execution/consentAuthority';
import { settingsConsentCredential } from '../../../agent/execution/settingsConsentCredential';
import { settingsConsentRecipient } from '../../../agent/execution/settingsConsentRecipient';
import { settingsConsentAuthority } from '../../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { providerSelectionStore } from '../keychainSelectionStore';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  },
  STORAGE_TYPE: { RSA: 'KeystoreRSAECB' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../../agent/execution/settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));
jest.mock('../../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));

test('an explicitly suspended local-model search stays off until a fresh mounted disclosure is accepted', async () => {
  const sqlite = openMigrationSqlite(':memory:');
  const slot = 'conversation';
  const domain = 'medical-search';
  const grants = createSettingsConsentStorage(sqlite.database);
  let saved: ConsentAuthorityState | undefined;
  let generation = 0;
  const authority = createConsentAuthority(
    {
      read: async () => saved,
      write: async state => {
        saved = state;
      },
    },
    () => (++generation).toString(16).padStart(64, '0'),
  );
  jest.mocked(settingsConsentAuthority).mockReturnValue(authority);
  jest.mocked(settingsConsentRepository).mockResolvedValue(grants);
  jest.mocked(settingsConsentCredential).mockResolvedValue({
    epoch: 'synthetic-local-credential',
    isCurrent: () => true,
    subscribe: () => () => {},
  });
  let password = '';
  const keychain = {
    service: 'synthetic-local-choice',
    storage: STORAGE_TYPE.RSA,
  };
  jest
    .mocked(getGenericPassword)
    .mockImplementation(async () =>
      password ? { ...keychain, username: 'synthetic', password } : false,
    );
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (_, value, options) => {
      expect(options?.accessible).toBe(
        ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      );
      password = value;
      return keychain;
    });
  const selection = { providerId: APPLE_PROVIDER_ID, modelId: apple.modelId };
  jest.mocked(resolveSelectedAiProvider).mockImplementation(async () => {
    const current = await providerSelectionStore.load();
    return current?.providerId === selection.providerId &&
      current.modelId === selection.modelId
      ? {
          status: 'ready',
          selection,
          option: apple,
          provider: apple.provider,
          modelId: selection.modelId,
          recipient: settingsConsentRecipient(selection.providerId)!,
          remoteProcessing: false,
        }
      : { status: 'selection-required' };
  });
  const close = jest.fn();
  const view = await render(
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[apple]}
      requirements={{ inputTypes: ['text'] }}
      selectionStore={providerSelectionStore}
      onSelectionCommitted={close}
    />,
  );
  const choose = () => fireEvent.press(view.getByTestId('provider-option-0'));
  const toggle = (value: boolean) =>
    fireEvent(
      view.getByTestId('settings-consent-medical'),
      'valueChange',
      value,
    );
  const confirm = () =>
    fireEvent.press(view.getByTestId('provider-selection-confirm'));
  const allow = () =>
    fireEvent.press(view.getByTestId('inference-disclosure-allow'));
  try {
    await choose();
    await toggle(true);
    await confirm();
    expect(
      view.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent('Europe PMC');
    expect(await grants.read(slot, domain)).toBeNull();
    await allow();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    const initial = await grants.read(slot, domain);
    expect(initial?.identity.authorityGeneration).toBe(
      (await authority.current())?.generation,
    );
    expect(initial?.identity.recipient).toBe('Europe PMC');

    await choose();
    await waitFor(() =>
      expect(view.getByTestId('settings-consent-medical').props.value).toBe(
        true,
      ),
    );
    await toggle(false);
    await confirm();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
    expect(view.queryByTestId('inference-disclosure-allow')).toBeNull();
    expect(await authority.current()).toBeNull();
    expect(await grants.read(slot, domain)).toEqual(initial);

    await choose();
    await waitFor(() =>
      expect(
        view.getByTestId('settings-consent-medical').props.disabled,
      ).not.toBe(true),
    );
    expect(view.getByTestId('settings-consent-medical').props.value).toBe(
      false,
    );
    expect(await authority.current()).toBeNull();
    await toggle(true);
    await confirm();
    expect(
      view.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent('Europe PMC');
    expect(await authority.current()).toBeNull();
    expect(await grants.read(slot, domain)).toEqual(initial);
    await allow();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(3));
    const active = await authority.current();
    expect(active?.generation).not.toBe(initial?.identity.authorityGeneration);
    expect(
      (await grants.read(slot, domain))?.identity.authorityGeneration,
    ).toBe(active?.generation);
    expect(await grants.read(slot, 'public-web')).toBeNull();
  } finally {
    await view.unmount();
    sqlite.close();
  }
});
