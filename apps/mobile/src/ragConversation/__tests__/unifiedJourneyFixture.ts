import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { appleModelMockScript } from '../../../e2e/appleModelMockFixtures';

/** Adapts the existing synthetic SDK script to the production provider contract. */
export function scriptedLiteratureProvider() {
  const script = appleModelMockScript('rag-workflow');
  let calls = 0;
  return {
    calls: () => calls,
    generate: jest.fn(async (request: LanguageModelRequest) => {
      const output = JSON.parse(script[calls++]!(request).text!);
      if (output.kind === 'tool_calls')
        return providerSuccess({
          text: '',
          toolCalls: output.toolCalls.map((call: object, index: number) => ({
            ...call,
            id: `synthetic-${index}`,
          })),
          finishReason: 'tool_calls' as const,
        });
      return providerSuccess({
        text: JSON.stringify(
          output.kind === 'structured' ? output.value : output,
        ),
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    }),
  };
}
