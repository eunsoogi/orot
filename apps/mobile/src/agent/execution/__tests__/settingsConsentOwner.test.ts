import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { resolveSettingsConsentOwner } from '../settingsConsentOwner';
import { resolveSelectedAiProvider } from '../../../aiFeatures/integration/provider';
import { settingsConsentCredential } from '../settingsConsentCredential';
import { settingsConsentAuthority } from '../../../storage/settingsConsentAuthority';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../consentAuthority';
import { createCredentialMutationOwner } from '../credentialMutation';

const mockSelection = createCredentialMutationOwner();
jest.mock('../../../providers/selection/keychainSelectionStore', () => ({
  providerSelectionStore: {
    liveWitness: () => mockSelection.capture(),
    subscribeChanges: (listener: () => void) =>
      mockSelection.subscribe(listener),
  },
}));
jest.mock('../../../calendarModelSettings/calendarModelStore', () => ({
  calendarModelStore: {
    liveWitness: () => mockSelection.capture(),
    subscribeChanges: (listener: () => void) =>
      mockSelection.subscribe(listener),
  },
}));
jest.mock('../../../calendarModelSettings/resolveCalendarModel', () => ({
  resolveCalendarModel: jest.fn(),
}));
jest.mock('../../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { load: jest.fn() },
}));
jest.mock('../../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));

async function fixture(remote = true) {
  const mutation = createCredentialMutationOwner();
  let persisted: ConsentAuthorityState | null = null;
  const authority = createConsentAuthority(
    {
      read: async () => persisted,
      write: async state => {
        persisted = state;
      },
    },
    () => 'a'.repeat(64),
  );
  await authority.activate();
  jest.mocked(settingsConsentAuthority).mockReturnValue(authority);
  jest.mocked(settingsConsentCredential).mockImplementation(async () => ({
    epoch: 'synthetic-account',
    isCurrent: mutation.capture()!,
    subscribe: mutation.subscribe,
  }));
  jest.mocked(resolveSelectedAiProvider).mockResolvedValue({
    status: 'ready',
    provider: { id: 'synthetic-provider' },
    modelId: 'synthetic-model',
    recipient: 'Synthetic recipient',
    remoteProcessing: remote,
  } as Awaited<ReturnType<typeof resolveSelectedAiProvider>>);
  const request: OutboundProcessingRequest = {
    operationRunId: 'synthetic-run',
    providerId: 'synthetic-provider',
    modelId: 'synthetic-model',
    recipient: 'Synthetic recipient',
    remoteProcessing: true,
    consentScope: {
      purpose: 'record_conversation',
      policyVersion: 'local-records-v1',
      dataCategories: ['conversation'],
    },
    allowedScope: { sourceKinds: ['personal_record'] },
    payload: { messages: [{ role: 'user', content: 'Synthetic request' }] },
    signal: new AbortController().signal,
  };
  return { request, mutation, authority };
}

test('production resolver binds exact selected recipient and observes immediate credential/selection invalidation', async () => {
  const f = await fixture();
  expect(
    await resolveSettingsConsentOwner({ ...f.request, modelId: 'other' }),
  ).toBeNull();
  expect(
    await resolveSettingsConsentOwner({
      ...f.request,
      recipient: 'Another recipient',
    }),
  ).toBeNull();
  const owner = await resolveSettingsConsentOwner(f.request);
  expect(owner?.identity).toMatchObject({
    providerId: 'synthetic-provider',
    credentialEpoch: 'synthetic-account',
    authorityGeneration: 'a'.repeat(64),
  });
  const invalidated = jest.fn();
  const unsubscribe = owner!.subscribeInvalidation!(invalidated);
  const finish = f.mutation.begin();
  expect(owner!.isCurrent()).toBe(false);
  expect(invalidated).toHaveBeenCalledTimes(1);
  finish();
  expect(owner!.isCurrent()).toBe(false);
  unsubscribe();
  const next = await resolveSettingsConsentOwner(f.request);
  const finishSelection = mockSelection.begin();
  expect(next!.isCurrent()).toBe(false);
  finishSelection();
});

test('local model does not confer external model permission but can own an independently approved medical recipient', async () => {
  const f = await fixture(false);
  expect(await resolveSettingsConsentOwner(f.request)).toBeNull();
  const medical = {
    ...f.request,
    providerId: 'europe-pmc',
    modelId: 'public-medical-search',
    recipient: 'Europe PMC',
    consentScope: {
      purpose: 'public_medical_search',
      policyVersion: 'public-query-v1',
      dataCategories: ['medical_search_terms'],
    },
  };
  const owner = await resolveSettingsConsentOwner(medical);
  expect(owner?.domain).toBe('medical-search');
  expect(owner?.identity.recipient).toBe('Europe PMC');
  expect(
    await resolveSettingsConsentOwner({
      ...medical,
      recipient: 'Other database',
    }),
  ).toBeNull();
  await f.authority.revoke();
  expect(owner?.isCurrent()).toBe(false);
  expect(await resolveSettingsConsentOwner(medical)).toBeNull();
});
