/** Only closed citation shape/binding failures permit one format repair; facts and references still undergo full validation. */
export function summaryEnvelopeCorrection(reason: string): string | undefined {
  if (
    reason ===
    'The result cited evidence outside the current validated evidence set.'
  )
    return 'Repair the top-level citations array using exact evidenceId strings from the current supplied evidence. Return each used ID once, without duplicates, reference objects, invented IDs or IDs copied from record content. Keep supported facts and source-specific section citations. Return the complete specified JSON envelope; do not request new sources.';
  if (reason !== 'The task responder returned an invalid envelope: citations.')
    return undefined;
  return 'Return the complete required result envelope: type="result", value containing the summary, and citations as an array of exact supplied evidence IDs used by its sections. Keep supported facts, separate personal-record facts from public medical context, and preserve Korean display text. Use only current supplied evidence and the specified schema. Do not request new sources or invent citation IDs.';
}

/** Complete record summaries may restrict top-level IDs without requiring every source to be cited. */
export const summaryResponseGuidance = {
  constrainCitationIds: true,
  correctionInstructionForInvalidEnvelope: summaryEnvelopeCorrection,
} as const;
