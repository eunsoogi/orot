import { runDiseaseHypothesisAnalysis } from '../src/diseaseHypotheses/task';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import { performanceRagDiagnostics } from './performanceRagDiagnostics';
import type { PerformanceRagDiagnosticDependencies } from './performanceRagDiagnostics';

export type PerformanceWorkflowDiagnostics = AiFeatureServiceDependencies &
  Pick<PerformanceRagDiagnosticDependencies, 'getTrace'>;

/** Observe the real workflow without replacing its model, tools, consent, or result. No payload text is displayed. */
export function performanceWorkflowDiagnostics(
  report: (value: string) => void,
): PerformanceWorkflowDiagnostics {
  return {
    ...performanceRagDiagnostics(),
    async diseaseRunner(...args) {
      const outcome = await runDiseaseHypothesisAnalysis(...args);
      if (outcome.status === 'workflow') {
        const result = outcome.result;
        const reason = 'reason' in result ? result.reason : '';
        report(
          JSON.stringify({
            status: result.status,
            providerCode:
              'providerErrorCode' in result
                ? result.providerErrorCode
                : undefined,
            modelCalls: result.checkpoint.modelCalls,
            toolCalls: result.checkpoint.toolCalls,
            failureCategory: /tool/i.test(reason)
              ? 'tool_contract'
              : /validation/i.test(reason)
                ? 'validation'
                : /structured/i.test(reason)
                  ? 'structured_output'
                  : /citation|cited/i.test(reason)
                    ? 'citations'
                    : 'other',
          }),
        );
      } else report(outcome.status);
      return outcome;
    },
  };
}
