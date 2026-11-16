import type { DiseaseHypothesisAnalysis } from './types';

/** Communication guidance is not permission to remove source facts or coverage warnings. */
export const summaryCommunicationGuidance =
  'Lead with concise recorded facts. Do not add a routine disclaimer about missed doses or nonadherence merely because dates or dose entries are absent. Say only that this supplied record has no dose entry when that distinction is relevant; never infer actual nonuse, skipped medication, or adherence from missing entries. Preserve explicitly recorded skipped doses, stopped use and the user’s specific adherence question, with their source and time scope. Explain registration versus confirmed use briefly only when needed, not as a repeated checklist of things the record does not prove. ' +
  'Keep real retrieval and coverage limitations visible in plain Korean. Explain the consequence, such as some requested topics could not be included in this summary, not internal payload limits, token budgets, byte counts, tool names or raw gap codes. Do not say records are absent merely because retrieval was incomplete. Do not claim the summary is complete or prescribe re-entry of existing data. Preserve actual consent refusal, unavailable sources and clinically relevant uncertainty. ';

export const SUMMARY_COMMUNICATION_REASON =
  'Explain incomplete summary coverage without internal transport terminology.';

// Narrow wording regression check, not a general semantic or clinical classifier.
// Only newly generated presentation is checked; underlying coverage and retained text stay unchanged.
export function hasInternalSummaryTerminology(text: string): boolean {
  const internalLimit =
    /(?:반환|도구|응답|전송)\s*(?:자료|데이터|결과)?(?:의)?\s*(?:용량|크기)\s*(?:제한|한도)|\bpayload\b|페이로드|토큰\s*(?:예산|한도|제한)|maxPayloadBytes|period_detail_exceeds_payload_limit/iu;
  return internalLimit.test(text);
}

export function summaryCommunicationIssue(
  analysis: DiseaseHypothesisAnalysis,
): string | undefined {
  return analysis.hypotheses.some(section =>
    [
      section.title,
      section.summary,
      section.uncertainty,
      ...section.missingData,
    ].some(hasInternalSummaryTerminology),
  )
    ? SUMMARY_COMMUNICATION_REASON
    : undefined;
}

export function summaryCommunicationCorrection(reason: string) {
  return reason === SUMMARY_COMMUNICATION_REASON
    ? 'Rewrite only the internal retrieval-limit wording as a concise Korean explanation of which requested information could not be included. Keep the summary explicitly partial where appropriate; do not claim records are missing, invent a cause, hide a source/consent limitation or remove clinical facts. Preserve exact facts, citations and all other safety constraints. Use only the current evidence and no new searches.'
    : undefined;
}
