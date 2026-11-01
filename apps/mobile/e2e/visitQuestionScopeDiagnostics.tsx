import type { LanguageModelProvider } from '@orot/model-runtime';
import { NextVisitQuestionsRoute } from '../src/aiFeatures/integration/NextVisitQuestionsRoute';
import type { VisitQuestionsRenderInput } from '../src/aiFeatures/integration/AiFeatureFlowScreen';
import { defaultVisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import { audit } from './visitQuestionScopeInventory';
import { visitQuestionResponseShape } from './visitQuestionResponseShape';
import {
  beginScopeObservation,
  dispatchScoped,
  observedEvidenceCount,
  providerEvidenceCount,
  requireScopeContext,
  rejectScope,
  scopeRejection,
} from './visitQuestionScopeGuard';
/** Test-only gate checks all reachable local sources before every real provider dispatch. */
export function visitQuestionScopeDiagnostics(report: (value: string) => void) {
  const operations = {
    ...defaultVisitQuestionRouteOperations,
    async generate(
      input: Parameters<typeof defaultVisitQuestionRouteOperations.generate>[0],
    ) {
      let calls = 0;
      const token = beginScopeObservation(report);
      const check = async (requireContext = false) => {
        if (requireContext) requireScopeContext(token);
        let result: Awaited<ReturnType<typeof audit>>;
        try {
          result = await audit(input.appointment);
        } catch {
          rejectScope(token, 'inventory_unavailable');
        }
        report(
          JSON.stringify({
            ...result,
            calls,
            validatedEvidence: observedEvidenceCount(token),
          }),
        );
        if (!result.ok) rejectScope(token, 'inventory_mismatch');
      };
      await check();
      const original = input.selectedAi.option.provider;
      if (
        original.id !== 'apple-foundation-models' ||
        input.selectedAi.remoteProcessing
      )
        rejectScope(token, 'provider_mismatch');
      const provider: LanguageModelProvider = {
        ...original,
        async generate(...args) {
          return dispatchScoped(
            token,
            () => check(true),
            async () => {
              const payloadEvidence = providerEvidenceCount(token, args[0]);
              report(
                JSON.stringify({
                  calls,
                  validatedEvidence: observedEvidenceCount(token),
                  payloadEvidence,
                }),
              );
              calls += 1;
              const callNumber = calls;
              const result = await original.generate(...args);
              if (result.ok)
                console.info(
                  'OROT_SYNTHETIC_RESPONSE',
                  callNumber,
                  JSON.stringify(visitQuestionResponseShape(result.value)),
                );
              return result;
            },
          );
        },
        ...(original.stream
          ? {
              async *stream(
                ...args: Parameters<
                  NonNullable<LanguageModelProvider['stream']>
                >
              ) {
                await check(true);
                requireScopeContext(token);
                const payloadEvidence = providerEvidenceCount(token, args[0]);
                report(
                  JSON.stringify({
                    calls,
                    validatedEvidence: observedEvidenceCount(token),
                    payloadEvidence,
                  }),
                );
                calls += 1;
                const callNumber = calls;
                for await (const event of original.stream!(...args)) {
                  if (event.ok && event.value.type === 'completed')
                    console.info(
                      'OROT_SYNTHETIC_RESPONSE',
                      callNumber,
                      JSON.stringify(
                        visitQuestionResponseShape(event.value.response),
                      ),
                    );
                  yield event;
                }
              },
            }
          : {}),
      };
      const result = await defaultVisitQuestionRouteOperations.generate({
        ...input,
        selectedAi: {
          ...input.selectedAi,
          provider,
          option: { ...input.selectedAi.option, provider },
        },
      });
      report(
        JSON.stringify({
          ...(await audit(input.appointment)),
          calls,
          validatedEvidence: observedEvidenceCount(token),
          scopeRejected: scopeRejection(token),
          outcome: result.status,
        }),
      );
      return result;
    },
  };
  return (input: VisitQuestionsRenderInput) => (
    <NextVisitQuestionsRoute {...input} operations={operations} />
  );
}
