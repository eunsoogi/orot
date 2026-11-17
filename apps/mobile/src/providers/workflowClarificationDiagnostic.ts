/** Closed runtime reasons only; task messages and arbitrary validation text are excluded. */
export type ClarificationDiagnosticOutcome =
  | 'clarification_no_new_evidence'
  | 'clarification_search_coverage'
  | 'clarification_result_coverage'
  | 'clarification_task_validation'
  | 'clarification_group_validation'
  | 'clarification_no_search'
  | 'clarification_research_exhausted'
  | 'clarification_other';

export function workflowClarificationDiagnostic(
  reason?: string,
): ClarificationDiagnosticOutcome {
  switch (reason) {
    case 'The search did not add new evidence at a newer source revision.':
      return 'clarification_no_new_evidence';
    case 'The available evidence has gaps, conflicts, or truncation.':
      return 'clarification_search_coverage';
    case 'The available evidence has gaps, conflicts, truncation, or no coverage.':
      return 'clarification_result_coverage';
    case 'The task requires clarification before it can return a result.':
      return 'clarification_task_validation';
    case 'A result group requires clarification.':
      return 'clarification_group_validation';
    case 'No bounded evidence search is available for this request.':
      return 'clarification_no_search';
    case 'The task still needs evidence after the bounded research cycle.':
      return 'clarification_research_exhausted';
    default:
      return 'clarification_other';
  }
}
