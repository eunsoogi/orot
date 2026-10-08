import type { JsonObject, LanguageModelMessage } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type {
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { assessHealthEvidenceCoverage } from '../healthEvidence/coverage';
import type { HealthEvidenceInventory } from '../healthEvidence/coverage';
import { withLocalDeletionAwareRevalidation } from '../memory/deletionAwareEvidenceRevalidation';
import {
  containsEvidenceReference,
  diseaseHypothesisSchema,
  referenceOnly,
  validateDiseaseHypothesisResult,
} from './resultValidation';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './types';

export type {
  DiseaseHypothesis,
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './types';

/** Keeps generated hypotheses within #117's consent, freshness, and citation workflow. */
export const diseaseHypothesisTask: TaskResponderContract<DiseaseHypothesisAnalysis> =
  {
    taskType: 'disease_hypothesis_review',
    taskVersion: '1',
    systemPrompt:
      'Review possible disease hypotheses from the supplied app evidence. This is not a diagnosis. ' +
      'Never recommend starting, stopping, or changing medication. Use only supplied evidence, ' +
      'cite exact references for supporting and contrary evidence, state uncertainty, and list missing data.',
    resultSchema: {
      type: 'object',
      required: ['hypotheses'],
      properties: {
        hypotheses: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: diseaseHypothesisSchema,
        },
      },
      additionalProperties: false,
    } satisfies JsonObject,
    createMessages(input: TaskResponderInput): readonly LanguageModelMessage[] {
      return [
        {
          role: 'user',
          content: JSON.stringify({
            request: input.request,
            evidence: input.evidence.items.map(item => ({
              content: item.content,
              reference: referenceOnly(item),
            })),
            coverage: input.evidence.coverage,
            conflicts: input.evidence.conflicts,
            outputInstructions:
              'Return hypotheses with exact nested references and top-level citations.',
          }),
        },
      ];
    },
    validateResult(value, input) {
      return validateDiseaseHypothesisResult(value, input);
    },
  };

/** Requires a truthful all-record inventory before asking #117 to analyze local evidence. */
export async function runDiseaseHypothesisAnalysis(
  options: Omit<MultiAgentWorkflowOptions<DiseaseHypothesisAnalysis>, 'task'>,
  inventory: HealthEvidenceInventory,
  invocation?: MultiAgentInvocation,
): Promise<DiseaseHypothesisRunOutcome> {
  const assessment = assessHealthEvidenceCoverage(inventory);
  if (assessment.status !== 'complete') {
    return { status: 'incomplete_inventory', reason: assessment.status };
  }
  const result = await runMultiAgentWorkflow(
    {
      ...options,
      revalidateEvidence: withLocalDeletionAwareRevalidation(
        options.revalidateEvidence,
      ),
      task: diseaseHypothesisTask,
    },
    invocation,
  );
  if (
    result.status === 'result' &&
    result.value.hypotheses.some(hypothesis =>
      [...hypothesis.supportingEvidence, ...hypothesis.contraryEvidence].some(
        reference => !containsEvidenceReference(result.citations, reference),
      ),
    )
  ) {
    return {
      status: 'workflow',
      result: {
        status: 'invalid_output',
        reason:
          'The validated citation list did not cover each hypothesis reference.',
        checkpoint: result.checkpoint,
      },
    };
  }
  return { status: 'workflow', result };
}
