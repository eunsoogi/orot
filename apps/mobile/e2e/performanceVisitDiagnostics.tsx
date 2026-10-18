import type { LanguageModelProvider, ProviderError } from '@orot/model-runtime';
import { NextVisitQuestionsRoute } from '../src/aiFeatures/integration/NextVisitQuestionsRoute';
import type { VisitQuestionsRenderInput } from '../src/aiFeatures/integration/AiFeatureFlowScreen';
import { defaultVisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';

/** Pass through the real route, provider, consent, tools and results; expose counts and error classes only. */
export function performanceVisitDiagnostics(report: (value: string) => void) {
  const operations = {
    ...defaultVisitQuestionRouteOperations,
    async generate(
      input: Parameters<typeof defaultVisitQuestionRouteOperations.generate>[0],
    ) {
      const original = input.selectedAi.option.provider;
      let calls = 0;
      let stage = 'preparation';
      let providerCode: string | undefined;
      const observeError = (error: ProviderError) => {
        providerCode = error.code;
        report(
          JSON.stringify({
            visitCalls: calls,
            providerCode: error.code,
            category: /context|token|window|size/i.test(error.message)
              ? 'context_capacity'
              : /schema|json|structured/i.test(error.message)
                ? 'structured_output'
                : 'other',
          }),
        );
      };
      const provider: LanguageModelProvider = {
        ...original,
        async generate(...args) {
          calls += 1;
          const result = await original.generate(...args);
          if (!result.ok) observeError(result.error);
          return result;
        },
        ...(original.stream
          ? {
              async *stream(
                ...args: Parameters<
                  NonNullable<LanguageModelProvider['stream']>
                >
              ) {
                calls += 1;
                for await (const result of original.stream!(...args)) {
                  if (!result.ok) observeError(result.error);
                  yield result;
                }
              },
            }
          : {}),
      };
      const result = await defaultVisitQuestionRouteOperations.generate({
        ...input,
        observer: {
          ...input.observer,
          onProgress(event) {
            stage =
              event.type === 'model_started'
                ? event.phase
                : `${event.sourceKind}:${event.status}`;
            input.observer?.onProgress?.(event);
          },
        },
        selectedAi: {
          ...input.selectedAi,
          provider,
          option: { ...input.selectedAi.option, provider },
        },
      });
      report(
        JSON.stringify({
          visitStatus: result.status,
          calls,
          stage,
          providerCode,
        }),
      );
      return result;
    },
  };
  return (input: VisitQuestionsRenderInput) => (
    <NextVisitQuestionsRoute {...input} operations={operations} />
  );
}
