import { describe, expect, it } from '@jest/globals';
import type {
  LanguageModelCapabilities,
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
  ProviderError,
  ProviderResult,
} from '../src/contracts';

// Shared assertions cover normalized adapter behavior; providers supply only deterministic bridge fixtures.
export type ProviderConformanceScenario =
  | 'completion'
  | 'streaming'
  | 'structured-output'
  | 'tool-call'
  | 'unsupported-input'
  | 'unavailable'
  | 'temporarily-unavailable'
  | 'authentication'
  | 'rate-limit'
  | 'cancellation';

export interface ProviderConformanceCase {
  readonly provider: LanguageModelProvider;
  readonly request: LanguageModelRequest;
  readonly expectedResponse?: LanguageModelResponse;
  readonly expectedError?: Pick<ProviderError, 'code' | 'retryable'>;
  readonly assertNoNativeCall?: () => void;
  readonly assertCancelled?: () => void;
}

export interface ProviderConformanceAdapter {
  readonly name: string;
  readonly expectedCapabilities: LanguageModelCapabilities;
  readonly createCase: (scenario: ProviderConformanceScenario) => ProviderConformanceCase;
  readonly failures?: readonly {
    readonly name: string;
    readonly scenario: ProviderConformanceScenario;
    readonly expected: Pick<ProviderError, 'code' | 'retryable'>;
  }[];
}

export {
  completionRequest,
  completionResponse,
  structuredOutputRequest,
  structuredOutputResponse,
  toolCallRequest,
  toolCallResponse,
  unsupportedImageRequest,
  visitQuestionOutput,
  visitQuestionText,
  visitQuestionTool,
  visitQuestionToolCall,
} from './providerConformanceFixtures';

export function defineProviderConformanceSuite(adapter: ProviderConformanceAdapter): void {
  describe('LanguageModelProvider conformance: ' + adapter.name, () => {
    it('reports the capabilities its adapter fixture implements', () => {
      const { provider } = adapter.createCase('completion');
      expect(provider.capabilities).toEqual(adapter.expectedCapabilities);
    });

    it('returns the normalized completion contract', async () => {
      const testCase = adapter.createCase('completion');
      const result = await testCase.provider.generate(testCase.request);

      expect(result).toEqual({ ok: true, value: testCase.expectedResponse });
    });

    it('streams append-only text deltas and one matching terminal response when advertised', async () => {
      const testCase = adapter.createCase('streaming');
      const { provider } = testCase;

      if (!provider.capabilities.streaming) {
        if (!provider.stream) {
          expect(testCase.expectedError?.code).toBe('unsupported_capability');
          return;
        }
        const unsupported = await collect(provider, testCase.request);
        expect(unsupported.some((event) => !event.ok)).toBe(true);
        expect(unsupported.find((event) => !event.ok)).toMatchObject({
          ok: false,
          error: { code: 'unsupported_capability' },
        });
        return;
      }

      expect(provider.stream).toBeDefined();
      const events = await collect(provider, testCase.request);
      expect(events.every((event) => event.ok)).toBe(true);
      const values = events.flatMap((event) => (event.ok ? [event.value] : []));
      const deltas = values
        .filter((event) => event.type === 'text_delta')
        .map((event) => (event.type === 'text_delta' ? event.text : ''));
      const completed = values.filter((event) => event.type === 'completed');

      expect(deltas.join('')).toBe(testCase.expectedResponse?.text);
      expect(completed).toEqual([{ type: 'completed', response: testCase.expectedResponse }]);
      expect(values.at(-1)).toEqual(completed[0]);
    });

    it('supports structured output only when the capability says it does', async () => {
      const testCase = adapter.createCase('structured-output');
      const result = await testCase.provider.generate(testCase.request);

      if (adapter.expectedCapabilities.structuredOutput) {
        expect(result).toEqual({ ok: true, value: testCase.expectedResponse });
      } else {
        expectFailure(result, { code: 'unsupported_capability', retryable: false });
        testCase.assertNoNativeCall?.();
      }
    });

    it('returns normalized local tool calls only when the capability says it does', async () => {
      const testCase = adapter.createCase('tool-call');
      const result = await testCase.provider.generate(testCase.request);

      if (adapter.expectedCapabilities.toolCalling) {
        expect(result).toEqual({ ok: true, value: testCase.expectedResponse });
      } else {
        expectFailure(result, { code: 'unsupported_capability', retryable: false });
        testCase.assertNoNativeCall?.();
      }
    });

    it('rejects unsupported image input before invoking the native boundary', async () => {
      const testCase = adapter.createCase('unsupported-input');
      const result = await testCase.provider.generate(testCase.request);

      expectFailure(result, { code: 'unsupported_input', retryable: false });
      testCase.assertNoNativeCall?.();
    });

    for (const failure of adapter.failures ?? []) {
      it('keeps ' + failure.name + ' distinct in the normalized error result', async () => {
        const testCase = adapter.createCase(failure.scenario);
        const result = await testCase.provider.generate(testCase.request);

        expectFailure(result, failure.expected);
      });
    }

    it('lets a consumer close an active stream and cancels native work when available', async () => {
      if (!adapter.expectedCapabilities.streaming) return;
      const testCase = adapter.createCase('cancellation');
      const iterator = testCase.provider.stream!(testCase.request)[Symbol.asyncIterator]();
      const first = await iterator.next();

      expect(first.done).toBe(false);
      expect(first.value?.ok).toBe(true);
      await iterator.return?.();
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
      testCase.assertCancelled?.();
    });
  });
}

function expectFailure<T>(
  result: ProviderResult<T>,
  expected: Pick<ProviderError, 'code' | 'retryable'>,
): void {
  expect(result).toMatchObject({ ok: false, error: expected });
}

async function collect(
  provider: LanguageModelProvider,
  request: LanguageModelRequest,
): Promise<ProviderResult<import('../src/contracts').LanguageModelStreamEvent>[]> {
  const events: ProviderResult<import('../src/contracts').LanguageModelStreamEvent>[] = [];
  if (!provider.stream) return events;
  for await (const event of provider.stream(request)) events.push(event);
  return events;
}
