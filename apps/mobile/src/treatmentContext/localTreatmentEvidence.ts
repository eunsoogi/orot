import type { TreatmentEvidenceRequest } from './interfaces';

// This entry offers general education. It neither infers a condition from
// conversation text nor treats today's safety inputs as clinical provenance.
export const generalEducation: TreatmentEvidenceRequest = {
  context: {
    version: 1,
    conditions: [],
    clinicianPlans: { status: 'unavailable' },
    publicEvidence: [],
    missingContext: [],
    conflicts: [],
  },
  sources: [],
  revalidateEvidence: async (references, signal) =>
    references.length === 0 && !signal.aborted,
};

// Reopening binds the stored request; the closed verifier checks its actual sources.
export const savedEducation: TreatmentEvidenceRequest = {
  ...generalEducation,
  revalidateEvidence: async (_references, signal) => !signal.aborted,
};
