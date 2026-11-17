/** Fixed reason codes only; never forward arbitrary validation text or numeric limits. */
export type BudgetDiagnosticOutcome =
  | 'budget_time'
  | 'budget_evidence_payload'
  | 'budget_evidence_items'
  | 'budget_model_calls'
  | 'budget_research_cycles'
  | 'budget_research_payload'
  | 'budget_model_payload'
  | 'budget_tool_calls'
  | 'budget_output_payload'
  | 'budget_search_start'
  | 'budget_partition_calls'
  | 'budget_other';

export function workflowBudgetDiagnostic(
  reason?: string,
): BudgetDiagnosticOutcome {
  switch (reason) {
    case 'The run exceeded its time limit.':
      return 'budget_time';
    case 'The evidence result exceeded the payload limit.':
      return 'budget_evidence_payload';
    case 'The evidence item budget was exceeded.':
      return 'budget_evidence_items';
    case 'The model call budget was exhausted.':
      return 'budget_model_calls';
    case 'The evidence research cycle budget was exhausted.':
      return 'budget_research_cycles';
    case 'The researcher tool input exceeded the payload limit.':
      return 'budget_research_payload';
    case 'The model request exceeded the payload limit.':
      return 'budget_model_payload';
    case 'The model tool call exceeded the run budget.':
      return 'budget_tool_calls';
    case 'The task responder output exceeded the payload limit.':
      return 'budget_output_payload';
    case 'The read-only evidence search could not be started.':
      return 'budget_search_start';
    case 'The complete partitioned result exceeds the model call budget.':
      return 'budget_partition_calls';
    default:
      return 'budget_other';
  }
}
