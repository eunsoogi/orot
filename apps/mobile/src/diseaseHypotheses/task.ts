import type { JsonObject, LanguageModelMessage } from '@orot/model-runtime';
import {
  providerDiagnostic,
  reportWorkflowOutcome,
} from '../providers/diagnostics';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type {
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';
import { assessHealthEvidenceCoverage } from '../healthEvidence/coverage';
import type { HealthEvidenceInventory } from '../healthEvidence/coverage';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';
import type { LocalEvidenceIdentityResolver } from '../aiFeatures/integration/deletionAwareEvidence';
import {
  containsEvidenceReference,
  canPreviewDiseaseHypothesisSummary,
  diseaseHypothesisSchema,
  validateDiseaseHypothesisResult,
} from './resultValidation';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './types';
import type { ClinicalClaimIssue } from './clinicalClaimGuard';

export type {
  DiseaseHypothesis,
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './types';

/** Keeps generated hypotheses within the consent, freshness, and citation workflow. */
export const diseaseHypothesisTask: TaskResponderContract<DiseaseHypothesisAnalysis> =
  {
    taskType: 'disease_hypothesis_review',
    taskVersion: '1',
    allowRankedLocalEvidence: true,
    allowBoundedExternalEvidence: true,
    systemPrompt:
      'Review possible disease hypotheses from the supplied app evidence. This is not a diagnosis. ' +
      'Never recommend starting, stopping, or changing medication. Use only supplied evidence, ' +
      'cite exact references for supporting and contrary evidence, state uncertainty, and list missing data. ' +
      'Medication and dose records, walking/activity and blood-pressure or other measurements are usable evidence; transcripts and photos are not prerequisites. ' +
      'Distinguish observed changes from reported symptoms and possible explanations. Do not infer an experienced symptom or causation from a measurement or medication alone. ' +
      'After inspecting local records, use the public medical literature tool when an explanation needs medical context. Search generic concepts, never names, identifiers or verbatim private records. Cite the retrieved publications and distinguish population-level findings from this person’s records. ' +
      'The ranked evidence is not an exhaustive history. Do not treat omitted records as absent findings. Write user-facing text in Korean.',
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
    projectStreamedText(rawOutput) {
      const summary = extractPartialJsonStringAtPath(rawOutput, [
        'value',
        'hypotheses',
        0,
        'summary',
      ]);
      return summary && canPreviewDiseaseHypothesisSummary(summary)
        ? summary
        : undefined;
    },
    createMessages(input: TaskResponderInput): readonly LanguageModelMessage[] {
      return [
        {
          role: 'user',
          content: JSON.stringify({
            request: input.request,
            evidence: input.evidence.items.map(item => ({
              content: item.content,
              evidenceId: item.evidenceId,
              sourceKind: item.sourceKind,
              effectiveTime: item.effectiveTime,
              reviewState: item.reviewState,
            })),
            coverage: input.evidence.coverage,
            conflicts: input.evidence.conflicts,
            outputInstructions:
              'Return supportingEvidence and contraryEvidence as arrays of exact evidenceId strings. Top-level citations must contain the same cited IDs, without duplicates or extra IDs.',
          }),
        },
      ];
    },
    validateResult(value, input) {
      let claimIssue: ClinicalClaimIssue | undefined;
      const validation = validateDiseaseHypothesisResult(value, input, {
        onClinicalClaim: issue => {
          claimIssue ??= issue;
          providerDiagnostic(
            'disease',
            'validation',
            `task_claim_field_${issue.field}`,
          );
          providerDiagnostic(
            'disease',
            'validation',
            `task_claim_rule_${issue.rule}`,
          );
        },
        // Keep actual-provider rejection diagnosis separate from private model output.
        onInvalid: code =>
          providerDiagnostic(
            'disease',
            'validation',
            `task_hypothesis_${code}`,
          ),
      });
      // Correction receives a closed field label, not matched or private prose.
      return validation.status === 'invalid' && claimIssue
        ? {
            status: 'invalid',
            reason: `A hypothesis contained a definitive clinical claim in ${claimIssue.field}.`,
          }
        : validation;
    },
    correctionInstructionForInvalidResult(reason) {
      const field = ['title', 'summary', 'uncertainty', 'missing_data'].find(
        candidate =>
          reason ===
          `A hypothesis contained a definitive clinical claim in ${candidate}.`,
      );
      if (
        !field &&
        reason !== 'A hypothesis had unsupported or incomplete citations.'
      )
        return undefined;
      // Use the runtime's single correction allowance; the next result is fully
      // revalidated and still shares the original call, consent and time budget.
      return (
        'Return a corrected result in the same schema. Keep valid observations and exact citation IDs unchanged. ' +
        (field
          ? `The rejected field is ${field}. Revise that field and inspect the other fields for the same issue. `
          : '') +
        'State only tentative possibilities supported by the supplied evidence, never a confirmed diagnosis or a claim that this person definitely has a disease. ' +
        'The uncertainty field must describe concrete evidence limits such as missing timing, unknown measurement conditions or incomplete history. Avoid generic diagnosis-confirmation statements, even negated ones; describe what the records do not establish instead. ' +
        'Use uncertainty to describe limitations and missingData for genuinely missing facts. Do not invent symptoms, records or sources. Write user-facing text in Korean.'
      );
    },
  };

/** Preloaded callers must attest coverage; tool-first callers establish coverage through tool results. */
export async function runDiseaseHypothesisAnalysis(
  options: Omit<MultiAgentWorkflowOptions<DiseaseHypothesisAnalysis>, 'task'>,
  inventory: HealthEvidenceInventory | undefined,
  invocation?: MultiAgentInvocation,
  resolveLocalEvidenceIdentity?: LocalEvidenceIdentityResolver,
  task: TaskResponderContract<DiseaseHypothesisAnalysis> = diseaseHypothesisTask,
): Promise<DiseaseHypothesisRunOutcome> {
  const assessment = inventory
    ? assessHealthEvidenceCoverage(inventory)
    : undefined;
  if (assessment && assessment.status !== 'complete') {
    return { status: 'incomplete_inventory', reason: assessment.status };
  }
  providerDiagnostic('disease', 'workflow', 'started');
  const result = await runMultiAgentWorkflow(
    {
      ...options,
      revalidateEvidence: (references, signal) =>
        revalidateWithLocalDeletionGuard(
          references,
          signal,
          options.revalidateEvidence,
          resolveLocalEvidenceIdentity,
        ),
      task,
    },
    invocation,
  );
  reportWorkflowOutcome(
    'disease',
    result.status,
    'providerErrorCode' in result ? result.providerErrorCode : undefined,
    'reason' in result ? result.reason : undefined,
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
