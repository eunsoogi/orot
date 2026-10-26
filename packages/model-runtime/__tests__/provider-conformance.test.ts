import { InMemoryFakeLanguageModelProvider } from '../src';
import {
  completionRequest,
  completionResponse,
  defineProviderConformanceSuite,
  structuredOutputRequest,
  toolCallRequest,
  toolCallResponse,
  unsupportedImageRequest,
  type ProviderConformanceAdapter,
  type ProviderConformanceScenario,
} from './providerConformance';

const fakeCapabilities = {
  inputTypes: ['text'],
  streaming: true,
  structuredOutput: false,
  toolCalling: true,
} as const;

const fakeAdapter: ProviderConformanceAdapter = {
  name: 'in-memory fake provider',
  expectedCapabilities: fakeCapabilities,
  createCase(scenario: ProviderConformanceScenario) {
    const error =
      scenario === 'unavailable'
        ? {
            code: 'provider_unavailable' as const,
            message: 'Synthetic unavailable state.',
            retryable: false,
          }
        : scenario === 'authentication'
          ? {
              code: 'authentication_required' as const,
              message: 'Synthetic authorization state.',
              retryable: false,
            }
          : scenario === 'rate-limit'
            ? { code: 'rate_limited' as const, message: 'Synthetic rate limit.', retryable: true }
            : undefined;
    const response = scenario === 'tool-call' ? toolCallResponse : completionResponse;
    const request =
      scenario === 'structured-output'
        ? structuredOutputRequest
        : scenario === 'tool-call'
          ? toolCallRequest
          : scenario === 'unsupported-input'
            ? unsupportedImageRequest
            : completionRequest;

    return {
      provider: new InMemoryFakeLanguageModelProvider({
        capabilities: fakeCapabilities,
        response,
        error,
      }),
      request,
      expectedResponse: response,
      expectedError: error,
    };
  },
  failures: [
    {
      name: 'provider unavailability',
      scenario: 'unavailable',
      expected: { code: 'provider_unavailable', retryable: false },
    },
    {
      name: 'authentication',
      scenario: 'authentication',
      expected: { code: 'authentication_required', retryable: false },
    },
    {
      name: 'rate limiting',
      scenario: 'rate-limit',
      expected: { code: 'rate_limited', retryable: true },
    },
  ],
};

defineProviderConformanceSuite(fakeAdapter);
