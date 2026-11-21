import { saveModelSettingsConsent } from '../../../agent/execution/saveModelSettingsConsent';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { openMigrationSqlite } from '../../../../../../packages/storage/__tests__/migrationSqliteDatabase';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';
import { settingsConsentAuthority } from '../../../storage/settingsConsentAuthority';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../../agent/execution/consentAuthority';
import { createCredentialMutationOwner } from '../../../agent/execution/credentialMutation';
import { settingsConsentCredential } from '../../../agent/execution/settingsConsentCredential';
import { settingsConsentRecipient } from '../../../agent/execution/settingsConsentRecipient';
import { resolveSettingsConsentOwner } from '../../../agent/execution/settingsConsentOwner';
import { createSettingsConsentAuthorization } from '../../../agent/execution/settingsConsentAuthorization';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../../../agent/execution/settingsConsentCatalog';
import { resolveSelectedAiProvider } from '../../../aiFeatures/integration/provider';
import { publicEvidenceFixture } from '../../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';
import { createPublicWebEvidence } from '../../../aiFeatures/integration/publicWebEvidence';
import { runDefaultPublicSearch } from '../../../aiFeatures/integration/defaultPublicSearch';
import { finishRagConversation } from '../../../aiFeatures/integration/finishRagConversation';
import { providerSelectionStore } from '../keychainSelectionStore';
import ProviderSelectionScreen from '../ProviderSelectionScreen';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'synthetic' },
  STORAGE_TYPE: { RSA: 'KeystoreRSAECB' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../../../agent/execution/settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));
jest.mock('../../../aiFeatures/integration/provider', () => ({
  ...jest.requireActual('../../../aiFeatures/integration/provider'),
  resolveSelectedAiProvider: jest.fn(),
}));

