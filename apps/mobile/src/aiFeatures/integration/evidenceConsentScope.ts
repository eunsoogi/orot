/** Build the exact categories disclosed for the selected workflow and its enabled tools. */
export function evidenceConsentScope(input: {
  readonly purpose:
    'symptom_summary' | 'disease_hypotheses' | 'record_conversation';
  readonly generatedArtifacts: boolean;
  readonly external: boolean;
  readonly publicWeb: boolean;
  readonly photo?: boolean;
}) {
  return {
    purpose: input.purpose,
    dataCategories: [
      'health_records',
      'reviewed_memory',
      'conversation',
      ...(input.generatedArtifacts ? ['generated_artifacts'] : []),
      ...(input.external ? ['medical_literature'] : []),
      ...(input.publicWeb ? ['public_web_results'] : []),
      ...(input.photo ? ['photo_ocr'] : []),
    ],
    policyVersion: input.generatedArtifacts
      ? 'local-artifacts-v1'
      : 'local-records-v1',
  };
}
