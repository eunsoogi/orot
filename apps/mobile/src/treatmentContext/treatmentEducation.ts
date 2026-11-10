import type {
  EvidenceReference,
  MultiAgentInvocation,
} from '@orot/agent-runtime';
import type { SafetyPolicyAction } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import { treatmentSafetyKo } from '../i18n/treatmentSafety';
import type { TreatmentExplanationRequest } from './interfaces';
import { createTreatmentSafetyService } from './treatmentSafetyService';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';

export type TreatmentEducationSelection =
  | { readonly kind: 'general_options' | 'benefits_risks' | 'discuss_options' }
  | { readonly kind: 'condition' | 'record_question'; readonly index: number };

/** Produce one closed, source-bound statement per explicit request. */
export async function explainTreatmentEducation(
  database: SqlDatabase,
  request: TreatmentExplanationRequest,
  selection: TreatmentEducationSelection,
  signal: AbortSignal,
  actions: readonly SafetyPolicyAction[],
): Promise<TreatmentSafetyResult> {
  const safety = createTreatmentSafetyService(database);
  // The safety service checks policy and freshness even for app-owned copy.
  return safety.generate(
    {} as MultiAgentInvocation,
    async () => {
      let text: string;
      let citations: EvidenceReference[] = [];
      if (selection.kind === 'general_options')
        text = treatmentSafetyKo['treatmentSafety.generalOptions'];
      else if (selection.kind === 'benefits_risks')
        text = treatmentSafetyKo['treatmentSafety.benefitsRisks'];
      else if (selection.kind === 'discuss_options')
        text = treatmentSafetyKo['treatmentSafety.discussOptions'];
      else if ('index' in selection) {
        const condition = request.context.conditions[selection.index];
        if (!condition || !Number.isInteger(selection.index)) return null;
        if (condition.status === 'ai_possibility') {
          if (selection.kind === 'record_question') return null;
          text = treatmentSafetyKo['treatmentSafety.possibleCondition'];
          citations = [
            ...condition.supportingEvidence,
            ...condition.contraryEvidence,
          ];
        } else {
          text =
            selection.kind === 'record_question'
              ? treatmentSafetyKo['treatmentSafety.recordQuestion']
              : condition.status === 'clinician_recorded'
                ? treatmentSafetyKo['treatmentSafety.clinicianCondition']
                : treatmentSafetyKo['treatmentSafety.reportedCondition'];
          citations = [condition.source];
        }
      } else return null;
      return { claims: [{ text, citations }] };
    },
    request,
    signal,
    actions,
  );
}
