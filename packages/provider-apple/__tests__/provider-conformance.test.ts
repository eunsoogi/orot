import { expect } from '@jest/globals';
import { APPLE_PROVIDER_CAPABILITIES, AppleFoundationModelsProvider } from '../src';
import {
  completionRequest,
  completionResponse,
  defineProviderConformanceSuite,
  structuredOutputRequest,
  structuredOutputResponse,
  toolCallRequest,
  toolCallResponse,
  unsupportedImageRequest,
  visitQuestionText,
  type ProviderConformanceAdapter,
  type ProviderConformanceScenario,
} from '../../model-runtime/__tests__/providerConformance';
import { FakeNativeBridge } from './providerTestSupport';

const appleAdapter: ProviderConformanceAdapter = {
  name: 'Apple Foundation Models adapter over a deterministic native boundary',
  expectedCapabilities: APPLE_PROVIDER_CAPABILITIES,
  createCase(scenario: ProviderConformanceScenario) {
    const native = new FakeNativeBridge();
    let request = completionRequest;
    let expectedResponse = completionResponse;

    if (scenario === 'structured-output') {
      request = structuredOutputRequest;
      expectedResponse = structuredOutputResponse;
      native.generated = expectedResponse;
    } else if (scenario === 'tool-call') {
      request = toolCallRequest;
      expectedResponse = toolCallResponse;
      native.generated = expectedResponse;
    } else if (scenario === 'unsupported-input') {
      request = unsupportedImageRequest;
    } else if (scenario === 'unavailable') {
      native.availability = 'unsupportedDevice';
    } else if (scenario === 'temporarily-unavailable') {
      native.availability = 'modelNotReady';
    } else if (scenario === 'streaming' || scenario === 'cancellation') {
      const split = 8;
      native.generated = completionResponse;
      native.packets = [
        { type: 'snapshot', text: visitQuestionText.slice(0, split) },
        { type: 'snapshot', text: visitQuestionText },
        { type: 'completed', response: completionResponse },
      ];
    } else {
      native.generated = completionResponse;
    }

    return {
      provider: new AppleFoundationModelsProvider(native),
      request,
      expectedResponse,
      expectedError:
        scenario === 'unavailable'
          ? { code: 'provider_unavailable', retryable: false }
          : scenario === 'temporarily-unavailable'
            ? { code: 'provider_unavailable', retryable: true }
            : undefined,
      assertNoNativeCall: () => expect(native.generateCount).toBe(0),
      assertCancelled: () => expect(native.cancelled).toHaveLength(1),
    };
  },
  failures: [
    {
      name: 'unsupported-device availability',
      scenario: 'unavailable',
      expected: { code: 'provider_unavailable', retryable: false },
    },
    {
      name: 'model-not-ready availability',
      scenario: 'temporarily-unavailable',
      expected: { code: 'provider_unavailable', retryable: true },
    },
  ],
};

defineProviderConformanceSuite(appleAdapter);
