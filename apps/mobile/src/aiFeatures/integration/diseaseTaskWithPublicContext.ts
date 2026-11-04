import { diseaseHypothesisTask } from '../../diseaseHypotheses/task';

/** Public explanations cannot by themselves establish a possibility for this person. */
export const diseaseTaskWithPublicContext = {
  ...diseaseHypothesisTask,
  requiredToolEvidenceKinds: ['personal_record'] as const,
  projectStreamedText: (
    ...args: Parameters<
      NonNullable<typeof diseaseHypothesisTask.projectStreamedText>
    >
  ) =>
    args[1].evidence.items.some(item => item.sourceKind !== 'external_medical')
      ? diseaseHypothesisTask.projectStreamedText?.(...args)
      : undefined,
  validateResult: (
    ...args: Parameters<typeof diseaseHypothesisTask.validateResult>
  ) => {
    const result = diseaseHypothesisTask.validateResult(...args);
    if (result.status !== 'valid') return result;
    if (
      result.value.hypotheses.some(
        item =>
          !item.supportingEvidence.some(
            reference => reference.sourceKind !== 'external_medical',
          ),
      )
    ) {
      return {
        status: 'invalid' as const,
        reason: 'Each possibility needs supporting personal evidence.',
      };
    }
    return result;
  },
};
