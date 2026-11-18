import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createSettingsConsentAuthorization } from '../settingsConsentAuthorization';
import { beginConsentReset, finishConsentReset } from '../consentRevision';
import type { SettingsConsentGrant } from '../settingsConsentGrant';

function fixture() {
  const controller = new AbortController();
  const identity = {
    providerId: 'synthetic',
    modelId: 'm',
    recipient: 'Synthetic recipient',
    authorityGeneration: 'epoch',
    credentialEpoch: 'synthetic-credential',
  };
  const scope = {
    purpose: 'record_conversation',
    policyVersion: 'local-records-v1',
    dataCategories: ['conversation'],
  };
  const message = { role: 'user' as const, content: 'Synthetic' };
  const request: OutboundProcessingRequest = {
    ...identity,
    operationRunId: 'run',
    remoteProcessing: true,
    consentScope: scope,
    allowedScope: { sourceKinds: ['personal_record'] },
    payload: { messages: [message] },
    signal: controller.signal,
  };
  const grant: SettingsConsentGrant = {
    version: 1,
    catalogVersion: 'model-settings-v1',
    identity,
    permissions: [{ ...scope, sourceKinds: ['personal_record'] }],
  };
  const owner = {
    slot: 'conversation' as const,
    domain: 'model' as const,
    identity,
    isCurrent: jest.fn(() => true),
  };
  const resolveOwner = jest.fn(async () => owner);
  const readGrant = jest.fn(
    async (): Promise<SettingsConsentGrant | null> => grant,
  );
  return {
    controller,
    message,
    request,
    grant,
    owner,
    readGrant,
    resolveOwner,
    port: createSettingsConsentAuthorization({
      catalogVersion: 'model-settings-v1',
      resolveOwner,
      readGrant,
    }),
  };
}

test('every call reads settings without prompting, including repeat operation IDs', async () => {
  const f = fixture();
  expect(await f.port.authorize(f.request)).toBe('authorized');
  f.readGrant.mockResolvedValue(null);
  expect(await f.port.authorize(f.request)).toBe('renewal_required');
  expect(f.readGrant).toHaveBeenCalledTimes(2);
});

test.each(['payload', 'abort', 'revoke', 'account'] as const)(
  'rejects %s changes during permission lookup',
  async kind => {
    const f = fixture();
    f.readGrant.mockImplementation(async () => {
      if (kind === 'payload') f.message.content = 'Changed';
      if (kind === 'abort') f.controller.abort();
      if (kind === 'revoke') beginConsentReset();
      if (kind === 'account')
        f.owner.identity.authorityGeneration = 'replacement';
      return f.grant;
    });
    try {
      expect(await f.port.authorize(f.request)).toBe('renewal_required');
    } finally {
      finishConsentReset();
    }
  },
);

test('storage failure never authorizes or starts a second decision surface', async () => {
  const f = fixture();
  f.readGrant.mockRejectedValue(new Error('Synthetic storage failure'));
  expect(await f.port.authorize(f.request)).toBe('renewal_required');
  expect(f.resolveOwner).toHaveBeenCalledTimes(1);
});

test('dispatch witness belongs to the exact authorized request and rejects a later owner change', async () => {
  const f = fixture();
  expect(f.port.isAuthorizationCurrent?.(f.request)).toBe(false);
  expect(await f.port.authorize(f.request)).toBe('authorized');
  expect(f.port.isAuthorizationCurrent?.(f.request)).toBe(true);
  expect(f.port.isAuthorizationCurrent?.({ ...f.request })).toBe(false);
  f.owner.isCurrent.mockReturnValue(false);
  expect(f.port.isAuthorizationCurrent?.(f.request)).toBe(false);
});
