import type { AppleNativeRequest } from '../schema-types';
import { NativeModules } from 'react-native';

/** A synthetic native module observes routing; this does not execute the PCC service. */
it('routes PCC sends explicitly and keeps local and recap sends local', async () => {
  const response = {
    text: 'Synthetic answer',
    toolCalls: [],
    finishReason: 'complete',
  };
  const native = {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    getAvailability: jest.fn(async () => ({ status: 'available' })),
    getPrivateCloudComputeAvailability: jest.fn(async () => ({
      status: 'available',
    })),
    generate: jest.fn<Promise<typeof response>, [AppleNativeRequest, string]>(
      async () => response,
    ),
    startStream: jest.fn(),
    cancel: jest.fn(),
  };
  const original = NativeModules.AppleFoundationModelsModule;
  NativeModules.AppleFoundationModelsModule = native;
  try {
    await jest.isolateModulesAsync(async () => {
      const {
        applePrivateCloudComputeNativeBridge: pcc,
        appleFoundationModelsNativeBridge: local,
        appleRecapNativeBridge: recap,
      } = require('../nativeBridge') as typeof import('../nativeBridge');
      const request = {
        messages: [{ role: 'user' as const, content: 'Synthetic input' }],
      };
      await pcc.getAvailability();
      expect(native.getPrivateCloudComputeAvailability).toHaveBeenCalledTimes(
        1,
      );
      expect(native.getAvailability).not.toHaveBeenCalled();
      await pcc.generate(request, 'pcc-request');
      expect(native.generate).toHaveBeenLastCalledWith(
        expect.objectContaining({ modelRoute: 'private-cloud-compute' }),
        'pcc-request',
      );
      await local.generate(request, 'local-request');
      expect(native.generate.mock.calls[1][0]).not.toHaveProperty('modelRoute');
      await recap.generate(request, 'recap-request');
      expect(native.generate.mock.calls[2][0]).toHaveProperty(
        'profile',
        'recap-transformation',
      );
      expect(native.generate.mock.calls[2][0]).not.toHaveProperty('modelRoute');
      pcc.cancel('pcc-request');
      expect(native.cancel).toHaveBeenCalledWith('pcc-request');
    });
  } finally {
    NativeModules.AppleFoundationModelsModule = original;
  }
});
