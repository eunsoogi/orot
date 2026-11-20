import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import {
  parseSettingsConsentGrant,
  settingsGrantCoversRequest,
} from '../settingsConsentGrant';

const identity = {
  providerId: 'synthetic',
  modelId: 'model-a',
  recipient: 'Synthetic recipient',
  authorityGeneration: 'epoch-a',
  credentialEpoch: 'synthetic-credential',
};
const grant = {
  version: 1 as const,
  catalogVersion: 'settings-v1',
  identity,
  permissions: [
    {
      purpose: 'record_conversation',
      policyVersion: 'local-records-v1',
      dataCategories: ['health_records', 'conversation'],
      sourceKinds: ['personal_record'],
    },
  ],
};
const request = (): OutboundProcessingRequest => ({
  operationRunId: 'run-a',
  ...identity,
  remoteProcessing: true,
  consentScope: {
    purpose: 'record_conversation',
    policyVersion: 'local-records-v1',
    dataCategories: ['health_records'],
  },
  allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['first'] },
  payload: { messages: [{ role: 'user', content: 'synthetic first record' }] },
  signal: new AbortController().signal,
});
const covers = (value = request()) =>
  settingsGrantCoversRequest(grant, identity, 'settings-v1', value);

test('permission covers changed record contents without becoming a freshness verdict', () => {
  expect(covers()).toBe(true);
  const next = request();
  expect(
    covers({
      ...next,
      operationRunId: 'new-run',
      allowedScope: {
        sourceKinds: ['personal_record'],
        sourceIds: ['new-record'],
      },
      payload: {
        messages: [{ role: 'user', content: 'synthetic different contents' }],
      },
    }),
  ).toBe(true);
  // This pure permission function never reads source storage or authorizes a provider call.
});

test('recipient, model, account epoch and policy cannot inherit another permission', () => {
  expect(covers({ ...request(), recipient: 'Other recipient' })).toBe(false);
  expect(covers({ ...request(), modelId: 'other-model' })).toBe(false);
  expect(
    settingsGrantCoversRequest(
      grant,
      { ...identity, authorityGeneration: 'new-epoch' },
      'settings-v1',
      request(),
    ),
  ).toBe(false);
  expect(
    settingsGrantCoversRequest(grant, identity, 'new-policy', request()),
  ).toBe(false);
  expect(
    covers({
      ...request(),
      consentScope: { ...request().consentScope!, policyVersion: 'unknown' },
    }),
  ).toBe(false);
  expect(covers({ ...request(), consentScope: undefined })).toBe(false);
});

test('expanded categories, kinds, unknown purposes and cancellation fail closed', () => {
  expect(
    covers({
      ...request(),
      consentScope: {
        ...request().consentScope!,
        dataCategories: ['health_records', 'photo_ocr'],
      },
    }),
  ).toBe(false);
  expect(
    covers({
      ...request(),
      allowedScope: { sourceKinds: ['generated_artifact'] },
    }),
  ).toBe(false);
  expect(
    covers({
      ...request(),
      consentScope: { ...request().consentScope!, purpose: 'unknown' },
    }),
  ).toBe(false);
  const controller = new AbortController();
  controller.abort();
  expect(covers({ ...request(), signal: controller.signal })).toBe(false);
});

test('old, partial and extra-field records are rejected without migrating approval', () => {
  for (const value of [
    null,
    { digest: 'synthetic' },
    { ...grant, version: 0 },
    { ...grant, permissions: [] },
    { ...grant, identity: { ...identity, authorityGeneration: '' } },
    { ...grant, identity: { ...identity, credentialEpoch: undefined } },
    { ...grant, identity: { ...identity, credentialEpoch: '' } },
    { ...grant, secret: 'synthetic' },
  ]) {
    expect(parseSettingsConsentGrant(value)).toBeNull();
  }
  const parsed = parseSettingsConsentGrant(grant)!;
  expect(parsed).toEqual(grant);
  expect(parsed.identity).not.toBe(grant.identity);
  expect(parsed.permissions[0].dataCategories).not.toBe(
    grant.permissions[0].dataCategories,
  );
});

test('empty evidence kinds are not permitted outside exact Live microphone policy', () => {
  const empty = { ...grant.permissions[0], sourceKinds: [] };
  expect(
    parseSettingsConsentGrant({ ...grant, permissions: [empty] }),
  ).toBeNull();
  expect(covers({ ...request(), allowedScope: { sourceKinds: [] } })).toBe(
    false,
  );
  expect(
    parseSettingsConsentGrant({
      ...grant,
      permissions: [{ ...empty, purpose: 'live_audio' }],
    }),
  ).toBeNull();
  expect(
    parseSettingsConsentGrant({
      ...grant,
      permissions: [
        {
          ...empty,
          purpose: 'live_audio',
          policyVersion: 'selected-live-audio-v1',
          sourceKinds: ['personal_record'],
        },
      ],
    }),
  ).toBeNull();
});
