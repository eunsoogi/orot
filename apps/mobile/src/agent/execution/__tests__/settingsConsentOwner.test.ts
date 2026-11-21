import { createSettingsConsentAuthorization } from '../settingsConsentAuthorization';
import { settingsPermissionsForFeature } from '../settingsConsentCatalog';
import { voiceSettingsStore } from '../../../voiceSettings/voiceSettingsStore';
import type { SettingsConsentGrant } from '../settingsConsentGrant';
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

test('Live media requires exact new settings authority and cannot relay generated results', async () => {
  const f = await fixture();
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-live-1.1',
    hasApiKey: true,
  });
  const live = {
    ...f.request,
    providerId: 'openai-live',
    modelId: 'gpt-live-1.1',
    recipient: 'OpenAI Live API',
    allowedScope: { sourceKinds: [] },
    consentScope: {
      purpose: 'live_audio',
      policyVersion: 'selected-live-audio-v1',
      dataCategories: ['live_voice_audio'],
    },
  };
  const legacy = {
    ...live,
    providerId: 'openai-realtime',
    modelId: 'gpt-realtime-2.1',
    recipient: 'OpenAI Realtime API',
    allowedScope: f.request.allowedScope,
    consentScope: {
      purpose: 'realtime_audio',
      policyVersion: 'selected-realtime-v1',
      dataCategories: ['live_voice_audio'],
    },
  };
  const grant: SettingsConsentGrant = {
    version: 1,
    catalogVersion: 'model-settings-v1',
    identity: {
      providerId: legacy.providerId,
      modelId: legacy.modelId,
      recipient: legacy.recipient,
      authorityGeneration: 'a'.repeat(64),
      credentialEpoch: 'synthetic-account',
    },
    permissions: settingsPermissionsForFeature('voice', legacy.providerId),
  };
  const readGrant = jest
    .fn<Promise<SettingsConsentGrant | null>, []>()
    .mockResolvedValue(grant);
  const consent = createSettingsConsentAuthorization({
    catalogVersion: 'model-settings-v1',
    resolveOwner: resolveSettingsConsentOwner,
    readGrant,
  });
  expect(await consent.authorize(live)).toBe('renewal_required');
  expect(await resolveSettingsConsentOwner(legacy)).toBeNull();
  expect(
    await resolveSettingsConsentOwner({ ...live, recipient: legacy.recipient }),
  ).toBeNull();

  const owner = await resolveSettingsConsentOwner(live);
  expect(owner?.identity.providerId).toBe('openai-live');
  const permission = settingsPermissionsForFeature('voice', live.providerId);
  expect(permission.map(p => p.purpose)).toEqual(['live_audio']);
  readGrant.mockResolvedValue({
    ...grant,
    identity: owner!.identity,
    permissions: permission,
  });
  expect(await consent.authorize(live)).toBe('authorized');
  expect(
    await consent.authorize({
      ...live,
      consentScope: {
        purpose: 'live_result',
        policyVersion: 'selected-live-result-v1',
        dataCategories: ['generated_answer'],
      },
    }),
  ).toBe('renewal_required');
  readGrant.mockResolvedValue({
    ...grant,
    identity: owner!.identity,
    permissions: grant.permissions,
  });
  expect(await consent.authorize(live)).toBe('renewal_required');
  readGrant.mockResolvedValue({
    ...grant,
    identity: owner!.identity,
    permissions: permission,
  });
  expect(await consent.authorize(live)).toBe('authorized');
  const invalidated = jest.fn();
  const unsubscribe = consent.subscribeAuthorizationInvalidation!(
    live,
    invalidated,
  );
  const finish = f.mutation.begin();
  expect(invalidated).toHaveBeenCalled();
  expect(consent.isAuthorizationCurrent!(live)).toBe(false);
  finish();
  unsubscribe();
});
