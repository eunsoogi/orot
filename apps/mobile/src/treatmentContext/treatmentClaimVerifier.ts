import { createManualHistoryRepository } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../i18n/treatmentSafety';
import { assertRetainedEvidenceCurrent } from '../storage/retainedEvidenceFreshness';
import { assertTreatmentAttribution } from './attribution';
import {
  hypertensionEducation,
  hypertensionEducationReferences,
} from './hypertensionEducation';
import { parseTreatmentContext } from './validation';
import type { TreatmentClaimVerifier } from './safety';

/** Closed claims do not infer the person's condition or an appropriate therapy. */
export function createTreatmentClaimVerifier(
  database: SqlDatabase,
): TreatmentClaimVerifier {
  return {
    async verify(claim, request, signal) {
      try {
        const context = parseTreatmentContext(request.context, request.sources);
        if (!context || signal.aborted) return false;
        const cited = claim.citations.map(stableJson);
        if (new Set(cited).size !== cited.length) return false;
        const sameReferences = (references: readonly unknown[]) => {
          const expected = references.map(stableJson);
          return (
            expected.length === cited.length &&
            expected.every(value => cited.includes(value))
          );
        };
        const condition = context.conditions.find(item => {
          if (item.status === 'ai_possibility')
            return (
              claim.text ===
                treatmentSafetyKo['treatmentSafety.possibleCondition'] &&
              sameReferences([
                ...item.supportingEvidence,
                ...item.contraryEvidence,
              ])
            );
          const expected =
            item.status === 'clinician_recorded'
              ? treatmentSafetyKo['treatmentSafety.clinicianCondition']
              : treatmentSafetyKo['treatmentSafety.reportedCondition'];
          return claim.text === expected && sameReferences([item.source]);
        });
        const general =
          claim.text === treatmentSafetyKo['treatmentSafety.generalOptions'] ||
          claim.text === treatmentSafetyKo['treatmentSafety.benefitsRisks'] ||
          claim.text === treatmentSafetyKo['treatmentSafety.discussOptions'];
        const recordQuestion =
          claim.text === treatmentSafetyKo['treatmentSafety.recordQuestion'] &&
          cited.length === 1 &&
          context.conditions.some(item =>
            item.status === 'ai_possibility'
              ? false
              : sameReferences([item.source]),
          );
        // App-owned general education has no source attribution; attaching an
        // unrelated record or paper would misleadingly imply it supported it.
        // Public-topic copy requires the exact reviewed bundle, with no personal context.
        const publicEducation =
          claim.text ===
            treatmentSafetyKo['treatmentSafety.hypertensionOverview'] &&
          sameReferences(hypertensionEducationReferences) &&
          stableJson(context) === stableJson(hypertensionEducation.context) &&
          stableJson(request.sources) ===
            stableJson(hypertensionEducation.sources);
        if (
          !condition &&
          !recordQuestion &&
          !publicEducation &&
          !(general && cited.length === 0)
        )
          return false;
        const history = createManualHistoryRepository(database);
        await database.transaction(async tx => {
          await assertRetainedEvidenceCurrent(
            tx,
            request.sources,
            history,
            false,
          );
          await assertTreatmentAttribution(
            tx,
            history,
            context,
            request.sources,
          );
        });
        return !signal.aborted;
      } catch {
        return false;
      }
    },
  };
}