test('one explicit combined settings approval upgrades an exact legacy model-only grant', async () => {
  const sql = openMigrationSqlite(':memory:');
  const execution = publicEvidenceFixture();
  const model = execution.selected;
  const selection = { providerId: model.provider.id, modelId: model.modelId };
  const recipient = settingsConsentRecipient(selection.providerId)!;
  const option = {
    ...model.option,
    modelId: selection.modelId,
    displayName: 'Synthetic ChatGPT model',
  };
  const selected = { ...model, recipient, option };
  const commit = jest.fn();
  const credential = createCredentialMutationOwner();
  let epoch = 'epoch-one';
  let persisted: ConsentAuthorityState | null = null;
  let token = 0;
  const authority = createConsentAuthority(
    {
      read: async () => persisted,
      write: async state => {
        persisted = state;
      },
    },
    () => (++token).toString(16).padStart(64, '0'),
  );
  const repo = createSettingsConsentStorage(sql.database);
  jest.mocked(settingsConsentRepository).mockResolvedValue(repo);
  jest.mocked(settingsConsentAuthority).mockReturnValue(authority);
  jest.mocked(settingsConsentCredential).mockImplementation(async () => ({
    epoch,
    isCurrent: credential.capture()!,
    subscribe: credential.subscribe,
  }));
  let password: string | undefined;
  jest.mocked(getGenericPassword).mockImplementation(async () =>
    password
      ? {
          password,
          username: 'synthetic',
          service: 'synthetic',
          storage: STORAGE_TYPE.RSA,
        }
      : false,
  );
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (_username, next) => {
      password = next;
      return { service: 'synthetic', storage: STORAGE_TYPE.RSA };
    });
  jest
    .mocked(resolveSelectedAiProvider)
    .mockImplementation(async () =>
      (await providerSelectionStore.load())?.modelId === selection.modelId
        ? selected
        : { status: 'selection-required' },
    );
  const selectionView = () => (
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[option]}
      requirements={{ inputTypes: ['text'], toolCalling: true }}
      selectionStore={providerSelectionStore}
      onSelectionCommitted={commit}
    />
  );
  const reloaded = createSettingsConsentStorage(sql.database);
  const run = async (id: string) => {
    const consent = createSettingsConsentAuthorization({
      catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
      resolveOwner: resolveSettingsConsentOwner,
      readGrant: reloaded.read,
    });
    const web = createPublicWebEvidence({
      selected,
      consent,
      recoverUnavailable: true,
    });
    const signal = new AbortController().signal;
    const search = await runDefaultPublicSearch({
      tool: web?.tool,
      operationRunId: id,
      request: 'sleep do not send this synthetic text',
      signal,
    });
    const citations = search.status === 'success' ? search.batch.items : [];
    const answer = await finishRagConversation({
      outcome: { status: 'answer', answer: 'Synthetic answer', citations },
      publicSearch: search,
      retention: {
        onValidatedEvidence() {},
        async finish(outcome) {
          return { outcome, retained: false };
        },
      },
      signal,
      continuation: false,
    });
    return { search, answer };
  };
  try {
    // Recreate an existing legacy receipt without changing current settings behavior.
    await saveModelSettingsConsent({
      slot: 'conversation',
      selection,
      recipient,
      remote: true,
      store: providerSelectionStore,
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    const legacy = await reloaded.read('conversation');
    expect(legacy).not.toBeNull();
    expect(await reloaded.read('conversation', 'public-web')).toBeNull();
    expect((await run('legacy-model-only')).search.status).toBe(
      'consent_required',
    );

    const view = await render(selectionView());
    const press = (id: string) => fireEvent.press(view.getByTestId(id));
    expect(
      view.queryByTestId('settings-provider-review-web-search'),
    ).toBeNull();
    await press('provider-option-0');
    expect(view.queryByTestId('settings-consent-web')).toBeNull();
    await waitFor(() =>
      expect(view.getByTestId('provider-selection-confirm')).toBeEnabled(),
    );
    await press('provider-selection-confirm');
    expect(view.getByTestId('inference-disclosure-scope')).toHaveTextContent(
      /건강 기록[\s\S]+공개 웹검색/,
    );
    expect(
      view.getByTestId('inference-disclosure-scope'),
    ).not.toHaveTextContent(/Europe PMC/);
    expect(await reloaded.read('conversation', 'public-web')).toBeNull();
    await press('inference-disclosure-cancel');
    expect(await reloaded.read('conversation')).toEqual(legacy);
    expect(await reloaded.read('conversation', 'public-web')).toBeNull();
    await press('provider-selection-confirm');
    await press('inference-disclosure-allow');
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const saved = await reloaded.read('conversation', 'public-web');
    expect(saved?.permissions[0]?.purpose).toBe('public_web_search');
    expect(saved?.identity.authorityGeneration).toBe(
      (await reloaded.read('conversation'))?.identity.authorityGeneration,
    );
    expect(await reloaded.read('conversation', 'medical-search')).toBeNull();
    await view.unmount();

    const resumed = await render(selectionView());
    await fireEvent.press(resumed.getByTestId('provider-option-0'));
    await waitFor(() =>
      expect(resumed.getByTestId('provider-selection-confirm')).toBeEnabled(),
    );
    await fireEvent.press(resumed.getByTestId('provider-selection-confirm'));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(resumed.queryByTestId('inference-disclosure-allow')).toBeNull();
    expect(await reloaded.read('conversation', 'public-web')).toEqual(saved);
    expect(setGenericPassword).toHaveBeenCalledTimes(2);
    await resumed.unmount();

    const success = await run('exact-approved');
    expect(success.search.status).toBe('success');
    expect(execution.search).toHaveBeenCalledTimes(1);
    expect(execution.search.mock.calls[0]?.[0].query).not.toContain(
      'do not send',
    );
    expect(success.answer).toMatchObject({
      status: 'answer',
      answer: 'Synthetic answer',
      citations: [expect.objectContaining({ sourceKind: 'external_medical' })],
    });
    const finish = credential.begin();
    epoch = 'epoch-two';
    finish();
    expect((await run('changed-credential')).search.status).toBe(
      'consent_required',
    );
    expect(execution.search).toHaveBeenCalledTimes(1);
    epoch = 'epoch-one';
    await authority.revoke();
    expect((await run('revoked-authority')).search.status).toBe(
      'consent_required',
    );
    expect(execution.search).toHaveBeenCalledTimes(1);
  } finally {
    sql.close();
  }
});
