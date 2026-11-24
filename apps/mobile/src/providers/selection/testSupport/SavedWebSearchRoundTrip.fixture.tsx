import { calendarModelStore } from '../../../calendarModelSettings/calendarModelStore';
import { resolveCalendarModel } from '../../../calendarModelSettings/resolveCalendarModel';
import { classifyCalendarEvents } from '../../../medicalAppointments/classificationWorkflow';
import {
  event,
  input as classificationInput,
  makeProvider,
  workflowResponse,
} from '../../../medicalAppointments/classificationWorkflowTestFixtures';
import type { LanguageModelRequest } from '@orot/model-runtime';
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
jest.mock('../../../calendarModelSettings/resolveCalendarModel', () => ({
  resolveCalendarModel: jest.fn(),
}));
export function openSavedWebSettingsFixture(
  modelOverride?: ReturnType<typeof publicEvidenceFixture>['selected'],
) {
  const sql = openMigrationSqlite(':memory:');
  const execution = publicEvidenceFixture();
  const model = modelOverride ?? execution.selected;
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
  let persistedCalendar: ConsentAuthorityState | null = null;
  const calendarAuthority = createConsentAuthority(
    {
      read: async () => persistedCalendar,
      write: async state => {
        persistedCalendar = state;
      },
    },
    () => (++token).toString(16).padStart(64, '0'),
  );
  const repo = createSettingsConsentStorage(sql.database);
  jest.mocked(settingsConsentRepository).mockResolvedValue(repo);
  jest
    .mocked(settingsConsentAuthority)
    .mockImplementation(slot =>
      slot === 'calendar' ? calendarAuthority : authority,
    );
  const classifyProviderCall = jest.fn(async (request: LanguageModelRequest) =>
    workflowResponse(request),
  );
  const calendarProvider = {
    ...makeProvider(classifyProviderCall),
    id: 'openai-api-decisions',
  };
  const calendarChoice = {
    providerId: calendarProvider.id,
    modelId: 'gpt-6-luna',
  };
  jest.mocked(resolveCalendarModel).mockImplementation(async () => {
    const savedCalendar = await calendarModelStore.load();
    if (savedCalendar?.providerId !== calendarChoice.providerId)
      return { status: 'selection-required' };
    return {
      status: 'ready',
      selection: savedCalendar,
      provider: calendarProvider,
      option: {
        ...option,
        provider: calendarProvider,
        modelId: calendarChoice.modelId,
        displayName: 'Decisions',
      },
      modelId: calendarChoice.modelId,
      recipient: 'OpenAI API',
      remoteProcessing: true,
    };
  });
  jest.mocked(settingsConsentCredential).mockImplementation(async () => ({
    epoch,
    isCurrent: credential.capture()!,
    subscribe: credential.subscribe,
  }));
  const passwords = new Map<string, string>();
  jest.mocked(getGenericPassword).mockImplementation(async settings => {
    const service = settings?.service ?? '',
      password = passwords.get(service);
    return password
      ? {
          password,
          username: 'synthetic',
          service,
          storage: STORAGE_TYPE.RSA,
        }
      : false;
  });
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (_username, next, settings) => {
      const service = settings?.service ?? '';
      passwords.set(service, next);
      return { service, storage: STORAGE_TYPE.RSA };
    });
  jest
    .mocked(resolveSelectedAiProvider)
    .mockImplementation(async () =>
      (await providerSelectionStore.load())?.modelId === selection.modelId
        ? selected
        : { status: 'selection-required' },
    );
  const selectionView = (feature = false) => (
    <ProviderSelectionScreen
      presentation={feature ? 'feature' : 'settings-provider'}
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
  const classify = () =>
    classifyCalendarEvents(
      classificationInput([event(0)], {
        provider: calendarProvider,
        modelId: calendarChoice.modelId,
        recipient: 'OpenAI API',
        remoteProcessing: true,
        consent: createSettingsConsentAuthorization({
          catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
          resolveOwner: resolveSettingsConsentOwner,
          readGrant: reloaded.read,
        }),
      }),
    );
  return {
    sql,
    execution,
    selection,
    recipient,
    commit,
    credential,
    authority,
    calendarAuthority,
    classifyProviderCall,
    calendarChoice,
    selectionView,
    reloaded,
    run,
    classify,
    setEpoch: (next: string) => {
      epoch = next;
    },
  };
}
