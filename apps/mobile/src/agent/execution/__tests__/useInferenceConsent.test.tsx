import { act, render } from '@testing-library/react-native';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { useInferenceConsent } from '../useInferenceConsent';
import { resolveSettingsConsentOwner } from '../settingsConsentOwner';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';

jest.mock('../settingsConsentOwner', () => ({
  resolveSettingsConsentOwner: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
const identity = {
  providerId: 'synthetic',
  modelId: 'model',
  recipient: 'Synthetic recipient',
  authorityGeneration: 'generation',
  credentialEpoch: 'credential',
};
const permission = {
  purpose: 'record_conversation',
  policyVersion: 'local-records-v1',
  dataCategories: ['conversation'],
  sourceKinds: ['personal_record'],
};
const owner = {
  slot: 'conversation' as const,
  domain: 'model' as const,
  identity,
  isCurrent: () => true,
};
const read = jest.fn();
let port: ExecutionConsentPort;
function Harness() {
  const value = useInferenceConsent();
  port = value.consent;
  return value.disclosureSheet;
}
function request(
  text = 'Synthetic',
  signal = new AbortController().signal,
): OutboundProcessingRequest {
  return {
    ...identity,
    operationRunId: 'synthetic',
    remoteProcessing: true,
    consentScope: permission,
    allowedScope: { sourceKinds: ['personal_record'] },
    payload: { messages: [{ role: 'user', content: text }] },
    signal,
  };
}
beforeEach(() => {
  jest.mocked(resolveSettingsConsentOwner).mockResolvedValue(owner);
  read.mockReset().mockResolvedValue({
    version: 1,
    catalogVersion: 'model-settings-v1',
    identity,
    permissions: [permission],
  });
  jest.mocked(settingsConsentRepository).mockResolvedValue({ read } as never);
});

test('approved data categories authorize subsequent conversations without a modal or payload-specific repeat prompt', async () => {
  const view = await render(<Harness />);
  await expect(port.authorize(request('Synthetic first'))).resolves.toBe(
    'authorized',
  );
  await expect(port.authorize(request('Synthetic next'))).resolves.toBe(
    'authorized',
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(view.queryByTestId('inference-disclosure-modal')).toBeNull();
});

test('missing settings permission and expanded data deny without a fallback chat prompt', async () => {
  const view = await render(<Harness />);
  read.mockResolvedValueOnce(null);
  await expect(port.authorize(request())).resolves.toBe('renewal_required');
  const changed = request();
  await expect(
    port.authorize({
      ...changed,
      consentScope: { ...permission, dataCategories: ['raw_photo'] },
    }),
  ).resolves.toBe('renewal_required');
  expect(view.queryByTestId('inference-disclosure-modal')).toBeNull();
});

test('abort and unmount invalidate pending and already issued request witnesses', async () => {
  const view = await render(<Harness />);
  const outbound = request();
  await expect(port.authorize(outbound)).resolves.toBe('authorized');
  const invalidated = jest.fn();
  const stop = port.subscribeAuthorizationInvalidation!(outbound, invalidated);
  const controller = new AbortController();
  controller.abort();
  await expect(
    port.authorize(request('Synthetic stopped', controller.signal)),
  ).resolves.toBe('renewal_required');
  await act(async () => view.unmount());
  expect(port.isAuthorizationCurrent!(outbound)).toBe(false);
  expect(invalidated).toHaveBeenCalled();
  await expect(port.authorize(request())).resolves.toBe('renewal_required');
  stop();
});
