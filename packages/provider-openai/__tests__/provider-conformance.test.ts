import { expect } from '@jest/globals';
import { createChatGPTPlanProvider } from '../src';
import {
  completionRequest,
  completionResponse,
  defineProviderConformanceSuite,
  structuredOutputRequest,
  toolCallRequest,
  toolCallResponse,
  unsupportedImageRequest,
  visitQuestionText,
  visitQuestionToolCall,
  type ProviderConformanceAdapter,
  type ProviderConformanceScenario,
} from '../../model-runtime/__tests__/providerConformance';
import { FakeBridge } from './providerTestSupport';

const chatGPTAdapter: ProviderConformanceAdapter = {
  name: 'ChatGPT plan adapter over a deterministic native boundary',
  expectedCapabilities: {
    inputTypes: ['text'],
    streaming: true,
    structuredOutput: false,
    toolCalling: true,
  },
  createCase(scenario: ProviderConformanceScenario) {
    const bridge = new FakeBridge(async (requestID, target) => {
      if (scenario === 'authentication') {
        target.emit({
          requestId: requestID,
          type: 'failed',
          error: { kind: 'authentication', httpStatusCode: 401 },
        });
      } else if (scenario === 'rate-limit') {
        target.emit({
          requestId: requestID,
          type: 'failed',
          error: { kind: 'usage_limit', httpStatusCode: 429 },
        });
      } else if (scenario === 'unavailable') {
        target.emit({
          requestId: requestID,
          type: 'failed',
          error: { kind: 'transport', httpStatusCode: 503 },
        });
      } else if (scenario === 'tool-call') {
        const nativeCall = {
          id: visitQuestionToolCall.id,
          name: visitQuestionToolCall.name,
          arguments: JSON.stringify(visitQuestionToolCall.arguments),
        };
        target.emit({ requestId: requestID, type: 'tool_call', toolCall: nativeCall });
        target.emit({
          requestId: requestID,
          type: 'completed',
          text: '',
          toolCalls: [nativeCall],
        });
      } else {
        target.emit({
          requestId: requestID,
          type: 'text_delta',
          text: scenario === 'cancellation' ? '부분 응답' : visitQuestionText,
        });
        if (scenario !== 'cancellation') {
          target.emit({
            requestId: requestID,
            type: 'completed',
            text: visitQuestionText,
          });
        }
      }
    });
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'synthetic-issued-client',
      model: { slug: 'gpt-synthetic', displayName: 'Synthetic model' },
      requestIDFactory: () => 'synthetic-request-' + scenario,
    });
    const request =
      scenario === 'structured-output'
        ? structuredOutputRequest
        : scenario === 'tool-call'
          ? toolCallRequest
          : scenario === 'unsupported-input'
            ? unsupportedImageRequest
            : completionRequest;
    const expectedResponse = scenario === 'tool-call' ? toolCallResponse : completionResponse;

    return {
      provider,
      request,
      expectedResponse,
      expectedError:
        scenario === 'authentication'
          ? { code: 'authentication_required', retryable: false }
          : scenario === 'rate-limit'
            ? { code: 'rate_limited', retryable: false }
            : scenario === 'unavailable'
              ? { code: 'provider_unavailable', retryable: true }
              : undefined,
      assertNoNativeCall: () => expect(bridge.started).toHaveLength(0),
      assertCancelled: () => expect(bridge.cancelled).toEqual(['synthetic-request-cancellation']),
    };
  },
  failures: [
    {
      name: 'OAuth authorization failure',
      scenario: 'authentication',
      expected: { code: 'authentication_required', retryable: false },
    },
    {
      name: 'plan usage limit',
      scenario: 'rate-limit',
      expected: { code: 'rate_limited', retryable: false },
    },
    {
      name: 'remote transport unavailability',
      scenario: 'unavailable',
      expected: { code: 'provider_unavailable', retryable: true },
    },
  ],
};

defineProviderConformanceSuite(chatGPTAdapter);
