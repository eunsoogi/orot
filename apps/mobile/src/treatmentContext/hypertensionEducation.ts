import type { EvidenceReference } from '@orot/agent-runtime';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { generalEducation } from './localTreatmentEvidence';
import type { TreatmentEvidenceRequest } from './interfaces';
import type { TreatmentPublicEvidence } from './types';

// The reviewed public bundle is independent of any person's records.
const reviewedAt = '2026-11-10T15:14:53Z';
const publications = [
  {
    id: 'who-hypertension-fact-sheet',
    title: 'WHO · Hypertension',
    originalUrl:
      'https://www.who.int/news-room/fact-sheets/detail/hypertension',
    publicationDate: '2025-09-25',
    sourceType: 'fact_sheet',
    population: null,
  },
  {
    id: 'who-hypertension-adults-guideline',
    title:
      'WHO · Guideline for the pharmacological treatment of hypertension in adults',
    originalUrl: 'https://www.who.int/publications/i/item/9789240033986',
    publicationDate: '2021-08-24',
    sourceType: 'guideline',
    population: '임신 중이 아닌 성인 고혈압 환자',
  },
  {
    id: 'aha-home-blood-pressure-monitoring',
    title: 'AHA · Home Blood Pressure Monitoring',
    originalUrl:
      'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home',
    publicationDate: null,
    updatedDate: '2025-08-14',
    sourceType: 'patient_education',
    population: null,
  },
];

const publicEvidence = publications.map(
  ({ id, title, updatedDate, ...publication }): TreatmentPublicEvidence => {
    const metadata = {
      ...publication,
      retrievedAt: reviewedAt,
      limitations: [],
      availability: 'full_text' as const,
    };
    return {
      ...metadata,
      reference: {
        sourceKind: 'external_medical',
        sourceId: id,
        sourceRevision: reviewedAt,
        evidenceId: id,
        evidenceRevision: reviewedAt,
        locator: {
          kind: 'public_treatment_education',
          title,
          ...metadata,
          ...(updatedDate ? { updatedDate } : {}),
        },
        effectiveTime: null,
        reviewState: 'unknown',
      },
    };
  },
);

export const hypertensionEducationReferences = publicEvidence.map(
  item => item.reference,
);

export const hypertensionEducation: TreatmentEvidenceRequest = {
  context: {
    ...generalEducation.context,
    publicTopic: 'hypertension',
    publicEvidence,
  },
  sources: hypertensionEducationReferences.map(reference => ({
    reference,
    records: [],
  })),
  async revalidateEvidence(references, signal) {
    return (
      !signal.aborted &&
      references.every(reference => hypertensionEducationPublication(reference))
    );
  },
};

/** Match the whole reviewed reference, including its exact locator and revision. */
export function hypertensionEducationPublication(reference: EvidenceReference) {
  const index = hypertensionEducationReferences.findIndex(
    reviewed => stableJson(reviewed) === stableJson(reference),
  );
  return publications[index];
}
