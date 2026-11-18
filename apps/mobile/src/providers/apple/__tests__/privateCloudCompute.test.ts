import { NativeModules } from 'react-native';
import { applePrivateCloudComputeNativeBridge } from '../nativeBridge';
import { applePrivateCloudComputeProvider } from '../index';
import {
  APPLE_PCC_MODEL_ID,
  loadPrivateCloudComputeOption,
} from '../../selection/privateCloudCompute';
import { resolveSelectedAiProvider } from '../../../aiFeatures/integration/provider';
import { t } from '../../../i18n';

const request = {
  messages: [{ role: 'user' as const, content: 'Synthetic question' }],
};

afterEach(() => jest.restoreAllMocks());

it('keeps the missing native PCC capability unavailable without fallback', async () => {
  expect(NativeModules.AppleFoundationModelsModule).toBeUndefined();
  await expect(
    applePrivateCloudComputeNativeBridge.getAvailability(),
  ).resolves.toEqual({ status: 'unsupportedOS' });
});

it.each([
  'entitlementRequired',
  'unsupportedOS',
  'quotaExceeded',
  'unavailable',
] as const)('blocks generation and selection when PCC is %s', async status => {
  jest
    .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
    .mockResolvedValue({ status });
  const option = await loadPrivateCloudComputeOption();
  expect(option.availability.status).toBe('unavailable');
  expect(option.privacyBoundary).toBe('selected-context-remote');
  // The native availability boundary independently stops a send, not just the UI.
  const native = jest
    .spyOn(applePrivateCloudComputeNativeBridge, 'getAvailability')
    .mockResolvedValue({ status });
  const generate = jest.spyOn(applePrivateCloudComputeNativeBridge, 'generate');
  expect((await applePrivateCloudComputeProvider.generate(request)).ok).toBe(
    false,
  );
  expect(native).toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it('resolves the exact PCC choice as Apple remote processing, independently of other accounts', async () => {
  jest
    .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
    .mockResolvedValue({ status: 'available' });
  const option = await loadPrivateCloudComputeOption();
  const local = jest.fn();
  const result = await resolveSelectedAiProvider({
    selectionStore: {
      load: async () => ({
        providerId: option.provider.id,
        modelId: APPLE_PCC_MODEL_ID,
      }),
      save: jest.fn(),
      clear: jest.fn(),
    },
    loadPccOption: async () => option,
    loadAppleOption: local,
  });
  expect(result).toMatchObject({
    status: 'ready',
    remoteProcessing: true,
    recipient: t('provider.pcc.recipient'),
    modelId: APPLE_PCC_MODEL_ID,
  });
  expect(local).not.toHaveBeenCalled();
});

it('never substitutes on-device Apple when the saved PCC model identity is stale', async () => {
  jest
    .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
    .mockResolvedValue({ status: 'available' });
  const option = await loadPrivateCloudComputeOption();
  const result = await resolveSelectedAiProvider({
    selectionStore: {
      load: async () => ({
        providerId: option.provider.id,
        modelId: 'unknown',
      }),
      save: jest.fn(),
      clear: jest.fn(),
    },
    loadPccOption: async () => option,
  });
  expect(result).toEqual({ status: 'unavailable' });
});

it.each([
  ['PCC_QUOTA_EXCEEDED', 'rate_limited', false],
  ['PCC_NETWORK_UNAVAILABLE', 'provider_unavailable', true],
  ['PCC_SERVICE_UNAVAILABLE', 'provider_unavailable', true],
] as const)(
  'preserves %s without rerouting or automatic retries',
  async (code, expected, retryable) => {
    jest
      .spyOn(applePrivateCloudComputeNativeBridge, 'getAvailability')
      .mockResolvedValue({ status: 'available' });
    const send = jest
      .spyOn(applePrivateCloudComputeNativeBridge, 'generate')
      .mockRejectedValue({ code, message: 'Synthetic failure' });
    expect(await applePrivateCloudComputeProvider.generate(request)).toEqual({
      ok: false,
      error: { code: expected, retryable, message: 'Synthetic failure' },
    });
    expect(send).toHaveBeenCalledTimes(1);
  },
);
